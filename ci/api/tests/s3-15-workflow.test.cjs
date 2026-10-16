// S3-15 part 2 (src/scope3/review/CLAUDE.md items 4–8): behind
// company.review_workflow_v2, a User's typed entry is a Draft (its FERA twin
// too), hidden from managers until submitted; submit moves own drafts to
// Pending with one notification per manager; a month closes per site once
// nothing is left, and every write path refuses a closed month with
// PERIOD_LOCKED until it is reopened with a reason.
//
// Runs on its own client (company 315, sites 3151 and 3152) with its own
// people and factors, and removes everything it created.
//   3151 User (site A)        3155 second User (site A)
//   3152 Manager (site A)     3153 Manager (site B)      3154 Admin
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const jwt = require("jsonwebtoken");
const { call: callAs, withDb } = require("../helpers.cjs");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));
const { planRows, insertRows } = require(path.resolve("dist/services/emissionWrite/index.js"));
const { engineResults } = require(path.resolve("dist/services/historicalEngine.js"));
const { categoryState } = require(path.resolve("dist/scope3/review/lock.js"));

const CO = 315;
const A = 3151;
const B = 3152;
const DIESEL = "CI S315b Diesel";
const PEOPLE = {
  user: { userId: 3151, role: "User" },
  manager: { userId: 3152, role: "Manager" },
  managerB: { userId: 3153, role: "Manager" },
  admin: { userId: 3154, role: "Admin" },
  user2: { userId: 3155, role: "User" },
};
const MAY = { year: 2025, month: 5 };

// The fixture's people keep their names (helpers.cjs); this client's people get signed tokens here.
const call = (method, route, who, body) => {
  if (!PEOPLE[who]) return callAs(method, route, who, body);
  const token = jwt.sign(PEOPLE[who], process.env.JWT_SECRET);
  return callAs(method, route, null, body, { Authorization: `Bearer ${token}` });
};
const q = async (sql, params) => (await withDb((db) => db.query(sql, params))).rows;
const ok = (r, status = 200) => assert.equal(r.status, status, JSON.stringify(r.json));
const locked = (r) => {
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, "PERIOD_LOCKED", JSON.stringify(r.json));
};
const statusOf = async (id) => (await q(`SELECT status::text AS s FROM emission WHERE pk_id = $1`, [id]))[0]?.s;
const twinOf = async (id) => (await q(`SELECT pk_id, status::text AS status FROM emission WHERE fera_linked_id = $1`, [id]))[0];
const entry = (site, date, value, over = {}) => ({ site_id: site, category_id: 1, date_of_reporting: date, activity_data_unit: "litre", activity_data: { emission_category: DIESEL, activity_value: String(value) }, ...over });
const setSwitch = (on) => call("PUT", `/admin/companies/${CO}`, "superadmin", { review_workflow_v2: on });
/** A row written straight to the table (for paths whose normal writes a closed month already refuses). */
const rawRow = async (site, date, status, over = {}) =>
  (
    await q(
      `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, upload_batch_id)
       VALUES ($1, 1, 'tCO2e', $2, $3, $4, 1, $5, 'monthly', $6) RETURNING pk_id`,
      [JSON.stringify({ emission_category: DIESEL, activity_value: "1" }), date, status, over.created_by ?? 3151, site, over.batch ?? null],
    )
  )[0].pk_id;

let plannedForB; // a plan for site B in May, made while the month is open

test.before(async () => {
  await withDb(async (db) => {
    await db.query(`INSERT INTO company (company_id, name, address, contact_person, mcp_enabled) VALUES (${CO}, 'CI S3-15 Workflow Co', '315 Test Road', 'CI', true)`);
    await db.query(`INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES (${A}, 'CI S315 Plant A', 'Plot A', 'CI', ${CO}), (${B}, 'CI S315 Plant B', 'Plot B', 'CI', ${CO})`);
    await db.query(`INSERT INTO site_categories (site_id, category_id) VALUES (${A}, 1), (${A}, 5), (${B}, 1)`);
    // The Scope 3 grid reads the GHG number: the fixture's FERA category is Category 3 here (put back after).
    await db.query(`UPDATE category SET ghg_category = 3 WHERE category_id = 5`);
    await db.query(`INSERT INTO "user" (user_id, name, email, password, role, site_id) VALUES
      (3151, 'S315 User', 's315-user@example.invalid', 'x', 'User', ${A}),
      (3152, 'S315 Manager', 's315-manager@example.invalid', 'x', 'Manager', NULL),
      (3153, 'S315 Manager B', 's315-manager-b@example.invalid', 'x', 'Manager', NULL),
      (3154, 'S315 Admin', 's315-admin@example.invalid', 'x', 'Admin', ${A}),
      (3155, 'S315 User 2', 's315-user2@example.invalid', 'x', 'User', ${A})`);
    await db.query(`INSERT INTO user_sites (user_id, site_id) VALUES (3152, ${A}), (3153, ${B})`);
    await db.query(`INSERT INTO emission_factors (emission_factor_id, site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name, factor_type) VALUES
      (93151, ${A}, 1, 2024, 2.68, 'litre', 'CI', '${DIESEL}', '${DIESEL}', 'combustion'),
      (93152, ${A}, 5, 2024, 0.61, 'litre', 'CI', '${DIESEL}', '${DIESEL}', 'wtt'),
      (93153, ${B}, 1, 2024, 2.68, 'litre', 'CI', '${DIESEL}', '${DIESEL}', 'combustion')`);
  });
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
});

test.after(async () => {
  await withDb(async (db) => {
    const ids = (await db.query(`SELECT pk_id FROM emission WHERE site_id IN (${A}, ${B})`)).rows.map((r) => r.pk_id);
    await db.query(`DELETE FROM audit_log WHERE (entity_type = 'emission' AND entity_id = ANY($1)) OR entity_type = 'scope3_period_lock' AND entity_id IN (SELECT id FROM period_lock WHERE company_id = ${CO})`, [ids]);
    await db.query(`DELETE FROM emission_document WHERE emission_id = ANY($1)`, [ids]);
    await db.query(`DELETE FROM emission WHERE site_id IN (${A}, ${B})`);
    await db.query(`DELETE FROM import_plan_match WHERE plan_id IN (SELECT plan_id FROM import_plan WHERE company_id = ${CO})`);
    await db.query(`DELETE FROM import_plan_row WHERE plan_id IN (SELECT plan_id FROM import_plan WHERE company_id = ${CO})`);
    await db.query(`DELETE FROM import_plan WHERE company_id = ${CO}`);
    await db.query(`DELETE FROM mcp_tool_call WHERE company_id = ${CO}`).catch(() => undefined);
    await db.query(`DELETE FROM period_lock WHERE company_id = ${CO}`);
    await db.query(`DELETE FROM nothing_this_month WHERE site_id IN (${A}, ${B})`);
    await db.query(`DELETE FROM notification WHERE user_id BETWEEN 3151 AND 3155`);
    await db.query(`DELETE FROM user_sites WHERE user_id BETWEEN 3151 AND 3155`);
    await db.query(`DELETE FROM user_categories WHERE user_id BETWEEN 3151 AND 3155`);
    await db.query(`DELETE FROM "user" WHERE user_id BETWEEN 3151 AND 3155`);
    await db.query(`DELETE FROM emission_factors WHERE emission_factor_id IN (93151, 93152, 93153)`);
    await db.query(`DELETE FROM site_categories WHERE site_id IN (${A}, ${B})`);
    await db.query(`DELETE FROM emission_threshold WHERE company_id = ${CO}`);
    await db.query(`DELETE FROM company_scope3_category WHERE company_id = ${CO}`);
    await db.query(`DELETE FROM site WHERE site_id IN (${A}, ${B})`);
    await db.query(`DELETE FROM company WHERE company_id = ${CO}`);
    await db.query(`UPDATE category SET ghg_category = NULL WHERE category_id = 5`);
  });
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

test("migrate:scope3-review-workflow runs twice: the status enum has draft, the switch defaults off", () => {
  for (let i = 0; i < 2; i++) {
    const run = spawnSync(process.execPath, [path.resolve("dist/scripts/migrateScope3ReviewWorkflow.js")], { env: process.env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  return withDb(async (db) => {
    const values = (await db.query(`SELECT unnest(enum_range(NULL::emission_status_enum))::text AS v`)).rows.map((r) => r.v);
    assert.ok(values.includes("draft"), values.join(","));
    assert.equal((await db.query(`SELECT review_workflow_v2 FROM company WHERE company_id = ${CO}`)).rows[0].review_workflow_v2, false);
  });
});

test("switch off: a User's entry is Pending as today; the Superadmin turns the switch on (a boolean only)", async () => {
  const r = await call("POST", "/user/emissions", "user", entry(A, "2025-04-30", 10));
  ok(r, 201);
  assert.equal(r.json.emission.status, "pending");
  assert.equal((await twinOf(r.json.emission.pk_id)).status, "pending", "the FERA twin");
  ok(await call("GET", "/user/my-month?month=2025-04", "user"));
  const mm = await call("GET", "/user/my-month?month=2025-04", "user");
  assert.equal(mm.json.review_workflow_v2, undefined, "no v2 fields with the switch off");
  assert.deepEqual(mm.json.sites[0].categories[0].entries, { total: 1, pending: 1, approved: 0, rejected: 0 });

  assert.equal((await call("POST", "/periods/lock", "manager", { site_id: A, ...MAY })).json.code, "REVIEW_WORKFLOW_OFF");
  assert.equal((await call("POST", "/user/my-month/nothing", "user", { site_id: A, category_id: 1, month: "2025-05" })).json.code, "REVIEW_WORKFLOW_OFF");
  assert.equal((await call("PUT", `/admin/companies/${CO}`, "superadmin", { review_workflow_v2: "yes" })).status, 400);
  assert.equal((await call("PUT", `/admin/companies/${CO}`, "admin", { review_workflow_v2: true })).status, 403, "only a Superadmin switches it");
  ok(await setSwitch(true));
});

let draft; // the User's May diesel row
test("switch on: a User's typed entry is a Draft with its twin; a Manager's entry stays Pending", async () => {
  const r = await call("POST", "/user/emissions", "user", entry(A, "2025-05-31", 100));
  ok(r, 201);
  draft = r.json.emission.pk_id;
  assert.equal(r.json.emission.status, "draft");
  assert.equal(Number(r.json.emission.total_emission), 0.27, "100 l × 2.68 kg = 268 kg");
  const twin = await twinOf(draft);
  assert.equal(twin.status, "draft", "a FERA twin shares its parent's status");
  assert.equal((await q(`SELECT checks FROM emission WHERE pk_id = $1`, [draft]))[0].checks, null, "drafts carry no stored checks");

  const m = await call("POST", "/user/emissions", "manager", entry(A, "2025-06-30", 50));
  ok(m, 201);
  assert.equal(m.json.emission.status, "pending");
});

test("drafts stay out of manager lists, exports, totals and My month totals; the owner sees them", async () => {
  const mgr = await call("GET", `/user/emissions?siteId=${A}&year=2025&month=5&page=1&limit=50`, "manager");
  ok(mgr);
  assert.ok(!mgr.json.data.some((e) => e.pk_id === draft), "not in the manager's list");
  assert.equal(mgr.json.summary.total_emission, 0, "nor in its total");
  const pending = await call("GET", `/user/emissions/pending?siteId=${A}`, "manager");
  assert.ok(!pending.json.some((e) => e.pk_id === draft));
  const own = await call("GET", `/user/emissions?siteId=${A}&status=draft`, "user");
  ok(own);
  const ownIds = own.json.map((e) => e.pk_id);
  assert.ok(ownIds.includes(draft) && ownIds.includes((await twinOf(draft)).pk_id), "the owner sees the draft and its twin");
  const otherUser = await call("GET", `/user/emissions?siteId=${A}&status=draft`, "user2");
  assert.deepEqual(otherUser.json, [], "another contributor doesn't see it");
  const entered = await call("GET", `/user/emissions/period-total?site_id=${A}&category_id=1&emission_category=${encodeURIComponent(DIESEL)}&year=2025&month=5&reporting_period=monthly&basis=entered`, "manager");
  ok(entered);
  assert.equal(entered.json.total_emission, 0, "a Draft isn't entered data for the threshold");

  const mm = await call("GET", "/user/my-month?month=2025-05", "user");
  ok(mm);
  assert.equal(mm.json.review_workflow_v2, true);
  const site = mm.json.sites.find((s) => s.site_id === A);
  assert.equal(site.locked, false);
  const diesel = site.categories.find((c) => c.category_id === 1);
  assert.equal(diesel.status, "draft");
  assert.deepEqual(diesel.entries, { total: 1, pending: 0, approved: 0, rejected: 0, draft: 1 });
  assert.equal(diesel.total_emission, 0, "a Draft adds nothing");
  assert.equal(diesel.nothing, false);
  assert.equal(mm.json.summary.draft, 1);

  // A Draft can't be approved: it isn't in review.
  assert.notEqual((await call("PUT", `/user/emissions/${draft}/approve`, "manager")).status, 200);
});

test("dry-run checks: what a Draft would be held for, nothing stored", async () => {
  const r = await call("POST", "/user/emissions/check", "user", { ids: [draft] });
  ok(r);
  assert.equal(r.json.results.length, 1);
  assert.equal(r.json.results[0].id, draft);
  assert.equal(r.json.results[0].status, "draft");
  assert.ok(r.json.results[0].checks.held.includes("EVIDENCE_ATTACHED"), JSON.stringify(r.json));
  assert.equal(r.json.results[0].checks.ready, false);
  assert.equal((await q(`SELECT checks FROM emission WHERE pk_id = $1`, [draft]))[0].checks, null);
  assert.equal((await call("POST", "/user/emissions/check", "user", { ids: [] })).json.code, "SCOPE3_VALIDATION");
});

test("submit: own drafts only; NOT_DRAFT for a Pending row or another person's draft; one notification per site manager", async () => {
  const pendingApril = (await q(`SELECT pk_id FROM emission WHERE site_id = ${A} AND date_of_reporting = '2025-04-30' AND fera_linked_id IS NOT NULL AND category_id = 1`))[0].pk_id;
  const theirs = await call("POST", "/user/emissions", "user2", entry(A, "2025-07-31", 5));
  ok(theirs, 201);
  const r = await call("POST", "/user/emissions/submit", "user", { ids: [draft, pendingApril, theirs.json.emission.pk_id] });
  ok(r);
  assert.deepEqual(r.json.submitted, [draft]);
  assert.deepEqual(r.json.refused, [
    { id: pendingApril, code: "NOT_DRAFT" },
    { id: theirs.json.emission.pk_id, code: "NOT_DRAFT" },
  ].sort((a, b) => a.id - b.id));
  assert.equal(await statusOf(draft), "pending");
  assert.equal((await twinOf(draft)).status, "pending", "the twin moves with it");
  const checks = (await q(`SELECT checks FROM emission WHERE pk_id = $1`, [draft]))[0].checks;
  assert.ok(checks && Array.isArray(checks.held), "checks are stored on submit");
  const audit = await q(`SELECT action, changed_fields FROM audit_log WHERE entity_type = 'emission' AND entity_id = $1 AND action = 'submit'`, [draft]);
  assert.deepEqual(audit[0].changed_fields, { status: { old: "draft", new: "pending" } });
  const notes = await q(`SELECT user_id, type, meta FROM notification WHERE type = 'draft_submitted' AND user_id BETWEEN 3151 AND 3155`);
  assert.deepEqual(notes.map((n) => n.user_id), [3152], "the manager of site A only, once");
  assert.equal(notes[0].meta.rows, 1);
  // Submitting it again is refused: it isn't a draft any more.
  assert.deepEqual((await call("POST", "/user/emissions/submit", "user", { ids: [draft] })).json, { submitted: [], refused: [{ id: draft, code: "NOT_DRAFT" }] });
  assert.equal((await call("POST", "/user/emissions/submit", "user", { ids: [] })).status, 400);
});

test("a contributor's edit of a Sent back row makes it a Draft again, twin included", async () => {
  ok(await call("PUT", `/user/emissions/${draft}/reject`, "manager", { comment: "Check the litres" }));
  assert.equal(await statusOf(draft), "rejected");
  const edit = await call("PUT", `/user/emissions/${draft}`, "user", { activity_data: { emission_category: DIESEL, activity_value: "110" }, activity_data_unit: "litre", reason: "Fixed" });
  ok(edit);
  assert.equal(edit.json.emission.status, "draft");
  assert.equal((await twinOf(draft)).status, "draft");
  const mm = await call("GET", "/user/my-month?month=2025-05", "user");
  assert.equal(mm.json.sites.find((s) => s.site_id === A).categories.find((c) => c.category_id === 1).status, "draft");
});

test("history: the activity's last months from pending and approved rows", async () => {
  const r = await call("GET", `/user/emissions/${draft}/history?months=3`, "manager");
  ok(r);
  assert.deepEqual(r.json.months.map((m) => m.month), ["2025-03", "2025-04", "2025-05"]);
  assert.equal(r.json.months[1].total_tco2e, 0.03, "April: 10 l × 2.68 kg = 26.8 kg");
  assert.equal(r.json.months[2].total_tco2e, 0, "May's row is a Draft again");
  assert.equal(r.json.unit, "tCO2e");
  assert.equal((await call("GET", `/user/emissions/${draft}/history?months=99`, "manager")).status, 400);
});

test("tenant isolation: another company's token gets 404 on submit, check, history, lock status, lock and unlock", async () => {
  for (const who of ["otherManager", "otherUser"]) {
    assert.equal((await call("POST", "/user/emissions/submit", who, { ids: [draft] })).status, 404, who);
    assert.equal((await call("POST", "/user/emissions/check", who, { ids: [draft] })).status, 404, who);
    assert.equal((await call("GET", `/user/emissions/${draft}/history`, who)).status, 404, who);
    assert.equal((await call("POST", "/user/my-month/nothing", who, { site_id: B, category_id: 1, month: "2025-05" })).status, 404, who);
  }
  assert.equal((await call("GET", `/periods/lock?year=2025&month=5&site_id=${A}`, "otherManager")).status, 404);
  assert.equal((await call("POST", "/periods/lock", "otherManager", { site_id: A, ...MAY })).status, 404);
  assert.equal((await call("POST", "/periods/unlock", "otherManager", { site_id: A, ...MAY, reason: "Late invoice" })).status, 404);
  assert.equal((await call("GET", `/periods/lock?year=2025&month=5&company_id=${CO}`, "manager")).status, 200);
  assert.equal((await call("GET", `/periods/lock?year=2025&month=5&company_id=2`, "manager")).status, 404, "naming another company");
});

test("roles: a User can't lock; a Manager can't lock another manager's site or every site", async () => {
  assert.equal((await call("POST", "/periods/lock", "user", { site_id: A, ...MAY })).status, 403);
  assert.equal((await call("GET", `/periods/lock?year=2025&month=5`, "user")).status, 403);
  assert.equal((await call("POST", "/periods/lock", "manager", { site_id: B, ...MAY })).status, 403);
  assert.equal((await call("POST", "/periods/lock", "manager", { site_id: null, ...MAY })).status, 403);
  assert.equal((await call("POST", "/periods/unlock", "managerB", { site_id: A, ...MAY, reason: "Late invoice" })).status, 403);
  assert.equal((await call("POST", "/periods/lock", "superadmin", { ...MAY })).json.code, "SCOPE3_COMPANY_REQUIRED");
  assert.equal((await call("POST", "/periods/lock", "manager", { site_id: A, year: 2025 })).json.code, "SCOPE3_VALIDATION", "a month is required");
});

test("close month: what is left, PERIOD_INCOMPLETE while anything is, then the Manager locks site A", async () => {
  // While planning for site B the month is open: the plan is ready (committed later, after the lock).
  const ctx = { user_id: 3154, role: "Admin", company_id: CO, allowed_site_ids: [A, B], allowed_category_ids_by_site: {} };
  plannedForB = await planRows(ctx, [{ row_ref: "b1", site_id: B, category_id: 1, period: { kind: "monthly", date: "2025-05-01" }, activity_name: DIESEL, activity_value: 7, activity_unit: "litre" }], { planMatches: [] });
  assert.equal(plannedForB[0].state, "ready", JSON.stringify(plannedForB[0].issues));

  const before = await call("GET", `/periods/lock?year=2025&month=5&site_id=${A}`, "manager");
  ok(before);
  assert.equal(before.json.review_workflow_v2, true);
  assert.equal(before.json.can_lock, false);
  assert.deepEqual(before.json.left, [{ site_id: A, site_name: "CI S315 Plant A", category_id: 1, category_name: "Stationary Combustion", reason: "draft" }]);
  const site = before.json.sites[0];
  assert.deepEqual(site.categories.map((c) => c.category_id), [1], "FERA isn't owed");
  assert.deepEqual(site.categories[0].counts, { draft: 1, pending: 0, approved: 0, rejected: 0 });
  assert.equal(site.scope3.length, 15);
  assert.deepEqual(site.scope3.find((c) => c.n === 3), { n: 3, status: "screening", data: false }, "a Draft twin is no data yet");
  const refused = await call("POST", "/periods/lock", "manager", { site_id: A, ...MAY });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, "PERIOD_INCOMPLETE");
  assert.equal(refused.json.details.left[0].reason, "draft");

  ok(await call("POST", "/user/emissions/submit", "user", { ids: [draft] }));
  const pending = await call("GET", `/periods/lock?year=2025&month=5&site_id=${A}`, "manager");
  assert.equal(pending.json.left[0].reason, "pending");
  assert.equal(pending.json.sites[0].scope3.find((c) => c.n === 3).data, true, "the submitted twin is Category 3 data");
  ok(await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: [draft] }));

  const lock = await call("POST", "/periods/lock", "manager", { site_id: A, ...MAY });
  ok(lock);
  assert.equal(lock.json.locked, true);
  assert.equal(lock.json.sites[0].locked, true);
  assert.equal(lock.json.sites[0].lock.locked_by, 3152);
  assert.equal(lock.json.sites[0].categories[0].state, "approved");
  const audit = await q(`SELECT action, reason, changed_fields FROM audit_log WHERE entity_type = 'scope3_period_lock' AND entity_id IN (SELECT id FROM period_lock WHERE company_id = ${CO} AND site_id = ${A})`);
  assert.deepEqual(audit.map((a) => a.action), ["lock"]);
  assert.deepEqual(audit[0].changed_fields.locked, { old: false, new: true });
  ok(await call("POST", "/periods/lock", "manager", { site_id: A, ...MAY }), 200);
  assert.equal((await q(`SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'scope3_period_lock'`))[0].n, 1, "locking twice writes nothing new");

  const mm = await call("GET", "/user/my-month?month=2025-05", "user");
  assert.equal(mm.json.sites.find((s) => s.site_id === A).locked, true);
});

test("Nothing this month completes a category; the Admin then locks every site", async () => {
  const before = await call("GET", `/periods/lock?year=2025&month=5`, "admin");
  ok(before);
  assert.deepEqual(before.json.left.map((l) => [l.site_id, l.reason]), [[B, "missing"]]);
  const r = await call("POST", "/user/my-month/nothing", "managerB", { site_id: B, category_id: 1, month: "2025-05-14" });
  ok(r);
  assert.deepEqual(r.json, { site_id: B, category_id: 1, month: "2025-05-01", nothing: true });
  ok(await call("POST", "/user/my-month/nothing", "managerB", { site_id: B, category_id: 1, month: "2025-05" }), 200);
  assert.equal((await call("POST", "/user/my-month/nothing", "user", { site_id: B, category_id: 1, month: "2025-05" })).status, 404, "not the User's site");
  const after = await call("GET", `/periods/lock?year=2025&month=5`, "admin");
  assert.deepEqual(after.json.left, []);
  assert.equal(after.json.sites.find((s) => s.site_id === B).categories[0].state, "nothing");
  const lock = await call("POST", "/periods/lock", "admin", { site_id: null, ...MAY });
  ok(lock);
  assert.deepEqual(lock.json.sites.map((s) => [s.site_id, s.locked]), [[A, true], [B, true]]);
  // Clearing the marker in a closed month is a write too.
  locked(await call("DELETE", "/user/my-month/nothing", "managerB", { site_id: B, category_id: 1, month: "2025-05" }));
});

test("PERIOD_LOCKED on every write path into a closed site-month", async () => {
  const june = (await q(`SELECT pk_id FROM emission WHERE site_id = ${A} AND date_of_reporting = '2025-06-30' AND category_id = 1`))[0].pk_id;
  const pendingMay = await rawRow(A, "2025-05-15", "pending", { created_by: 3155 });
  const draftMay = await rawRow(A, "2025-05-16", "draft");
  const batch = "ci-s315b-batch-may";
  await rawRow(A, "2025-05-17", "pending", { batch, created_by: 3155 });

  // create, edit, an edit moving a row into the month, manager edit, delete
  locked(await call("POST", "/user/emissions", "user", entry(A, "2025-05-20", 1)));
  locked(await call("POST", "/user/emissions", "manager", { ...entry(A, "2025-05-20", 1), reporting_period: "monthly" }));
  locked(await call("PUT", `/user/emissions/${draft}`, "user", { activity_data: { emission_category: DIESEL, activity_value: "1" }, activity_data_unit: "litre" }));
  locked(await call("PUT", `/user/emissions/${june}`, "manager", { date_of_reporting: "2025-05-31" }));
  locked(await call("PUT", `/user/emissions/manager-edit/${draft}`, "manager", { activity_data: { emission_category: DIESEL, activity_value: "2" } }));
  locked(await call("PUT", `/user/emissions/manager-edit/${june}`, "manager", { date_of_reporting: "2025-05-30" }));
  locked(await call("DELETE", `/user/emissions/${draft}`, "manager"));
  locked(await call("DELETE", `/user/emissions/${(await twinOf(draft)).pk_id}`, "manager"));
  // approve, reject, bulk approve, bulk reject, bulk delete
  locked(await call("PUT", `/user/emissions/${pendingMay}/approve`, "manager"));
  locked(await call("PUT", `/user/emissions/${pendingMay}/reject`, "manager", { comment: "no" }));
  locked(await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: [draft, pendingMay] }));
  locked(await call("PUT", "/user/emissions/bulk-approve", "manager", { ids: [pendingMay], only_ready: true }));
  locked(await call("PUT", "/user/emissions/bulk-reject", "manager", { ids: [pendingMay], comment: "no" }));
  locked(await call("DELETE", "/user/emissions/bulk-delete", "manager", { ids: [june, pendingMay] }));
  // batch approve, reject, delete
  locked(await call("PUT", `/user/emissions/batch/${batch}/approve`, "manager"));
  locked(await call("PUT", `/user/emissions/batch/${batch}/reject`, "manager", { comment: "no" }));
  locked(await call("DELETE", `/user/emissions/batch/${batch}`, "manager"));
  // submit of a Draft in the month
  assert.deepEqual((await call("POST", "/user/emissions/submit", "user", { ids: [draftMay] })).json, { submitted: [], refused: [{ id: draftMay, code: "PERIOD_LOCKED" }] });

  assert.equal(await statusOf(pendingMay), "pending", "nothing moved");
  assert.equal(await statusOf(draft), "approved");
  assert.equal(await statusOf(june), "pending", "June itself stays open");
  ok(await call("PUT", `/user/emissions/${june}/approve`, "superadmin"), 200);

  // import plan, import commit (writer), HTTP commit, MCP commit, historical import
  const ctx = { user_id: 3154, role: "Admin", company_id: CO, allowed_site_ids: [A, B], allowed_category_ids_by_site: {} };
  const replanned = await planRows(ctx, [plannedForB[0].input], { planMatches: [] });
  assert.equal(replanned[0].state, "issue");
  assert.deepEqual(replanned[0].issues.map((i) => i.code), ["PERIOD_LOCKED"]);
  await assert.rejects(
    AppDataSource.transaction((tx) => insertRows(tx, ctx, plannedForB, { upload_batch_id: "ci-s315b-commit", channel: "api", source_name: "s315b" })),
    (err) => err.code === "PERIOD_LOCKED" && err.status === 409 && err.details.row_refs[0] === "b1",
  );
  const row = { row_ref: "h1", site_id: B, category_id: 1, period: { kind: "monthly", date: "2025-05-01" }, activity_name: DIESEL, activity_value: 7, activity_unit: "litre" };
  const plan = await call("POST", "/imports/plans", "admin", { source_name: "s315b.xlsx", channel: "api", rows: [row] });
  ok(plan, 201);
  assert.equal(plan.json.rows.find((x) => x.row_ref === "h1").issues[0].code, "PERIOD_LOCKED", "a plan for a closed month shows why");
  // Plans made while the month was open (HTTP and Claude/MCP), committed after it closed: refused at commit.
  await q(`UPDATE period_lock SET reopened_at = now(), reopened_by = 3154, reopened_reason = 'test window' WHERE company_id = ${CO} AND site_id = ${B}`);
  const open = await call("POST", "/imports/plans", "admin", { source_name: "s315b-2.xlsx", channel: "api", rows: [{ ...row, row_ref: "h2" }] });
  ok(open, 201);
  assert.equal(open.json.counts.ready, 1, JSON.stringify(open.json.rows));
  const client = new Client({ name: "ci-s315b", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${process.env.API_BASE}/mcp`), { requestInit: { headers: { Authorization: "Bearer mcp-test.5.imports:read,imports:write.s315b" } } }));
  try {
    const planned = await client.callTool({ name: "plan_import", arguments: { company_id: CO, source_name: "s315b-mcp.xlsx", rows: [{ ...row, row_ref: "m1" }] } });
    assert.notEqual(planned.isError, true, planned.content?.[0]?.text);
    assert.equal(planned.structuredContent.counts.ready, 1, JSON.stringify(planned.structuredContent.rows));
    await q(`UPDATE period_lock SET reopened_at = NULL, reopened_by = NULL, reopened_reason = NULL WHERE company_id = ${CO} AND site_id = ${B}`);

    const commit = await call("POST", `/imports/plans/${open.json.plan_id}/commit`, "admin", { version: open.json.version, skip_rows_with_issues: false, idempotency_key: `s315b-${open.json.plan_id}` });
    assert.equal(commit.status, 409, JSON.stringify(commit.json));
    assert.equal(commit.json.code, "PERIOD_LOCKED");
    assert.deepEqual(commit.json.details.row_refs, ["h2"]);

    const committed = await client.callTool({ name: "commit_import", arguments: { plan_id: planned.structuredContent.plan_id, version: planned.structuredContent.version, skip_rows_with_issues: false, confirm: true } });
    assert.equal(committed.isError, true, committed.content?.[0]?.text);
    assert.equal(committed.structuredContent.code, "PERIOD_LOCKED");
    assert.deepEqual(committed.structuredContent.details.row_refs, ["m1"]);
  } finally {
    await client.close();
  }
  const hist = await engineResults(AppDataSource.manager, [{ year: 2025, month: "May", fuelType: DIESEL, unit: "litre", activity: 3 }], B, 1);
  assert.match(hist.results.get(1).reason, /PERIOD_LOCKED/);
  assert.equal(hist.entries.size, 0);
  assert.equal((await q(`SELECT count(*)::int AS n FROM emission WHERE site_id = ${B}`))[0].n, 0, "nothing reached site B");
});

test("unlock needs a reason of 5+ characters, is audited, and opens the month again", async () => {
  const short = await call("POST", "/periods/unlock", "manager", { site_id: A, ...MAY, reason: " abc " });
  assert.equal(short.status, 400);
  assert.equal(short.json.code, "UNLOCK_REASON_REQUIRED");
  assert.equal((await call("POST", "/periods/unlock", "manager", { site_id: A, ...MAY })).json.code, "UNLOCK_REASON_REQUIRED");
  const r = await call("POST", "/periods/unlock", "manager", { site_id: A, ...MAY, reason: "Late invoice for May" });
  ok(r);
  const site = r.json.sites.find((s) => s.site_id === A);
  assert.equal(site.locked, false);
  assert.equal(site.reopened.reason, "Late invoice for May");
  assert.equal(site.reopened.reopened_by, 3152);
  const audit = await q(`SELECT action, reason FROM audit_log WHERE entity_type = 'scope3_period_lock' AND action = 'unlock'`);
  assert.deepEqual(audit, [{ action: "unlock", reason: "Late invoice for May" }]);
  // Site A is open again, site B stays closed.
  ok(await call("POST", "/user/emissions", "user", entry(A, "2025-05-20", 1, { activity_data: { emission_category: DIESEL, activity_value: "1", Note: "late" } })), 201);
  locked(await call("POST", "/user/emissions", "managerB", entry(B, "2025-05-20", 1)));
  // Locking again after a reopen re-closes the same row.
  const relock = await q(`SELECT count(*)::int AS n FROM period_lock WHERE company_id = ${CO} AND site_id = ${A}`);
  assert.equal(relock[0].n, 1);
});

test("switch off again: locks no longer refuse writes and entries are Pending, as today", async () => {
  ok(await setSwitch(false));
  const r = await call("POST", "/user/emissions", "managerB", entry(B, "2025-05-20", 1));
  ok(r, 201);
  assert.equal(r.json.emission.status, "pending");
  const status = await call("GET", `/periods/lock?year=2025&month=5`, "admin");
  assert.equal(status.json.review_workflow_v2, false);
  assert.equal(status.json.can_lock, false);
  assert.ok(status.json.sites.every((s) => s.locked === false));
});

test("lock completeness (pure): Sent back wins, then Draft, Pending; yearly batches cover; Nothing counts only when nothing was filed", () => {
  const m = (status, date = "2025-05-31", reporting_period = "monthly") => ({ status, date, reporting_period });
  const s = (rows, nothing = false) => categoryState(rows, "2025-05-01", "2025-05-31", nothing).state;
  assert.equal(s([]), "missing");
  assert.equal(s([], true), "nothing");
  assert.equal(s([m("approved")], true), "approved");
  assert.equal(s([m("approved"), m("draft")]), "draft");
  assert.equal(s([m("pending"), m("draft"), m("rejected")]), "rejected");
  assert.equal(s([m("pending"), m("approved")]), "pending");
  assert.equal(s([m("approved", "2026-03-31", "yearly")]), "covered", "an approved FY batch ending in another month");
  assert.equal(s([m("pending", "2026-03-31", "yearly")]), "pending", "an open one shows its status");
  assert.equal(s([m("approved", "2025-05-31", "yearly")]), "approved", "a batch ending this month is this month's entry");
});
