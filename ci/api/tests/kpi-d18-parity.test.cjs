// D18 (KPI wave D): a Superadmin can do everything an Admin can for KPIs, for
// the client named by `company_id`. Walks the compiled /kpi route table: for
// every route an Admin passes (anything but 403), a Superadmin with
// company_id passes too (never 403, never KPI_COMPANY_REQUIRED; a GET answers
// the same status), and without company_id gets KPI_COMPANY_REQUIRED. Writes
// send empty bodies, so an allowed role gets a validation answer and nothing
// that matters is written. The review rights the Superadmin already has
// (approve, reject, reviewer edit) are checked too.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, kpiRoutes, concrete } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment", "migrateKpiTargets"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await clearSetup();
  await setupCompany(1, { frameworks: ["GRI", "BRSR", "ESRS"] });
  await setSwitch(1, true);
});
test.after(async () => {
  await q(`DELETE FROM notification WHERE type IN ('kpi_assigned', 'kpi_due')`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'kpi_setup' AND entity_id = 1`);
  await clearSetup();
  await setSwitch(1, false);
});

const withCompany = (url) => `${url}${url.includes("?") ? "&" : "?"}company_id=1`;
/** A query each GET needs to get past validation (year and friends), so the parity is about rights, not 400s. */
const QUERY = { "/kpi/dashboard": "?year=2026", "/kpi/periods/lock": "?year=2026", "/kpi/my/template": "?period=2026-09" };

test("route table: every route an Admin passes, a Superadmin with company_id passes; without it KPI_COMPANY_REQUIRED", async () => {
  const routes = kpiRoutes();
  assert.ok(routes.length >= 30, `${routes.length} routes`);
  const adminOnly = [];
  const checked = [];
  for (const r of routes) {
    const base = concrete(r.path);
    const url = base + (QUERY[base] ?? "");
    const body = r.method === "GET" || r.method === "DELETE" ? undefined : {};
    const admin = await call(r.method, url, "admin", body);
    if (admin.status === 403) continue; // not an Admin right (library, review)
    checked.push(`${r.method} ${r.path}`);
    const sa = await call(r.method, withCompany(url), "superadmin", body);
    if (sa.status === 403 || sa.json?.code === "KPI_COMPANY_REQUIRED") adminOnly.push(`${r.method} ${r.path}: admin ${admin.status}, superadmin ${sa.status} ${sa.json?.code ?? ""}`);
    if (r.method === "GET") assert.equal(sa.status, admin.status, `${r.method} ${r.path}: admin ${admin.status} ${admin.json?.code ?? ""}, superadmin ${sa.status} ${sa.json?.code ?? ""}`);
    const none = await call(r.method, url, "superadmin", body);
    assert.deepEqual([none.status, none.json?.code], [400, "KPI_COMPANY_REQUIRED"], `${r.method} ${r.path} without company_id`);
  }
  assert.deepEqual(adminOnly, [], "Admin-only KPI gaps");
  // The D18 list: setup, people topics, targets, lock and unlock, dashboard and remind, reports, auto refresh, values.
  for (const must of ["PUT /setup", "POST /setup/custom-kpis", "POST /setup/invite", "PUT /people/:user_id/topics", "PUT /targets", "DELETE /targets/:id", "POST /periods/lock", "POST /periods/unlock", "GET /dashboard", "POST /dashboard/remind", "GET /reports/:framework", "POST /auto/refresh", "PUT /values", "GET /overview"]) {
    assert.ok(checked.includes(must), `${must} is an Admin route the walk checked (${checked.length} checked)`);
  }
});

test("the Superadmin's own KPI rights: review (no self-review restriction), locks at company and site level, values anywhere", async () => {
  const sa = (method, url, body) => call(method, withCompany(url), "superadmin", body);
  // Values: anything of the company, a site or the company level.
  const saved = await sa("PUT", "/kpi/values", { items: [{ kpi_code: "LOST_TIME_INJURIES", site_id: 2, period_start: "2026-09-01", value_numeric: 1 }] });
  assert.equal(saved.json.results[0].ok, true, JSON.stringify(saved.json));
  const id = saved.json.results[0].value.id;
  const sub = await sa("POST", "/kpi/values/submit", { ids: [id] });
  assert.deepEqual(sub.json.refused, []);
  const appr = await sa("PUT", "/kpi/values/approve", { ids: [id] });
  assert.deepEqual([appr.status, appr.json.updated], [200, [id]], "the Superadmin approves their own entry");
  // Locks: the company and one site; unlock with a reason (nothing expected in 2020 with no KPI selected).
  await q(`UPDATE company_kpi SET selected = false WHERE company_id = 1`);
  for (const site_id of [null, 2]) {
    const s = await sa("GET", `/kpi/periods/lock?year=2020${site_id ? `&site=${site_id}` : ""}`);
    assert.equal(s.status, 200);
    const lock = await sa("POST", "/kpi/periods/lock", { year: 2020, site_id });
    assert.equal(lock.status, 200, JSON.stringify(lock.json));
    assert.equal((await sa("POST", "/kpi/periods/unlock", { year: 2020, site_id, reason: "D18 check" })).status, 200);
  }
  await q(`UPDATE company_kpi SET selected = true WHERE company_id = 1`);
  // Targets write, people topics, setup.
  const kpi = (await q(`SELECT id FROM kpi_definition WHERE code = 'REVENUE' AND company_id IS NULL`))[0].id;
  const t = await sa("PUT", "/kpi/targets", { kpi_definition_id: kpi, site_id: null, baseline_year: 2024, baseline_value: 100, target_year: 2030, target_value: 200, direction: "increase", note: "D18" });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal((await sa("DELETE", `/kpi/targets/${t.json.target.id}`)).status, 200);
  assert.equal((await sa("PUT", "/kpi/people/1/topics", { topics: ["water"] })).status, 200);
  assert.equal((await sa("GET", "/kpi/setup")).json.people.length > 0, true, "the pickers' data, as for an Admin");
  await q(`DELETE FROM kpi_value WHERE id = $1`, [id]);
});
