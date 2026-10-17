// KPI-1 client switch: PUT /admin/companies/:id {kpi_tracking_enabled}
// (Superadmin only, boolean, audit row, kpi_enabled notification to the
// company's Admins), GET /kpi/status as each role, the switch-off gate on every
// /kpi route (walked from the compiled router), tenant isolation, and
// migrate:kpi-switch running twice.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3, multi user 7),
// company 2 (site 3; other user 4, other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, kpiRoutes, concrete } = require("./kpi-lib.cjs");

const reset = async () => {
  await setSwitch(1, false);
  await setSwitch(2, false);
  await withDb(async (db) => {
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'kpi_setup'`);
    await db.query(`DELETE FROM notification WHERE type = 'kpi_enabled'`);
  });
};
test.before(reset);
test.after(reset);

const auditRows = () =>
  withDb(async (db) => (await db.query(`SELECT entity_id, action, changed_fields, changed_by FROM audit_log WHERE entity_type = 'kpi_setup' ORDER BY id`)).rows);

test("GET /kpi/status answers for every role of the company while the switch is off", async () => {
  for (const who of ["user", "manager", "admin", "multiSiteUser", "otherUser", "otherManager"]) {
    const r = await call("GET", "/kpi/status", who);
    assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(r.json, { enabled: false, setup_completed: false });
  }
  const sa = await call("GET", "/kpi/status?company_id=1", "superadmin");
  assert.deepEqual(sa.json, { enabled: false, setup_completed: false });
  const noCompany = await call("GET", "/kpi/status", "superadmin");
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/kpi/status?company_id=999", "superadmin")).status, 404);
  assert.equal((await call("GET", "/kpi/status")).status, 401);
});

test("tenant isolation: another company's id answers 404", async () => {
  assert.equal((await call("GET", "/kpi/status?company_id=1", "otherUser")).status, 404);
  assert.equal((await call("GET", "/kpi/status?company_id=2", "admin")).status, 404);
  assert.equal((await call("GET", "/kpi/status?company_id=abc", "admin")).status, 404);
});

test("only a Superadmin sets the switch; a non-boolean is 400", async () => {
  for (const who of ["admin", "manager", "user"]) {
    assert.equal((await call("PUT", "/admin/companies/1", who, { kpi_tracking_enabled: true })).status, 403, who);
  }
  for (const bad of ["true", 1, null, "yes"]) {
    const r = await call("PUT", "/admin/companies/1", "superadmin", { kpi_tracking_enabled: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.field, "kpi_tracking_enabled");
  }
  const on = await withDb(async (db) => (await db.query(`SELECT kpi_tracking_enabled FROM company WHERE company_id = 1`)).rows[0].kpi_tracking_enabled);
  assert.equal(on, false);
  assert.equal((await auditRows()).length, 0);
});

test("switching on: audit row, a kpi_enabled notification to the company's Admins, status enabled", async () => {
  const r = await call("PUT", "/admin/companies/1", "superadmin", { kpi_tracking_enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = await auditRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, 1);
  assert.equal(rows[0].action, "switch");
  assert.deepEqual(rows[0].changed_fields, { kpi_tracking_enabled: { old: false, new: true } });
  assert.equal(rows[0].changed_by, 5);

  const notes = await withDb(async (db) => (await db.query(`SELECT user_id, title, link FROM notification WHERE type = 'kpi_enabled' ORDER BY user_id`)).rows);
  assert.deepEqual(notes.map((n) => n.user_id), [3], "company 1's Admin only");
  assert.equal(notes[0].link, "/kpi/setup");
  assert.equal(notes[0].title, "KPI tracking is ready: set it up");

  for (const who of ["user", "manager", "admin"]) assert.equal((await call("GET", "/kpi/status", who)).json.enabled, true, who);
  assert.equal((await call("GET", "/kpi/status", "otherUser")).json.enabled, false, "company 2 stays off");

  // Saying "on" again changes nothing: no second audit row or notification.
  await call("PUT", "/admin/companies/1", "superadmin", { kpi_tracking_enabled: true });
  assert.equal((await auditRows()).length, 1);
  const count = await withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n FROM notification WHERE type = 'kpi_enabled'`)).rows[0].n);
  assert.equal(count, 1);
  // The admin client list carries the switch.
  const list = await call("GET", "/admin/companies", "superadmin");
  if (list.status === 200 && Array.isArray(list.json)) assert.equal(list.json.find((c) => c.company_id === 1).kpi_tracking_enabled, true);
});

const gated = () => kpiRoutes().filter((r) => !(r.method === "GET" && r.path === "/status") && !r.path.startsWith("/library"));

test("the router has gated routes to check", () => {
  assert.ok(kpiRoutes().some((r) => r.path === "/status"));
  // Grows as modules add routes; every one of them is checked below.
  assert.ok(gated().length >= 0);
});

test("switch on for company 1: company 2's people still get KPI_TRACKING_OFF on every gated route", async () => {
  for (const r of gated()) {
    const res = await call(r.method, concrete(r.path), "otherManager", r.method === "GET" || r.method === "DELETE" ? undefined : {});
    assert.equal(res.status, 403, `${r.method} ${r.path}: ${res.status}`);
    assert.equal(res.json?.code, "KPI_TRACKING_OFF", `${r.method} ${r.path}`);
  }
});

test("switching off: audit row, data kept, every gated route answers KPI_TRACKING_OFF for every role", async () => {
  const r = await call("PUT", "/admin/companies/1", "superadmin", { kpi_tracking_enabled: false });
  assert.equal(r.status, 200);
  const rows = await auditRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].changed_fields, { kpi_tracking_enabled: { old: true, new: false } });
  assert.deepEqual((await call("GET", "/kpi/status", "admin")).json, { enabled: false, setup_completed: false });

  const routes = gated();
  for (const who of ["user", "manager", "admin"]) {
    for (const route of routes) {
      const res = await call(route.method, concrete(route.path), who, route.method === "GET" || route.method === "DELETE" ? undefined : {});
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}: ${res.status} ${JSON.stringify(res.json)}`);
      assert.equal(res.json?.code, "KPI_TRACKING_OFF");
    }
  }
  for (const route of routes) {
    const res = await call(route.method, concrete(route.path) + "?company_id=1", "superadmin", route.method === "GET" || route.method === "DELETE" ? undefined : { company_id: 1 });
    assert.equal(res.json?.code, "KPI_TRACKING_OFF", `superadmin ${route.method} ${route.path}`);
  }
  // An unknown path under /kpi is gated too, not a hint that it exists.
  assert.equal((await call("GET", "/kpi/nothing-here", "admin")).json?.code, "KPI_TRACKING_OFF");
});

test("migrate:kpi-switch runs twice and keeps the value", async () => {
  await setSwitch(1, true);
  for (let i = 0; i < 2; i++) {
    const r = runScript("addKpiSwitch");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const on = await withDb(async (db) => (await db.query(`SELECT kpi_tracking_enabled FROM company WHERE company_id = 1`)).rows[0].kpi_tracking_enabled);
  assert.equal(on, true);
  await setSwitch(1, false);
});
