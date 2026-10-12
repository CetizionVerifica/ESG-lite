// IM2 import plans API (docs/mcp-import/backend/IM2-import-plans-api/CLAUDE.md):
// a plan is created from rows, re-checked on every change, and commits as one
// pending upload batch. Runs with the fake EmissionWriter (part 1): a row is
// worth value / 1000 tCO2e, a name containing "unknown" is UNKNOWN_ACTIVITY.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const { call, withDb } = require("../helpers.cjs");

let seq = 0;
const row = (over = {}) => ({
  row_ref: `Sheet1!B${++seq}`,
  site_id: 1,
  category_id: 1,
  period: { kind: "monthly", date: "2025-06-01" },
  activity_name: `Fuel ${seq}`,
  activity_value: 1500,
  activity_unit: "L",
  ...over,
});

const create = (who, rows, extra = {}) => call("POST", "/imports/plans", who, { source_name: "fuel.xlsx", channel: "api", rows, ...extra });

// Rows a test saved are removed again, so the suites after this one keep their numbers.
const dropBatch = (batchId) => withDb((db) => db.query(`DELETE FROM emission WHERE upload_batch_id = $1`, [batchId]));

const emissionCount = (batchId) =>
  withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission WHERE upload_batch_id = $1`, [batchId])).rows[0].n));

test("create: rows are planned, issues come first, totals come from the writer", async () => {
  const res = await create("manager", [
    row({ row_ref: "a", activity_name: "HSD", activity_value: 2000 }),
    row({ row_ref: "b", activity_name: "Unknown fuel" }),
    row({ row_ref: "c", site_id: 2, category_id: 2, activity_name: "Grid", activity_value: 500, activity_unit: "kWh", total_emission: 99 }),
    row({ row_ref: "d", activity_name: "hsd ", activity_value: 0 }),
    row({ row_ref: "e", period: { kind: "yearly", year_type: "FY", year: 2025 }, activity_value: 1000 }),
  ]);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const plan = res.json;
  assert.equal(plan.status, "draft");
  assert.equal(plan.version, 1);
  assert.equal(plan.company_id, 1);
  assert.deepEqual(plan.counts, { rows: 5, ready: 3, issue: 2, skipped: 0, warnings: 2 });
  assert.equal(plan.totals.tco2e, 3.5);
  assert.deepEqual(plan.totals.by_month.map((m) => m.month), ["2025-03", "2025-06"], "FY 2025 ends 31 March 2025");
  assert.deepEqual(plan.totals.by_category.map((c) => [c.category_id, c.name, c.tco2e, c.rows]), [[1, "Stationary Combustion", 3, 2], [2, "Purchased Electricity", 0.5, 1]]);
  assert.deepEqual(plan.issues_summary.map((i) => [i.code, i.count]).sort(), [["CLIENT_TOTAL_IGNORED", 1], ["DUPLICATE_IN_PLAN", 1], ["NON_POSITIVE_VALUE", 1], ["UNKNOWN_ACTIVITY", 1]]);
  assert.deepEqual(plan.rows.map((r) => r.row_ref), ["b", "d", "a", "c", "e"]);
  const c = plan.rows.find((r) => r.row_ref === "c");
  assert.equal(c.state, "ready");
  assert.equal("total_emission" in c.input, false, "total-like keys are stripped");
  assert.equal(c.issues[0].code, "CLIENT_TOTAL_IGNORED");
  const d = plan.rows.find((r) => r.row_ref === "d");
  assert.deepEqual(d.issues.map((i) => [i.code, i.severity]), [["NON_POSITIVE_VALUE", "error"], ["DUPLICATE_IN_PLAN", "warning"]], "same site, category, month and activity as row a");
  const e = plan.rows.find((r) => r.row_ref === "e");
  assert.deepEqual([e.result.reporting_date, e.result.reporting_period, e.result.year_type], ["2025-03-31", "yearly", "FY"]);
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

  const granted = await create("multiSiteUser", [row({ row_ref: "ok", category_id: 2 }), row({ row_ref: "no", category_id: 3 })]);
  assert.equal(granted.status, 201);
  assert.equal(granted.json.rows.find((r) => r.row_ref === "no").issues[0].code, "CATEGORY_NOT_ASSIGNED");

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
    activity_matches: [{ site_id: 1, category_id: 1, sheet_name: "Unknown diesel", factor_name: "HSD" }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.version, plan.version + 1);
  assert.deepEqual(res.json.counts, { rows: 3, ready: 2, issue: 0, skipped: 1, warnings: 0 });
  const p1 = res.json.rows.find((r) => r.row_ref === "p1");
  assert.deepEqual([p1.state, p1.input.activity_value, p1.result.total_tco2e], ["ready", 250, 0.25]);
  const p2 = res.json.rows.find((r) => r.row_ref === "p2");
  assert.deepEqual([p2.state, p2.result.activity.matched_by, p2.result.activity.factor_name], ["ready", "plan_match", "HSD"]);
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
});

test("commit: refused with issues unless skipped; rows land pending in one batch; repeats add nothing", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "c1", activity_value: 1000 }), row({ row_ref: "c2", site_id: 2, category_id: 2, activity_name: "Grid", activity_value: 3000, activity_unit: "kWh" }), row({ row_ref: "bad", activity_name: "unknown" })]);
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
  assert.deepEqual(saved.map((s) => [s.status, s.t, s.site_id, s.category_id, s.extra_data.import_channel]), [["pending", 1, 1, 1, "api"], ["pending", 3, 2, 2, "api"]]);

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
    { channel: "api", source_name: "fuel.xlsx", rows: 2, pending: 2, approved: 0, tco2e: 4, site_ids: [1, 2], plan_id: plan.plan_id, by: 2 },
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
  assert.ok(app.json.filter((x) => x.upload_batch_id !== batchId).every((x) => x.channel === null), "batches made without a plan carry null");
  await dropBatch(batchId);
});

test("commit re-checks the rows: an entry saved after planning is caught", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "late", activity_name: "Late fuel", period: { kind: "monthly", date: "2025-05-01" } })]);
  assert.equal(plan.counts.ready, 1);
  await withDb((db) =>
    db.query(
      `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period)
       VALUES ('{"activity_name": "late fuel", "activity_value": 1}', 0.001, 'tCO2e', '2025-05-15', 'pending', 1, 1, 1, 'monthly')`,
    ),
  );
  const res = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: false, idempotency_key: "late-" + plan.plan_id });
  assert.equal(res.status, 409, JSON.stringify(res.json));
  assert.equal(res.json.code, "IMPORT_PLAN_VERSION_CONFLICT");
  assert.deepEqual(res.json.details.rows.map((r) => [r.row_ref, r.issues[0].code]), [["late", "DUPLICATE_EXISTING"]]);
  const after = await call("GET", `/imports/plans/${plan.plan_id}`, "manager");
  assert.deepEqual([after.json.status, after.json.version, after.json.counts.issue], ["draft", plan.version + 1, 1]);
  await withDb((db) => db.query(`DELETE FROM emission WHERE activity_data->>'activity_name' = 'late fuel'`));
});

test("a failure mid-commit leaves no rows and the plan still a draft", async () => {
  const { json: plan } = await create("manager", [row({ row_ref: "ok1" }), row({ row_ref: "boom", notes: "__FAIL_INSERT__", activity_name: "Boom" })]);
  const before = await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission`)).rows[0].n));
  const res = await call("POST", `/imports/plans/${plan.plan_id}/commit`, "manager", { version: plan.version, skip_rows_with_issues: false, idempotency_key: "fail-" + plan.plan_id });
  assert.equal(res.status, 500);
  assert.equal(res.json.code, "INTERNAL");
  assert.equal(await withDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM emission`)).rows[0].n)), before);
  const after = await call("GET", `/imports/plans/${plan.plan_id}`, "manager");
  assert.deepEqual([after.json.status, after.json.committed], ["draft", undefined]);
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
