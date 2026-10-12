// IM4 Upload-pending notifications: committing a batch tells the managers of
// each site in it (Admins for a site with no manager), never the uploader or
// another company, once per batch; the P13 "uploads" filter lists them; the
// internal batch-committed hook needs the service key; a failing listener
// never fails the emit.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const dist = path.resolve(__dirname, "../../../dist");
const { AppDataSource } = require(path.join(dist, "config/data-source.js"));
const writer = require(path.join(dist, "imports/writer.js"));
const { notifyBatchCommitted, registerUploadNotifyListener } = require(path.join(dist, "services/uploadNotify.js"));

// Fixture: manager 2 → sites 1 + 2 (company 1); other manager 6 → site 3
// (company 2); admin 3 → company 1; user 1 → site 1.
const event = (over = {}) => ({
  upload_batch_id: "im4-batch-1",
  company_id: 1,
  created_by: 1,
  channel: "mcp",
  source_name: "fuel.xlsx",
  site_ids: [1, 2],
  rows: 12,
  tco2e: 3.5,
  months: ["2026-03", "2026-04"],
  ...over,
});

const countFor = (userId, batchId) =>
  withDb(async (db) => {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND type = 'UPLOAD_PENDING' AND meta->>'upload_batch_id' = $2`,
      [userId, batchId]
    );
    return r.rows[0].n;
  });

test.before(async () => {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  writer.clearBatchCommittedListeners();
});
test.after(async () => {
  writer.clearBatchCommittedListeners();
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

test("managers of the batch's sites get exactly one notification; uploader, admin and other company get none", async () => {
  const r = await notifyBatchCommitted(event());
  assert.equal(r.notified, 1);
  assert.equal(await countFor(2, "im4-batch-1"), 1);
  assert.equal(await countFor(1, "im4-batch-1"), 0);
  assert.equal(await countFor(3, "im4-batch-1"), 0);
  assert.equal(await countFor(6, "im4-batch-1"), 0);

  const res = await call("GET", "/notifications?type=uploads", "manager");
  assert.equal(res.status, 200);
  const n = res.json.notifications.find((x) => x.meta?.upload_batch_id === "im4-batch-1");
  assert.ok(n, "listed under the uploads filter");
  assert.equal(n.title, "Entries waiting for your review");
  assert.equal(n.message, "CI User uploaded 12 entries for CI Plant A, CI Plant B (Mar–Apr 2026). 3.5 tCO₂e waiting for review");
  assert.equal(n.link, "/data/approvals?view=batches&batch=im4-batch-1");
  assert.deepEqual(n.meta.site_ids, [1, 2]);
  assert.equal(n.meta.channel, "mcp");
});

test("a manager who uploads their own batch is not told; admins stand in for a site with no manager", async () => {
  // Site 2 managed only by manager 2, who is the uploader → nobody from the managers; site has a manager so no admin fallback.
  const r1 = await notifyBatchCommitted(event({ upload_batch_id: "im4-batch-2", created_by: 2, site_ids: [2] }));
  assert.equal(r1.notified, 0);

  // A fresh site in company 1 with no manager → company 1 Admin (user 3), not company 2's.
  await withDb((db) => db.query(`INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES (91, 'CI Orphan Plant', 'x', 'CI', 1) ON CONFLICT DO NOTHING`));
  const r2 = await notifyBatchCommitted(event({ upload_batch_id: "im4-batch-3", site_ids: [91], months: ["2026-01"] }));
  assert.equal(r2.notified, 1);
  assert.equal(await countFor(3, "im4-batch-3"), 1);
  assert.equal(await countFor(2, "im4-batch-3"), 0);
  assert.equal(await countFor(6, "im4-batch-3"), 0);

  // The same batch again (a retried emit, or the hook called twice) adds nothing.
  const r3 = await notifyBatchCommitted(event({ upload_batch_id: "im4-batch-3", site_ids: [91], months: ["2026-01"] }));
  assert.equal(r3.notified, 0);
  assert.equal(await countFor(3, "im4-batch-3"), 1);

  // An Admin tied to the company only through user_sites (no site_id) is found too.
  await withDb((db) =>
    db.query(
      `INSERT INTO "user" (user_id, name, email, password, role, site_id)
       VALUES (92, 'CI Admin Two', 'ci-admin2@example.invalid', 'x', 'Admin', NULL) ON CONFLICT DO NOTHING`
    )
  );
  await withDb((db) => db.query(`INSERT INTO user_sites (user_id, site_id) VALUES (92, 1) ON CONFLICT DO NOTHING`));
  const r4 = await notifyBatchCommitted(event({ upload_batch_id: "im4-batch-4", site_ids: [91], months: ["2026-01"] }));
  assert.equal(r4.notified, 2);
  assert.equal(await countFor(92, "im4-batch-4"), 1);
  assert.equal(await countFor(3, "im4-batch-4"), 1);

  // Leave the shared fixture as it was.
  await withDb(async (db) => {
    await db.query(`DELETE FROM notification WHERE user_id = 92`);
    await db.query(`DELETE FROM user_sites WHERE user_id = 92`);
    await db.query(`DELETE FROM "user" WHERE user_id = 92`);
    await db.query(`DELETE FROM site WHERE site_id = 91`);
  });
});

test("another company's site ids never reach company 1 managers, and the listener never fails the emit", async () => {
  const r = await notifyBatchCommitted(event({ upload_batch_id: "im4-batch-7", company_id: 2, created_by: 4, site_ids: [1, 2, 3] }));
  // Only company 2's own site (3) counts → other manager 6, once.
  assert.equal(r.notified, 1);
  assert.equal(await countFor(6, "im4-batch-7"), 1);
  assert.equal(await countFor(2, "im4-batch-7"), 0);

  registerUploadNotifyListener();
  writer.onBatchCommitted(async () => {
    throw new Error("listener boom");
  });
  await assert.doesNotReject(writer.emitBatchCommitted(event({ upload_batch_id: "im4-batch-5" })));
  assert.equal(await countFor(2, "im4-batch-5"), 1);
  // Emitting the same batch twice (a retry) does not double up in this test's listener set.
  writer.clearBatchCommittedListeners();
});

test("internal batch-committed hook: service key required, body validated", async () => {
  const body = event({ upload_batch_id: "im4-batch-6", channel: "bulk_upload" });
  assert.equal((await call("POST", "/internal/imports/batch-committed", null, body)).status, 401);
  assert.equal((await call("POST", "/internal/imports/batch-committed", "superadmin", body)).status, 401);
  const key = process.env.AI_SERVICE_KEY; // set by ci/api/run.cjs
  const bad = await call("POST", "/internal/imports/batch-committed", null, { ...body, site_ids: [] }, { "X-Service-Key": key });
  assert.equal(bad.status, 400);
  const ok = await call("POST", "/internal/imports/batch-committed", null, body, { "X-Service-Key": key });
  assert.equal(ok.status, 202);
  assert.deepEqual(ok.json, { notified: 1, emailed: 1 });
  assert.equal(await countFor(2, "im4-batch-6"), 1);
});

test("two concurrent emits for one batch leave exactly one notification per manager", async () => {
  const e = event({ upload_batch_id: "im4-batch-8" });
  const [a, b] = await Promise.all([notifyBatchCommitted(e), notifyBatchCommitted(e)]);
  assert.equal(a.notified + b.notified, 1, "one of the two wrote it, the other hit the unique index or the pre-check");
  assert.equal(await countFor(2, "im4-batch-8"), 1);
  // Belt and braces: the index itself refuses a second row.
  await assert.rejects(
    withDb((db) =>
      db.query(
        `INSERT INTO notification (user_id, type, title, message, link, meta, read) VALUES (2, 'UPLOAD_PENDING', 't', 'm', NULL, '{"upload_batch_id":"im4-batch-8"}', false)`
      )
    ),
    /notification_upload_batch_user_uq/
  );
});
