// S3-15 part 1 (docs/scope3/modules/S3-15-review-workflow/CLAUDE.md): every
// pending row carries review checks ({ready, held}); the list filters on
// ready=1|0 and counts ready/held; bulk approve with only_ready skips rows
// that aren't ready. Checks follow inserts, edits, evidence and rejects.
//
// Runs on company 2 / site 3 (the fixture's isolated client) with its own
// activities, and removes everything it created.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");

const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));
const { refreshChecks, computeChecksFor } = require(path.resolve("dist/scope3/review/service.js"));

const SITE = 3; // company 2; user 4 enters, manager 6 reviews
const DIESEL = "CI S3-15 Diesel";
const GAS = "CI S3-15 Gas";
const PLAN = "44444444-4444-4444-8444-000000000315";
const created = [];

const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const checksOf = async (id) => (await q("SELECT checks FROM emission WHERE pk_id = $1", [id]))[0].checks;
const add = async (date, value, over = {}) => {
  const body = { site_id: SITE, category_id: 1, date_of_reporting: date, activity_data_unit: "litre", activity_data: { emission_category: DIESEL, activity_value: String(value) }, ...over };
  const res = await call("POST", "/user/emissions", "otherUser", body);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  created.push(res.json.emission.pk_id);
  return res.json.emission.pk_id;
};
const attach = async (emissionId) => {
  const form = new FormData();
  form.append("file", new Blob([`evidence for ${emissionId}`], { type: "application/pdf" }), `s3-15-${emissionId}.pdf`);
  form.append("emission_id", String(emissionId));
  const res = await call("POST", "/user/documents", "otherUser", form);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.document.document_id;
};

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
      (9151, ${SITE}, 1, 2025, 2680.0000, 'litre', 'CI', '${DIESEL}', '${DIESEL}'),
      (9152, ${SITE}, 1, 2024, 183.0000, 'kwh', 'CI', '${GAS}', '${GAS}')`);
  });
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM emission_document WHERE emission_id = ANY($1)`, [created]);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'emission' AND entity_id = ANY($1)`, [created]);
    await db.query(`DELETE FROM notification WHERE user_id IN (4, 6) AND created_at > now() - interval '1 hour'`).catch(() => undefined);
    await db.query(`DELETE FROM emission WHERE pk_id = ANY($1)`, [created]);
    await db.query(`DELETE FROM import_plan WHERE plan_id = $1`, [PLAN]);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (9151, 9152)`);
  });
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

test("a typed row gets checks on insert; evidence makes a clean row ready", async () => {
  const feb = await add("2026-02-10", 100);
  assert.deepEqual(await checksOf(feb), { ready: false, held: ["EVIDENCE_ATTACHED"] }, "no previous month passes the threshold");
  const doc = await attach(feb);
  assert.deepEqual(await checksOf(feb), { ready: true, held: [] });

  // Removing the evidence holds it again.
  assert.equal((await call("DELETE", `/user/documents/${doc}`, "otherUser")).status, 200);
  assert.deepEqual((await checksOf(feb)).held, ["EVIDENCE_ATTACHED"]);
  await attach(feb);
});

test("WITHIN_THRESHOLD compares the month with the previous one; another row or a reject in the month re-checks it", async () => {
  const marA = await add("2026-03-10", 103); // +3 % on February
  await attach(marA);
  assert.deepEqual(await checksOf(marA), { ready: true, held: [] });

  const marB = await add("2026-03-20", 50); // March now 153 vs 100
  await attach(marB);
  assert.deepEqual((await checksOf(marA)).held, ["WITHIN_THRESHOLD"], "the earlier March row is re-checked");
  assert.deepEqual((await checksOf(marB)).held, ["WITHIN_THRESHOLD"]);

  // An April row compares against March; rejecting the March outlier re-checks both months.
  const apr = await add("2026-04-10", 104);
  await attach(apr);
  assert.deepEqual((await checksOf(apr)).held, ["WITHIN_THRESHOLD"], "104 vs 153");
  const rejected = await call("PUT", `/user/emissions/${marB}/reject`, "otherManager", { comment: "Duplicate invoice" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
  assert.deepEqual(await checksOf(marA), { ready: true, held: [] }, "March is 103 again");
  assert.deepEqual(await checksOf(apr), { ready: true, held: [] }, "104 vs 103");

  // An edit re-checks the row and the month after it.
  const edit = await call("PUT", `/user/emissions/${marA}`, "otherUser", { activity_data: { emission_category: DIESEL, activity_value: "200" }, activity_data_unit: "litre", reason: "Typo" });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.deepEqual((await checksOf(marA)).held, ["WITHIN_THRESHOLD"], "200 vs 100");
  assert.deepEqual((await checksOf(apr)).held, ["WITHIN_THRESHOLD"], "104 vs 200");
  await call("PUT", `/user/emissions/${marA}`, "otherUser", { activity_data: { emission_category: DIESEL, activity_value: "103" }, activity_data_unit: "litre", reason: "Back" });
  assert.deepEqual(await checksOf(apr), { ready: true, held: [] });
});

test("the company's change limit applies", async () => {
  await q(`INSERT INTO emission_threshold (company_id, threshold_percentage) VALUES (2, 60) ON CONFLICT (company_id) DO UPDATE SET threshold_percentage = 60`);
  try {
    const [marB] = created.slice(2, 3);
    const marA = created[1];
    await refreshChecks(AppDataSource.manager, [marA, marB]);
    // marB is rejected (not recomputed); March is 103 vs 100 either way: still ready.
    assert.deepEqual(await checksOf(marA), { ready: true, held: [] });
    const may = await add("2026-05-10", 150); // +44 % on April's 104, inside 60 %
    await attach(may);
    assert.deepEqual(await checksOf(may), { ready: true, held: [] });
  } finally {
    await q(`DELETE FROM emission_threshold WHERE company_id = 2`);
  }
});

test("only_ready recomputes stale checks: a lowered change limit holds a row stored as ready", async () => {
  const may = created[created.length - 1];
  assert.deepEqual(await checksOf(may), { ready: true, held: [] }, "stored verdict from the 60 % limit");
  const res = await call("PUT", "/user/emissions/bulk-approve", "otherManager", { ids: [may], only_ready: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json.approved, []);
  assert.deepEqual(res.json.skipped, [{ id: may, held: ["WITHIN_THRESHOLD"] }], "44 % is over the default 5 %");
  assert.deepEqual((await checksOf(may)).held, ["WITHIN_THRESHOLD"], "the fresh verdict is stored");
  assert.equal((await q("SELECT status FROM emission WHERE pk_id = $1", [may]))[0].status, "pending");
});

test("NO_DUPLICATE, FACTOR_FOUND and UNIT_OK hold rows", async () => {
  // Typed entries refuse a same-date duplicate (409), so the pair is made the
  // way older uploads leave them: a second row moved onto the same date.
  const one = await add("2026-06-15", 10);
  const two = await add("2026-06-16", 10);
  assert.ok(!(await checksOf(one)).held.includes("NO_DUPLICATE"));
  await q(`UPDATE emission SET date_of_reporting = '2026-06-15' WHERE pk_id = $1`, [two]);
  await refreshChecks(AppDataSource.manager, [two]);
  assert.ok((await checksOf(one)).held.includes("NO_DUPLICATE"), "both rows of the pair are held (same month re-checked)");
  assert.ok((await checksOf(two)).held.includes("NO_DUPLICATE"));

  const fallback = await add("2026-01-31", 5, { activity_data_unit: "kwh", activity_data: { emission_category: GAS, activity_value: "5" } });
  assert.ok((await checksOf(fallback)).held.includes("FACTOR_FOUND"), "a 2024 factor for a 2026 row is a fallback year");

  const noUnit = await add("2026-07-15", 5, { activity_data_unit: undefined });
  const held = (await checksOf(noUnit)).held;
  assert.ok(held.includes("UNIT_OK") && held.includes("FACTOR_FOUND"), JSON.stringify(held));
});

test("IMPORT_MATCH_SURE reuses the XI5 rule", async () => {
  const id = await add("2026-08-15", 10);
  await attach(id);
  await q(`INSERT INTO import_plan (plan_id, company_id, created_by, channel, source_name, status, version, upload_batch_id, expires_at)
           VALUES ($1, 2, 4, 'bulk_upload', 's3-15.xlsx', 'committed', 1, 's3-15-batch', now())`, [PLAN]);
  await q(`INSERT INTO import_plan_row (plan_id, row_ref, position, input, state, issues, result) VALUES ($1, 'Fuel!B2', 0, $2::jsonb, 'ready', '[]', '{}')`, [
    PLAN,
    JSON.stringify({ row_ref: "Fuel!B2", site_id: SITE, category_id: 1, period: { kind: "monthly", date: "2026-08-15" }, activity_name: DIESEL, activity_value: 10, activity_unit: "litre", meta: { source: "llm", confidence: 0.5 } }),
  ]);
  await q(`UPDATE emission SET upload_batch_id = 's3-15-batch', extra_data = '{"import": {"channel": "bulk_upload", "row_ref": "Fuel!B2"}}' WHERE pk_id = $1`, [id]);
  const computed = await computeChecksFor(AppDataSource.manager, [id]);
  assert.deepEqual(computed.get(id), { ready: false, held: ["IMPORT_MATCH_SURE"] });
});

test("the list filters on ready and counts ready and held; only_ready approves just the ready rows", async () => {
  // Store fresh verdicts first (the IMPORT_MATCH_SURE row above was only computed, not stored).
  await refreshChecks(AppDataSource.manager, created);
  const pending = (await q(`SELECT pk_id, checks FROM emission WHERE pk_id = ANY($1) AND status = 'pending' ORDER BY pk_id`, [created])).map((r) => ({ id: Number(r.pk_id), ready: r.checks?.ready === true }));
  const readyIds = pending.filter((r) => r.ready).map((r) => r.id);
  const heldIds = pending.filter((r) => !r.ready).map((r) => r.id);
  assert.ok(readyIds.length >= 3 && heldIds.length >= 3, JSON.stringify(pending));

  const ready = await call("GET", `/user/emissions?siteIds=${SITE}&page=1&limit=100&ready=1`, "otherManager");
  assert.equal(ready.status, 200, JSON.stringify(ready.json));
  const listed = ready.json.data.filter((e) => created.includes(e.pk_id));
  assert.deepEqual(listed.map((e) => e.pk_id).sort((a, b) => a - b), readyIds);
  assert.ok(listed.every((e) => e.checks && e.checks.ready === true), "rows carry their checks");
  const all = await call("GET", `/user/emissions?siteIds=${SITE}&page=1&limit=100`, "otherManager");
  assert.ok(all.json.summary.ready >= readyIds.length);
  assert.ok(all.json.summary.held >= heldIds.length);
  assert.equal(all.json.summary.attention, undefined, "attention stays the XI5 batch count");

  const held = await call("GET", `/user/emissions?siteIds=${SITE}&page=1&limit=100&ready=0`, "otherManager");
  assert.ok(heldIds.every((id) => held.json.data.some((e) => e.pk_id === id)));
  assert.ok(held.json.data.every((e) => e.status === "pending"), "ready=0 lists only pending rows");
  assert.equal((await call("GET", `/user/emissions?siteIds=${SITE}&ready=maybe`, "otherManager")).status, 400);

  const res = await call("PUT", "/user/emissions/bulk-approve", "otherManager", { ids: [...readyIds, ...heldIds], only_ready: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([...res.json.approved].sort((a, b) => a - b), readyIds);
  assert.deepEqual(res.json.skipped.map((s) => s.id).sort((a, b) => a - b), heldIds);
  assert.ok(res.json.skipped.every((s) => Array.isArray(s.held)));
  const statuses = await q(`SELECT pk_id, status FROM emission WHERE pk_id = ANY($1)`, [heldIds]);
  assert.ok(statuses.every((r) => r.status === "pending"), "held rows stay pending");

  const none = await call("PUT", "/user/emissions/bulk-approve", "otherManager", { ids: heldIds, only_ready: true });
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.approved, []);
});

test("company 1 can't read or approve company 2's checks", async () => {
  const heldIds = (await q(`SELECT pk_id FROM emission WHERE pk_id = ANY($1) AND status = 'pending'`, [created])).map((r) => Number(r.pk_id));
  const list = await call("GET", `/user/emissions?siteIds=${SITE}&page=1&limit=10&ready=0`, "manager");
  assert.equal(list.status, 403);
  const approve = await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: heldIds, only_ready: true });
  assert.ok([403, 404].includes(approve.status), String(approve.status));
  const statuses = await q(`SELECT status FROM emission WHERE pk_id = ANY($1)`, [heldIds]);
  assert.ok(statuses.every((r) => r.status === "pending"));
});
