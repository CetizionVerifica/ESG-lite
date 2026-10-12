// IM2 import plans API (docs/mcp-import/backend/IM2-import-plans-api/CLAUDE.md):
// a plan is created from rows, re-checked on every change, and commits as one
// pending upload batch. Runs on IM1's emission write service (part 2) with
// the factors below: Diesel 2680 kg/litre on sites 1 and 2, Grid Electricity
// 708 kg/kWh on site 1, so 1,500 litre of Diesel is 4.02 tCO2e.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const { call, withDb } = require("../helpers.cjs");

let seq = 0;
// Each default row lands in its own month (Jan–Jun 2025), so rows of one plan don't read as duplicates of each other.
const row = (over = {}) => ({
  row_ref: `Sheet1!B${++seq}`,
  site_id: 1,
  category_id: 1,
  period: { kind: "monthly", date: `2025-0${1 + (seq % 6)}-01` },
  activity_name: "Diesel",
  activity_value: 1500,
  activity_unit: "litre",
  ...over,
});

test.before(async () => {
  await withDb((db) =>
    db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name) VALUES
      (920, 1, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (921, 2, 1, 2024, 2680.0000, 'litre', 'CI', 'Diesel', 'Diesel'),
      (922, 1, 2, 2024, 708.0000, 'kwh', 'CI', 'Grid Electricity', 'Grid Electricity'),
      (923, 1, 1, 2023, 2650.0000, 'litre', 'CI', 'Diesel', 'Diesel')`),
  );
});

test.after(async () => {
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'category_mapping'`);
    await db.query(`DELETE FROM emission_category_mapping WHERE company_category_name IN ('Unknown diesel', 'Unknown petrol', 'Pinned diesel')`);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (920, 921, 922, 923)`);
  });
});

const create = (who, rows, extra = {}) => call("POST", "/imports/plans", who, { source_name: "fuel.xlsx", channel: "api", rows, ...extra });

// Rows a test saved are removed again, so the suites after this one keep their numbers.
const dropBatch = (batchId) => withDb((db) => db.query(`DELETE FROM emission WHERE upload_batch_id = $1`, [batchId]));

const emissionCount = (batchId) =>
  withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission WHERE upload_batch_id = $1`, [batchId])).rows[0].n));

test("create: rows are planned, issues come first, totals come from the writer", async () => {
  const june = { kind: "monthly", date: "2025-06-01" };
  const res = await create("manager", [
    row({ row_ref: "a", activity_name: "diesel", activity_value: 2000, period: june }),
    row({ row_ref: "b", activity_name: "Unknown fuel", period: june }),
    row({ row_ref: "c", category_id: 2, activity_name: "Grid Electricity", activity_value: 500, activity_unit: "kWh", total_emission: 99, period: june }),
    row({ row_ref: "d", activity_name: "Diesel ", activity_value: 0, period: june }),
    row({ row_ref: "e", period: { kind: "yearly", year_type: "FY", year: 2024 }, activity_value: 1000 }),
    row({ row_ref: "f", activity_name: "DIESEL", activity_value: 10, activity_unit: "gallon", period: june }),
  ]);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const plan = res.json;
  assert.equal(plan.status, "draft");
  assert.equal(plan.version, 1);
  assert.equal(plan.company_id, 1);
  assert.deepEqual(plan.counts, { rows: 6, ready: 4, issue: 2, skipped: 0, warnings: 2 });
  // 2000 l × 2.68 + 500 kWh × 0.708 + 1000 l × 2.65 (the FY 2024 row takes the 2023 factor) + 10 gal (37.8541 l) × 2.68
  assert.equal(plan.totals.tco2e, 8465.45);
  assert.deepEqual(plan.totals.by_month.map((m) => m.month), ["2024-03", "2025-06"], "FY 2024 ends 31 March 2024");
  assert.deepEqual(plan.totals.by_category.map((c) => [c.category_id, c.name, c.tco2e, c.rows]), [[1, "Stationary Combustion", 8111.45, 3], [2, "Purchased Electricity", 354, 1]]);
  assert.deepEqual(plan.issues_summary.map((i) => [i.code, i.count]).sort(), [["CLIENT_TOTAL_IGNORED", 1], ["DUPLICATE_IN_PLAN", 1], ["NON_POSITIVE_VALUE", 1], ["UNKNOWN_ACTIVITY", 1]]);
  assert.deepEqual(plan.rows.map((r) => r.row_ref), ["b", "d", "a", "c", "e", "f"]);
  const a = plan.rows.find((r) => r.row_ref === "a");
  assert.deepEqual([a.result.activity.matched_by, a.result.activity.factor_name, a.result.factor.value, a.result.total_tco2e], ["factor", "Diesel", 2680, 5360]);
  const c = plan.rows.find((r) => r.row_ref === "c");
  assert.equal(c.state, "ready");
  assert.equal("total_emission" in c.input, false, "total-like keys are stripped");
  assert.equal(c.issues[0].code, "CLIENT_TOTAL_IGNORED");
  const d = plan.rows.find((r) => r.row_ref === "d");
  assert.deepEqual(d.issues.map((i) => [i.code, i.severity]), [["NON_POSITIVE_VALUE", "error"]]);
  const f = plan.rows.find((r) => r.row_ref === "f");
  assert.deepEqual(f.issues.map((i) => [i.code, i.severity]), [["DUPLICATE_IN_PLAN", "warning"]], "same site, category, month and activity as row a");
  assert.deepEqual([f.result.conversion, f.result.total_tco2e], [3.78541, 101.45]);
  const e = plan.rows.find((r) => r.row_ref === "e");
  assert.deepEqual([e.result.reporting_date, e.result.reporting_period, e.result.year_type, e.result.factor.year, e.result.total_tco2e], ["2024-03-31", "yearly", "FY", 2023, 2650]);
  assert.match(plan.expires_at, /T/);
});

test("validation: bad rows, duplicate row_ref and the per-request limit", async () => {
  assert.equal((await create("manager", [row({ period: { kind: "monthly" } })])).status, 400);
  const bad = await create("manager", [row({ activity_value: "12" })]);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "IMPORT_VALIDATION");
  const dupe = await create("manager", [row({ row_ref: "x" }), row({ row_ref: "x" })]);
  assert.equal(dupe.status, 422);
  assert.deepEqual([dupe.json.code, dupe.json.details.row_refs], ["IMPORT_DUPLICATE_ROW_REF", ["x"]]);
  const many = await create("manager", Array.from({ length: 2001 }, () => row()));
  assert.equal(many.status, 413);
  assert.equal(many.json.code, "IMPORT_TOO_MANY_ROWS");
  const notes = await create("manager", [row({ notes: "n".repeat(501) })]);
  assert.equal(notes.status, 400);
});

test("scope: a User can only plan their own site and granted categories; Superadmin names the client", async () => {
  const user = await create("user", [row({ row_ref: "own" }), row({ row_ref: "other", site_id: 2 })]);
  assert.equal(user.status, 201);
  assert.deepEqual(user.json.rows.map((r) => [r.row_ref, r.state, r.issues[0]?.code]), [["other", "issue", "SITE_NOT_ALLOWED"], ["own", "ready", undefined]]);

  const granted = await create("multiSiteUser", [row({ row_ref: "ok", category_id: 2, activity_name: "Grid Electricity", activity_unit: "kWh" }), row({ row_ref: "no", category_id: 3 })]);
  assert.equal(granted.status, 201);
  assert.equal(granted.json.rows.find((r) => r.row_ref === "no").issues[0].code, "CATEGORY_NOT_ASSIGNED");
  assert.equal(granted.json.rows.find((r) => r.row_ref === "ok").state, "ready");

  const noCompany = await create("superadmin", [row()]);
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.json.code, "IMPORT_COMPANY_REQUIRED");
  const sa = await create("superadmin", [row({ row_ref: "c1" }), row({ row_ref: "c2", site_id: 3 })], { company_id: 1 });
  assert.equal(sa.status, 201);
  assert.equal(sa.json.rows.find((r) => r.row_ref === "c2").issues[0].code, "SITE_NOT_ALLOWED", "client 2's site never lands under client 1");

  const wrongClient = await create("admin", [row()], { company_id: 2 });
  assert.equal(wrongClient.status, 403);
  assert.equal(wrongClient.json.code, "IMPORT_FORBIDDEN");
  assert.equal((await call("POST", "/imports/plans", null, { source_name: "x", channel: "api", rows: [] })).status, 401);
});

test("channel mcp: Superadmin only, and only when the client's switch is on", async () => {
  const admin = await create("admin", [row()], { channel: "mcp" });
  assert.equal(admin.status, 403);
  assert.equal(admin.json.code, "MCP_SUPERADMIN_ONLY");
  // The switch (company.mcp_enabled, IM5) is off by default, and reads as off before its migration exists.
  const sa = await create("superadmin", [row()], { channel: "mcp", company_id: 1 });
  assert.equal(sa.status, 403);
  assert.equal(sa.json.code, "MCP_DISABLED_FOR_CLIENT");
});

test("tenant isolation: another client's people get 404 on the plan, not 403", async () => {
  const { json: plan } = await create("manager", [row()]);
  for (const who of ["otherManager", "otherUser"]) {
    assert.equal((await call("GET", `/imports/plans/${plan.plan_id}`, who)).status, 404, who);
    assert.equal((await call("PATCH", `/imports/plans/${plan.plan_id}`, who, { version: plan.version, changes: [{ row_ref: "x", skip: true }] })).status, 404, who);
    assert.equal((await call("POST", `/imports/plans/${plan.plan_id}/commit`, who, { version: plan.version, skip_rows_with_issues: false, idempotency_key: "k" })).status, 404, who);
  }
  // Same client, a different person: drafts are private to their creator.
  assert.equal((await call("GET", `/imports/plans/${plan.plan_id}`, "admin")).status, 404);
  // A Superadmin sees it.
  assert.equal((await call("GET", `/imports/plans/${plan.plan_id}`, "superadmin")).status, 200);
  assert.equal((await call("GET", `/imports/plans/${randomUUID()}`, "superadmin")).status, 404);
  assert.equal((await call("GET", `/imports/plans/not-a-uuid`, "superadmin")).status, 404);
});

test("append, page and filter", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "r1" }), row({ row_ref: "r2", activity_name: "unknown" })]);
  const stale = await call("POST", `/imports/plans/${plan.plan_id}/rows`, "manager", { version: plan.version - 1, rows: [row({ row_ref: "r3" })] });
  assert.equal(stale.status, 409);
  assert.deepEqual([stale.json.code, stale.json.details.current_version], ["IMPORT_PLAN_VERSION_CONFLICT", plan.version]);
  const dupe = await call("POST", `/imports/plans/${plan.plan_id}/rows`, "manager", { version: plan.version, rows: [row({ row_ref: "r1" })] });
  assert.equal(dupe.status, 422);
  const ok = await call("POST", `/imports/plans/${plan.plan_id}/rows`, "manager", { version: plan.version, rows: [row({ row_ref: "r3" }), row({ row_ref: "r4", activity_value: -1 })] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.version, plan.version + 1);
  assert.deepEqual(ok.json.counts, { rows: 4, ready: 2, issue: 2, skipped: 0, warnings: 0 });

  const page = await call("GET", `/imports/plans/${plan.plan_id}?page_size=2&page=2`, "manager");
  assert.equal(page.status, 200);
  assert.deepEqual([page.json.page, page.json.page_size, page.json.total_rows], [2, 2, 4]);
  assert.deepEqual(page.json.rows.map((r) => r.row_ref), ["r1", "r3"]);
  const issues = await call("GET", `/imports/plans/${plan.plan_id}?state=issue`, "manager");
  assert.deepEqual(issues.json.rows.map((r) => r.row_ref), ["r2", "r4"]);
  const byCode = await call("GET", `/imports/plans/${plan.plan_id}?code=NON_POSITIVE_VALUE`, "manager");
  assert.deepEqual(byCode.json.rows.map((r) => r.row_ref), ["r4"]);
  const tooBig = await call("GET", `/imports/plans/${plan.plan_id}?page_size=999`, "manager");
  assert.deepEqual([tooBig.status, tooBig.json.code], [400, "IMPORT_VALIDATION"]);
  assert.equal((await call("GET", `/imports/plans/${plan.plan_id}?code=NOT_A_CODE`, "manager")).status, 400);
  assert.equal((await call("GET", `/imports/plans/${plan.plan_id}`, "manager")).json.page_size, 50);
});

test("patch: fix a value, skip a row, match an activity name; the plan is recalculated", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "p1", activity_value: 0 }), row({ row_ref: "p2", activity_name: "Unknown diesel" }), row({ row_ref: "p3" })]);
  const unknownRef = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: plan.version, changes: [{ row_ref: "nope", skip: true }] });
  assert.equal(unknownRef.status, 404);
  const res = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", {
    version: plan.version,
    changes: [
      { row_ref: "p1", set: { activity_value: 250 } },
      { row_ref: "p3", skip: true },
    ],
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Unknown diesel", factor_name: "Diesel", save_mapping: true }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.version, plan.version + 1);
  assert.deepEqual(res.json.counts, { rows: 3, ready: 2, issue: 0, skipped: 1, warnings: 0 });
  const p1 = res.json.rows.find((r) => r.row_ref === "p1");
  assert.deepEqual([p1.state, p1.input.activity_value, p1.result.total_tco2e], ["ready", 250, 670]);
  const p2 = res.json.rows.find((r) => r.row_ref === "p2");
  assert.deepEqual([p2.state, p2.result.activity.matched_by, p2.result.activity.factor_name], ["ready", "plan_match", "Diesel"]);
  // A Manager's save_mapping stays on the plan: no P23 mapping is written (D5).
  assert.equal(await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission_category_mapping WHERE company_category_name = 'Unknown diesel'`)).rows[0].n)), 0);
  const p3 = res.json.rows.find((r) => r.row_ref === "p3");
  assert.deepEqual([p3.state, p3.issues, p3.result], ["skipped", [], undefined]);
  // Un-skip brings the row back into the plan.
  const back = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: res.json.version, changes: [{ row_ref: "p3", skip: false }] });
  assert.equal(back.json.counts.ready, 3);
  // The row_ref can't be changed through set: the key is dropped, the row keeps its ref.
  const rename = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: back.json.version, changes: [{ row_ref: "p3", set: { row_ref: "zzz", activity_value: 10 } }] });
  assert.equal(rename.status, 200);
  assert.deepEqual(rename.json.rows.map((r) => r.row_ref).sort(), ["p1", "p2", "p3"]);
  assert.equal(rename.json.rows.find((r) => r.row_ref === "p3").input.activity_value, 10);
  // A patched row is still a whole ImportRow: an empty unit is refused, a fields-only row can't lose its fields, and a total sent through set is ignored with a warning.
  const broken = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: rename.json.version, changes: [{ row_ref: "p3", set: { activity_unit: "" } }] });
  assert.equal(broken.status, 400, JSON.stringify(broken.json));
  assert.deepEqual([broken.json.code, broken.json.details[0].path], ["IMPORT_VALIDATION", "changes.0.set.activity_unit"]);
  const { json: fieldsOnly } = await create("manager", [row({ row_ref: "f", activity_value: undefined, fields: { fuel: "HSD", litres: 5 } })]);
  const noFields = await call("PATCH", `/imports/plans/${fieldsOnly.plan_id}`, "manager", { version: fieldsOnly.version, changes: [{ row_ref: "f", set: { fields: {} } }] });
  assert.equal(noFields.status, 400, JSON.stringify(noFields.json));
  assert.equal(noFields.json.details[0].path, "f.activity_value");
  const totalled = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: rename.json.version, changes: [{ row_ref: "p3", set: { activity_value: 20, total_emission: 999 } }] });
  assert.equal(totalled.status, 200, JSON.stringify(totalled.json));
  const p3Again = totalled.json.rows.find((r) => r.row_ref === "p3");
  assert.deepEqual([p3Again.input.activity_value, p3Again.result.total_tco2e, p3Again.issues.map((i) => i.code)], [20, 53.6, ["CLIENT_TOTAL_IGNORED"]]);
});

test("save_mapping: a Superadmin or Admin turns a match into a P23 mapping that later plans resolve by", async () => {
  const { json: plan } = await create("admin", [row({ row_ref: "m1", activity_name: "Unknown diesel" })]);
  assert.equal(plan.rows[0].issues[0].code, "UNKNOWN_ACTIVITY");
  const outOfScope = await call("PATCH", `/imports/plans/${plan.plan_id}`, "admin", {
    version: plan.version,
    activity_matches: [{ site_id: 3, category_id: 1, sheet_name: "Unknown diesel", factor_name: "Diesel", save_mapping: true }],
  });
  assert.deepEqual([outOfScope.status, outOfScope.json.code], [403, "IMPORT_FORBIDDEN"], "another client's site is never mapped");
  const res = await call("PATCH", `/imports/plans/${plan.plan_id}`, "admin", {
    version: plan.version,
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Unknown diesel", factor_name: "Diesel", save_mapping: true }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.rows[0].state, res.json.rows[0].result.activity.matched_by], ["ready", "plan_match"]);
  const mapping = await withDb((db) => db.query(`SELECT company_id, site_id, category_id, global_category_name, emission_factor_id, created_by FROM emission_category_mapping WHERE company_category_name = 'Unknown diesel'`));
  assert.deepEqual(mapping.rows, [{ company_id: 1, site_id: 1, category_id: 1, global_category_name: "Diesel", emission_factor_id: null, created_by: 3 }]);
  // A later plan, by anyone on that site, resolves the sheet wording through the mapping.
  const later = await create("manager", [row({ row_ref: "m2", activity_name: "unknown DIESEL" })]);
  assert.deepEqual([later.json.rows[0].state, later.json.rows[0].result.activity.matched_by, later.json.rows[0].result.total_tco2e], ["ready", "mapping", 4020]);
  // Site 2 has no such mapping.
  const elsewhere = await create("manager", [row({ row_ref: "m3", site_id: 2, activity_name: "Unknown diesel" })]);
  assert.equal(elsewhere.json.rows[0].issues[0].code, "UNKNOWN_ACTIVITY");
  for (const id of [plan.plan_id, later.json.plan_id, elsewhere.json.plan_id]) await call("POST", `/imports/plans/${id}/cancel`, id === plan.plan_id ? "admin" : "manager");
  // The written mapping is audited.
  const audit = await withDb((db) => db.query(`SELECT action, changed_by, reason, changed_fields FROM audit_log WHERE entity_type = 'category_mapping' AND entity_id = (SELECT id FROM emission_category_mapping WHERE company_category_name = 'Unknown diesel')`));
  assert.equal(audit.rowCount, 1);
  assert.deepEqual([audit.rows[0].action, audit.rows[0].changed_by, audit.rows[0].changed_fields.global_category_name.new], ["create", 3, "Diesel"]);
  assert.match(audit.rows[0].reason, new RegExp(`^Saved from import plan ${plan.plan_id} \\(api\\)$`));
});

test("save_mapping: a Superadmin saves for the named client; an existing mapping (app-made, pinned) is never overwritten", async () => {
  const { json: plan } = await create("superadmin", [row({ row_ref: "s1", activity_name: "Unknown petrol" })], { company_id: 1 });
  assert.equal(plan.company_id, 1);
  const res = await call("PATCH", `/imports/plans/${plan.plan_id}`, "superadmin", {
    version: plan.version,
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Unknown petrol", factor_name: "Diesel", save_mapping: true }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const mapping = await withDb((db) => db.query(`SELECT company_id, site_id, global_category_name, emission_factor_id, created_by FROM emission_category_mapping WHERE company_category_name = 'Unknown petrol'`));
  assert.deepEqual(mapping.rows, [{ company_id: 1, site_id: 1, global_category_name: "Diesel", emission_factor_id: null, created_by: 5 }]);

  // An app-made mapping pins the 2023 Diesel factor (923). Saving the same sheet wording again is refused and the pin stays.
  await withDb((db) =>
    db.query(`INSERT INTO emission_category_mapping (company_id, company_name, site_id, category_id, company_category_name, global_category_name, emission_factor_id, created_by)
              VALUES (1, 'CI Company', 1, 1, 'Pinned diesel', 'Diesel', 923, 5)`),
  );
  const { json: adminPlan } = await create("admin", [row({ row_ref: "a1", activity_name: "Pinned diesel" })]);
  for (const [who, p] of [["superadmin", plan.plan_id], ["admin", adminPlan.plan_id]]) {
    const dup = await call("PATCH", `/imports/plans/${p}`, who, {
      version: who === "admin" ? adminPlan.version : res.json.version,
      activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Pinned diesel", factor_name: "Natural Gas", save_mapping: true }],
    });
    assert.equal(dup.status, 400, JSON.stringify(dup.json));
    assert.deepEqual([dup.json.code, dup.json.details.reason, dup.json.details.maps_to], ["IMPORT_VALIDATION", "MAPPING_EXISTS", "Diesel"], who);
  }
  await call("POST", `/imports/plans/${adminPlan.plan_id}/cancel`, "admin");
  const pinned = await withDb((db) => db.query(`SELECT global_category_name, emission_factor_id FROM emission_category_mapping WHERE company_category_name = 'Pinned diesel'`));
  assert.deepEqual(pinned.rows, [{ global_category_name: "Diesel", emission_factor_id: 923 }]);
  // Refused as a whole: the plan did not move and no plan match was stored.
  const after = await call("GET", `/imports/plans/${plan.plan_id}`, "superadmin");
  assert.equal(after.json.version, res.json.version);
  // Without save_mapping the same match is fine and stays on the plan.
  const planOnly = await call("PATCH", `/imports/plans/${plan.plan_id}`, "superadmin", {
    version: res.json.version,
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Pinned diesel", factor_name: "Diesel" }],
  });
  assert.equal(planOnly.status, 200, JSON.stringify(planOnly.json));
  await call("POST", `/imports/plans/${plan.plan_id}/cancel`, "superadmin");
});

test("commit refuses a plan with nothing ready, so no empty batch is ever written", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "only" })]);
  const { json: skipped } = await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: plan.version, changes: [{ row_ref: "only", skip: true }] });
  const res = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: skipped.version, skip_rows_with_issues: true, idempotency_key: "empty-" + plan.plan_id });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  assert.deepEqual([res.json.code, res.json.details], ["IMPORT_VALIDATION", { ready: 0, skipped: 1 }]);
  const after = await call("GET", `/imports/plans/${plan.plan_id}`, "manager");
  assert.deepEqual([after.json.status, after.json.committed], ["draft", undefined]);
  assert.equal(await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM import_plan WHERE plan_id = $1 AND upload_batch_id IS NOT NULL`, [plan.plan_id])).rows[0].n)), 0);
});

test("commit: refused with issues unless skipped; rows land pending in one batch; repeats add nothing", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "c1", activity_value: 1000 }), row({ row_ref: "c2", site_id: 2, activity_value: 3000 }), row({ row_ref: "bad", activity_name: "unknown" })]);
  const refused = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: false, idempotency_key: "k-" + plan.plan_id });
  assert.equal(refused.status, 422);
  assert.deepEqual([refused.json.code, refused.json.details.row_refs], ["IMPORT_PLAN_HAS_ISSUES", ["bad"]]);
  const stale = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: 0, skip_rows_with_issues: true, idempotency_key: "k-" + plan.plan_id });
  assert.equal(stale.status, 409);

  const key = "k-" + plan.plan_id;
  const [a, b] = await Promise.all([
    call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: true, idempotency_key: key }),
    call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: true, idempotency_key: key }),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal(a.json.status, "committed");
  assert.equal(a.json.committed.upload_batch_id, b.json.committed.upload_batch_id, "two parallel commits make one batch");
  assert.deepEqual([a.json.committed.inserted, a.json.committed.fera_inserted], [2, 0]);
  const batchId = a.json.committed.upload_batch_id;
  assert.equal(await emissionCount(batchId), 2);
  const saved = await withDb(async (db) =>
    (await db.query(`SELECT status, total_emission::float AS t, site_id, category_id, extra_data FROM emission WHERE upload_batch_id = $1 ORDER BY site_id`, [batchId])).rows,
  );
  assert.deepEqual(saved.map((s) => [s.status, s.t, s.site_id, s.category_id, s.extra_data.import.channel]), [["pending", 2680, 1, 1, "api"], ["pending", 8040, 2, 1, "api"]]);
  const audit = await withDb((db) => db.query(`SELECT reason FROM audit_log WHERE entity_type = 'emission' AND entity_id IN (SELECT pk_id FROM emission WHERE upload_batch_id = $1)`, [batchId]));
  assert.equal(audit.rowCount, 2);
  assert.match(audit.rows[0].reason, /^Imported via API by CI Manager \(batch /);

  // Same key again: same answer, no new rows. A different key: the plan is no longer a draft.
  const again = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: true, idempotency_key: key });
  assert.equal(again.json.committed.upload_batch_id, batchId);
  assert.equal(await emissionCount(batchId), 2);
  const other = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: a.json.version, skip_rows_with_issues: true, idempotency_key: "other-" + plan.plan_id });
  assert.equal(other.status, 409);
  assert.equal(other.json.code, "IMPORT_PLAN_NOT_DRAFT");
  assert.equal((await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: a.json.version, changes: [{ row_ref: "c1", skip: true }] })).json.code, "IMPORT_PLAN_NOT_DRAFT");
  assert.equal((await call("PATCH", `/imports/plans/${plan.plan_id}`, "manager", { version: a.json.version })).status, 400, "a patch needs changes or matches");

  // The batch shows in the list with its channel and counts.
  const list = await call("GET", "/imports/batches", "manager");
  assert.equal(list.status, 200);
  const mine = list.json.find((x) => x.upload_batch_id === batchId);
  assert.deepEqual(
    { channel: mine.channel, source_name: mine.source_name, rows: mine.rows, pending: mine.pending, approved: mine.approved, tco2e: mine.tco2e, site_ids: mine.site_ids, plan_id: mine.plan_id, by: mine.created_by.user_id },
    { channel: "api", source_name: "fuel.xlsx", rows: 2, pending: 2, approved: 0, tco2e: 10720, site_ids: [1, 2], plan_id: plan.plan_id, by: 2 },
  );
  // Site-scoped: the site 1 User sees it (one of its rows is theirs to see), client 2 sees nothing of it.
  assert.ok((await call("GET", "/imports/batches", "user")).json.some((x) => x.upload_batch_id === batchId));
  assert.ok(!(await call("GET", "/imports/batches", "otherManager")).json.some((x) => x.upload_batch_id === batchId));
  assert.equal((await call("GET", "/imports/batches", "superadmin")).status, 400, "Superadmin names the client");
  assert.equal((await call("GET", "/imports/batches?status=weird", "manager")).status, 400);
  assert.ok(!(await call("GET", "/imports/batches?status=mixed", "manager")).json.some((x) => x.upload_batch_id === batchId));
  const sa = await call("GET", "/imports/batches?company_id=1&channel=api&status=pending", "superadmin");
  assert.ok(sa.json.some((x) => x.upload_batch_id === batchId));
  assert.ok(!(await call("GET", "/imports/batches?company_id=2", "superadmin")).json.some((x) => x.upload_batch_id === batchId));
  assert.ok(!(await call("GET", "/imports/batches?company_id=1&channel=mcp", "superadmin")).json.some((x) => x.upload_batch_id === batchId));
  // The app's own batches endpoint (P07 source chip, MCP-14) names the channel too.
  const app = await call("GET", "/user/emissions/batches", "manager");
  assert.equal(app.status, 200);
  assert.deepEqual([...new Set(app.json.filter((x) => x.upload_batch_id === batchId).map((x) => x.channel))], ["api"]);
  assert.ok(app.json.filter((x) => x.upload_batch_id !== batchId).every((x) => x.channel === "bulk_upload"), "batches made without a plan read as bulk upload");
  await dropBatch(batchId);
});

test("commit re-checks the rows: an entry saved after planning is caught", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "late", period: { kind: "monthly", date: "2025-05-01" } })]);
  assert.equal(plan.counts.ready, 1);
  await withDb((db) =>
    db.query(
      `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, review_comment)
       VALUES ('{"emission_category": "Diesel", "activity_value": 1}', 0.001, 'tCO2e', '2025-05-15', 'pending', 1, 1, 1, 'monthly', 'im2-late')`,
    ),
  );
  const res = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: false, idempotency_key: "late-" + plan.plan_id });
  assert.equal(res.status, 409, JSON.stringify(res.json));
  assert.equal(res.json.code, "IMPORT_PLAN_VERSION_CONFLICT");
  assert.deepEqual(res.json.details.rows.map((r) => [r.row_ref, r.issues[0].code]), [["late", "DUPLICATE_EXISTING"]]);
  const after = await call("GET", `/imports/plans/${plan.plan_id}`, "manager");
  assert.deepEqual([after.json.status, after.json.version, after.json.counts.issue], ["draft", plan.version + 1, 1]);
  await withDb((db) => db.query(`DELETE FROM emission WHERE review_comment = 'im2-late'`));
});

test("a failure mid-commit leaves no rows and the plan still a draft", async () => {
  // A test-only trigger makes the second row's insert fail inside the commit transaction (MCP-24).
  await withDb(async (db) => {
    await db.query(`CREATE OR REPLACE FUNCTION ci_im2_fail_insert() RETURNS trigger AS $$
      BEGIN IF NEW.extra_data->>'notes' = '__FAIL_INSERT__' THEN RAISE EXCEPTION 'ci: forced insert failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER ci_im2_fail_insert BEFORE INSERT ON emission FOR EACH ROW EXECUTE FUNCTION ci_im2_fail_insert()`);
  });
  try {
    const { json: plan } = await create("manager", [row({ row_ref: "ok1" }), row({ row_ref: "boom", notes: "__FAIL_INSERT__" })]);
    assert.equal(plan.counts.ready, 2);
    const before = await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission`)).rows[0].n));
    const res = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: false, idempotency_key: "fail-" + plan.plan_id });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, "INTERNAL");
    assert.equal(await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission`)).rows[0].n)), before);
    const after = await call("GET", `/imports/plans/${plan.plan_id}`, "manager");
    assert.deepEqual([after.json.status, after.json.committed], ["draft", undefined]);
  } finally {
    await withDb(async (db) => {
      await db.query(`DROP TRIGGER IF EXISTS ci_im2_fail_insert ON emission`);
      await db.query(`DROP FUNCTION IF EXISTS ci_im2_fail_insert()`);
    });
  }
});

test("cancel and expiry", async () => {
  const { json: plan } = await create("manager", [row()]);
  const cancelled = await call("POST", `/imports/plans/${plan.plan_id}/cancel`, "manager");
  assert.equal(cancelled.json.status, "cancelled");
  assert.equal((await call("POST", `/imports/plans/${plan.plan_id}/cancel`, "manager")).json.code, "IMPORT_PLAN_NOT_DRAFT");
  assert.equal((await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: cancelled.json.version, skip_rows_with_issues: false, idempotency_key: "x" })).status, 409);

  const { json: old } = await create("manager", [row()]);
  await withDb((db) => db.query(`UPDATE import_plan SET expires_at = now() - interval '1 minute' WHERE plan_id = $1`, [old.plan_id]));
  const read = await call("GET", `/imports/plans/${old.plan_id}`, "manager");
  assert.equal(read.json.status, "expired");
  const commit = await call("POST", `/imports/plans/${old.plan_id}/commit`, "manager", { version: old.version, skip_rows_with_issues: false, idempotency_key: "exp-" + old.plan_id });
  assert.equal(commit.status, 410);
  assert.equal(commit.json.code, "IMPORT_PLAN_EXPIRED");
  assert.equal((await call("POST", `/imports/plans/${old.plan_id}/rows`, "manager", { version: old.version, rows: [row()] })).status, 410);
});

test("limits: ten open drafts per person, 20,000 rows per plan", async () => {
  // Expired and cancelled plans don't count towards the limit.
  const open = await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM import_plan WHERE created_by = 7 AND status = 'draft'`)).rows[0].n));
  const ids = [];
  for (let i = open; i < 10; i++) {
    const r = await create("multiSiteUser", [row({ category_id: 1 })]);
    assert.equal(r.status, 201);
    ids.push(r.json.plan_id);
  }
  const eleventh = await create("multiSiteUser", [row()]);
  assert.equal(eleventh.status, 429);
  assert.equal(eleventh.json.code, "IMPORT_TOO_MANY_PLANS");
  await call("POST", `/imports/plans/${ids[0]}/cancel`, "multiSiteUser");
  assert.equal((await create("multiSiteUser", [row()])).status, 201);

  const { json: big } = await create("manager", [row()]);
  await withDb((db) => db.query(`UPDATE import_plan SET counts = jsonb_set(counts, '{rows}', '19999') WHERE plan_id = $1`, [big.plan_id]));
  // The plan limit counts stored rows, so fake the table: 19,999 placeholder rows would be slow; the service counts rows, so insert them in one statement.
  await withDb((db) =>
    db.query(
      `INSERT INTO import_plan_row (plan_id, row_ref, position, input, state, issues)
       SELECT $1, 'f' || g, g, '{}'::jsonb, 'skipped', '[]'::jsonb FROM generate_series(1, 19998) g`,
      [big.plan_id],
    ),
  );
  const over = await call("POST", `/imports/plans/${big.plan_id}/rows`, "manager", { version: big.version, rows: [row(), row()] });
  assert.equal(over.status, 413);
  assert.equal(over.json.details.max_per_plan, 20000);
});

test("deleting the creator keeps the plan and its source name (created_by set to null)", async () => {
  const planId = await withDb(async (db) => {
    await db.query(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES (52, 'CI Importer', 'ci-importer@example.invalid', 'x', 'Manager', 1) ON CONFLICT (user_id) DO NOTHING`);
    const { rows } = await db.query(
      `INSERT INTO import_plan (company_id, created_by, channel, source_name, status, expires_at) VALUES (1, 52, 'bulk_upload', 'midal-2026.xlsx', 'committed', now()) RETURNING plan_id`,
    );
    await db.query(`DELETE FROM "user" WHERE user_id = 52`);
    return rows[0].plan_id;
  });
  const kept = await withDb((db) => db.query(`SELECT created_by, source_name FROM import_plan WHERE plan_id = $1`, [planId]));
  assert.equal(kept.rows.length, 1);
  assert.equal(kept.rows[0].created_by, null);
  assert.equal(kept.rows[0].source_name, "midal-2026.xlsx");
  const asSuperadmin = await call("GET", `/imports/plans/${planId}`, "superadmin");
  assert.equal(asSuperadmin.status, 200);
  assert.equal(asSuperadmin.json.created_by, null);
  const asManager = await call("GET", `/imports/plans/${planId}`, "manager");
  assert.equal(asManager.status, 404);
  await withDb((db) => db.query(`DELETE FROM import_plan WHERE plan_id = $1`, [planId]));
});
