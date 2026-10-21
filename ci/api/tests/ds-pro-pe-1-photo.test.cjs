// PE-1 · background remover: POST /studio/assets/:id/remove-background and GET /studio/image-jobs/:id
// (docs/design-studio/pro/PE-1.md, decision E1). The API server runs with NODE_ENV=test and no
// STUDIO_BG_MODEL_PATH, so the deterministic stub engine cuts the subject out (no model, nothing
// downloaded). `x-studio-test-bg: off` stands for a server without a model (503
// DS_BG_UNAVAILABLE), `fail` for an engine that fails (job failed, reason model).
// Covered: switch off for every role; Users DS_ROLE; Admins, Managers and the Superadmin run it;
// tenant isolation (another company's asset or job is 404, and its jobs never show); SVG → 415;
// the result is a NEW PNG asset with derivedFrom and an alpha channel; the source asset stays
// byte for byte; a running job comes back instead of a second one; migrate:ds-pro-pe-1-photo is
// idempotent. Asset routes carry no report kind, so KPI tracking (DS_KIND_OFF) doesn't apply.
//
// Fixture: company 1 (user 1, manager 2, admin 3), company 2 (other user 4, other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const sharp = require(path.resolve(__dirname, "../../../node_modules/sharp"));
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript } = require("./ds-lib.cjs");

const UUID0 = "00000000-0000-4000-8000-000000000000";
const clean = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM report_image_job WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM report_asset WHERE company_id IN (1, 2)`);
  });
const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
};
let firstRun;
let secondRun;
test.before(async () => {
  firstRun = runScript("migrateDsProPe1Photo");
  secondRun = runScript("migrateDsProPe1Photo");
  await reset();
  await clean();
});
test.after(async () => {
  await reset();
  await clean();
});

/** A blue square on a white page: the stub keeps the square and clears the white. */
const subject = async (size = 60, square = "#1f2a44") => {
  const bg = await sharp({ create: { width: size, height: size, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const sq = await sharp({ create: { width: size / 2, height: size / 2, channels: 3, background: square } }).png().toBuffer();
  return sharp(bg).composite([{ input: sq, left: size / 4, top: size / 4 }]).jpeg({ quality: 95 }).toBuffer();
};
const form = (bytes, name = "photo.jpg") => {
  const f = new FormData();
  f.append("file", new Blob([bytes]), name);
  return f;
};
const upload = async (who = "manager", bytes) => {
  const r = await call("POST", "/studio/assets", who, form(bytes ?? (await subject())));
  assert.ok(r.status === 201 || r.status === 200, `upload ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};
const waitJob = async (id, who = "manager", suffix = "") => {
  for (let i = 0; i < 100; i++) {
    const r = await call("GET", `/studio/image-jobs/${id}${suffix}`, who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (r.json.status === "done" || r.json.status === "failed") return r.json;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`image job ${id} didn't finish`);
};

test("migrate:ds-pro-pe-1-photo runs twice and leaves the table and columns in place", async () => {
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  const cols = await withDb(async (db) => (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'report_asset' AND column_name IN ('derived_from', 'derived_op') ORDER BY 1`)).rows.map((r) => r.column_name));
  assert.deepEqual(cols, ["derived_from", "derived_op"]);
  const t = await withDb(async (db) => (await db.query(`SELECT to_regclass('report_image_job') AS t`)).rows[0].t);
  assert.equal(t, "report_image_job");
});

test("switch off: both routes answer DS_STUDIO_OFF for every role; Users get DS_ROLE once it's on", async () => {
  await setStudio(1, false);
  for (const who of ["user", "admin", "manager"]) {
    for (const [m, p, b] of [
      ["POST", `/studio/assets/${UUID0}/remove-background`, {}],
      ["GET", "/studio/image-jobs/1", undefined],
    ]) {
      const r = await call(m, p, who, b);
      assert.equal(r.status, 403, `${who} ${m} ${p}`);
      assert.equal(r.json.code, "DS_STUDIO_OFF");
    }
  }
  const sa = await call("POST", `/studio/assets/${UUID0}/remove-background?company_id=1`, "superadmin", { company_id: 1 });
  assert.equal(sa.json.code, "DS_STUDIO_OFF");
  await setStudio(1, true);
  for (const [m, p, b] of [
    ["POST", `/studio/assets/${UUID0}/remove-background`, {}],
    ["GET", "/studio/image-jobs/1", undefined],
  ]) {
    const r = await call(m, p, "user", b);
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "DS_ROLE");
  }
  const none = await call("POST", `/studio/assets/${UUID0}/remove-background`, "manager", {});
  assert.equal(none.status, 404);
  assert.equal(none.json.code, "DS_DOC_NOT_FOUND");
  const junk = await call("POST", `/studio/assets/not-a-uuid/remove-background`, "manager", {});
  assert.equal(junk.status, 404);
  const extra = await call("POST", `/studio/assets/${UUID0}/remove-background`, "manager", { mode: "fast" });
  assert.equal(extra.status, 400);
  assert.equal(extra.json.code, "DS_VALIDATION");
});

test("remove background: a NEW PNG with derivedFrom and a transparent background; the source stays as it was", async () => {
  await setStudio(1, true);
  const src = await upload("manager");
  const before = await call("GET", `/studio/assets/${src.id}/file`, "manager");
  const start = await call("POST", `/studio/assets/${src.id}/remove-background`, "manager", {});
  assert.equal(start.status, 202, JSON.stringify(start.json));
  assert.deepEqual(Object.keys(start.json).sort(), ["assetId", "createdAt", "errorCode", "errorReason", "finishedAt", "id", "kind", "resultAssetId", "status"]);
  assert.equal(start.json.kind, "remove_background");
  assert.equal(start.json.assetId, src.id);
  assert.ok(["queued", "running", "done"].includes(start.json.status));
  const job = await waitJob(start.json.id);
  assert.equal(job.status, "done", JSON.stringify(job));
  assert.equal(job.errorCode, null);
  assert.ok(job.resultAssetId && job.resultAssetId !== src.id);
  assert.ok(job.finishedAt);

  const list = (await call("GET", "/studio/assets", "manager")).json;
  const out = list.find((a) => a.id === job.resultAssetId);
  const orig = list.find((a) => a.id === src.id);
  assert.ok(out && orig, "both the cut-out and the original are in Uploads");
  assert.deepEqual(out.derivedFrom, { assetId: src.id, op: "remove_background" });
  assert.equal(orig.derivedFrom, undefined);
  assert.deepEqual([out.mime, out.w, out.h, out.kind], ["image/png", 60, 60, "image"]);

  const file = await call("GET", `/studio/assets/${out.id}/file`, "manager");
  assert.equal(file.status, 200);
  const { data, info } = await sharp(file.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4, "the result has an alpha channel");
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  assert.equal(alphaAt(2, 2), 0, "the white background is cleared");
  assert.equal(alphaAt(30, 30), 255, "the subject is kept");

  const after = await call("GET", `/studio/assets/${src.id}/file`, "manager");
  assert.ok(after.buffer.equals(before.buffer), "the original's bytes didn't change");
  const row = await withDb(async (db) => (await db.query(`SELECT derived_from, derived_op FROM report_asset WHERE id = $1`, [out.id])).rows[0]);
  assert.deepEqual(row, { derived_from: src.id, derived_op: "remove_background" });
});

test("roles: Admins and the Superadmin (naming the company) run it; a running job comes back instead of a second one", async () => {
  await setStudio(1, true);
  const src = await upload("admin", await subject(80, "#aa2222"));
  const a = await call("POST", `/studio/assets/${src.id}/remove-background`, "admin", {});
  assert.equal(a.status, 202, JSON.stringify(a.json));
  const again = await call("POST", `/studio/assets/${src.id}/remove-background?company_id=1`, "superadmin", { company_id: 1 });
  assert.equal(again.status, 202);
  const rows = await withDb(async (db) => (await db.query(`SELECT id, status FROM report_image_job WHERE asset_id = $1 ORDER BY id`, [src.id])).rows);
  if (rows.some((r) => r.status === "queued" || r.status === "running")) assert.equal(again.json.id, a.json.id, "the same job while it runs");
  const done = await waitJob(a.json.id, "admin");
  assert.equal(done.status, "done");
  const sa = await call("GET", `/studio/image-jobs/${a.json.id}?company_id=1`, "superadmin");
  assert.equal(sa.status, 200);
  assert.equal(sa.json.resultAssetId, done.resultAssetId);
  const noCompany = await call("GET", `/studio/image-jobs/${a.json.id}`, "superadmin");
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.json.code, "DS_COMPANY_REQUIRED");
});

test("tenant isolation: another company's asset and job answer 404; nothing of company 1 is touched", async () => {
  await setStudio(1, true);
  await setStudio(2, true);
  const src = await upload("manager", await subject(40, "#225522"));
  const job = await waitJob((await call("POST", `/studio/assets/${src.id}/remove-background`, "manager", {})).json.id);
  for (const who of ["otherManager", "otherUser"]) {
    const r = await call("POST", `/studio/assets/${src.id}/remove-background`, who, {});
    assert.equal(r.status, who === "otherUser" ? 403 : 404, who);
    const j = await call("GET", `/studio/image-jobs/${job.id}`, who);
    assert.equal(j.status, who === "otherUser" ? 403 : 404, who);
  }
  // A company 2 manager naming company 1 is refused like everyone else.
  const named = await call("POST", `/studio/assets/${src.id}/remove-background?company_id=1`, "otherManager", { company_id: 1 });
  assert.equal(named.status, 404);
  const n = await withDb(async (db) => (await db.query(`SELECT count(*)::int n FROM report_image_job WHERE company_id = 2`)).rows[0].n);
  assert.equal(n, 0);
  const sa2 = await call("GET", `/studio/image-jobs/${job.id}?company_id=2`, "superadmin");
  assert.equal(sa2.status, 404, "a Superadmin in company 2 doesn't see company 1's job");
});

test("unavailable, wrong type and failures: 503 DS_BG_UNAVAILABLE, 415 for SVG, a failed job with its reason", async () => {
  await setStudio(1, true);
  const src = await upload("manager", await subject(40, "#333399"));
  const off = await call("POST", `/studio/assets/${src.id}/remove-background`, "manager", {}, { "x-studio-test-bg": "off" });
  assert.equal(off.status, 503);
  assert.deepEqual([off.json.code, off.json.message], ["DS_BG_UNAVAILABLE", "Background remover isn't set up on this server yet."]);

  const svg = await call("POST", "/studio/assets", "manager", form(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>`), "a.svg"));
  assert.equal(svg.status, 201, JSON.stringify(svg.json));
  const t = await call("POST", `/studio/assets/${svg.json.id}/remove-background`, "manager", {});
  assert.equal(t.status, 415);
  assert.equal(t.json.code, "DS_ASSET_TYPE");

  const bad = await call("POST", `/studio/assets/${src.id}/remove-background`, "manager", {}, { "x-studio-test-bg": "fail" });
  assert.equal(bad.status, 202);
  const failed = await waitJob(bad.json.id);
  assert.deepEqual([failed.status, failed.errorCode, failed.errorReason, failed.resultAssetId], ["failed", "DS_JOB_FAILED", "model", null]);
  const count = await withDb(async (db) => (await db.query(`SELECT count(*)::int n FROM report_asset WHERE derived_from = $1`, [src.id])).rows[0].n);
  assert.equal(count, 0, "a failed job stores nothing");
});

test("the original can't be deleted while a draft still names it as the image's original", async () => {
  await setStudio(1, true);
  const src = await upload("manager", await subject(40, "#884400"));
  const job = await waitJob((await call("POST", `/studio/assets/${src.id}/remove-background`, "manager", {})).json.id);
  const tpl = await withDb(async (db) => (await db.query(`SELECT id FROM report_template WHERE company_id IS NULL AND kind = 'ghg' AND is_active ORDER BY id LIMIT 1`)).rows[0]);
  assert.ok(tpl, "a GHG system template is seeded (migrate:ds-4-library)");
  const created = await call("POST", "/studio/docs", "manager", { kind: "ghg", templateId: tpl.id, year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], inputs: {}, ai: false, title: "PE-1 originals" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const d = created.json;
  const page = d.doc.pages.find((p) => p.kind === "freeform");
  page.elements.push({ id: "pe1-img", type: "image", frame: { x: 10, y: 10, w: 40, h: 40, rotation: 0 }, z: 99, source: "user", props: { assetId: job.resultAssetId, originalAssetId: src.id, fit: "cover", alt: "Cut out", adjust: { brightness: 12 }, filter: "vivid", duotone: { dark: "#0b223a", light: "#2572c0" } } });
  d.doc.assets = [...(d.doc.assets ?? []), { id: job.resultAssetId, kind: "image", w: 40, h: 40, alt: "Cut out" }];
  const saved = await call("PATCH", `/studio/docs/${d.id}`, "manager", { rev: d.rev, doc: d.doc });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const del = await call("DELETE", `/studio/assets/${src.id}`, "manager");
  assert.equal(del.status, 400);
  assert.equal(del.json.details.reason, "ASSET_IN_USE");
  await call("DELETE", `/studio/docs/${d.id}`, "manager");
});
