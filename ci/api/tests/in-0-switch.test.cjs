// IN-0 Insights switch: PUT /admin/companies/:id {insights_enabled} (Superadmin
// only, boolean, audit row), GET /insights/status as each role with KPI
// tracking on and off, the switch-off gate (IN_OFF) on every /insights route
// (walked from the compiled router plus every 01-contracts §4 endpoint),
// IN_FORBIDDEN for Users (I1), tenant isolation of company_id, the guard's
// caller context, and migrate:in-switch running twice.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3, multi user 7),
// company 2 (site 3; other user 4, other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setInsights, setKpi, runScript, insightsRoutes, gatedInsightsRoutes, callAs } = require("./in-lib.cjs");

const OFF = { enabled: false, kpi_tracking: false };

const reset = async () => {
  for (const id of [1, 2]) {
    await setInsights(id, false);
    await setKpi(id, false);
  }
  await withDb((db) => db.query(`DELETE FROM audit_log WHERE entity_type IN ('insights', 'kpi_setup')`));
};
test.before(reset);
test.after(reset);

const auditRows = () =>
  withDb(async (db) => (await db.query(`SELECT entity_id, action, changed_fields, changed_by FROM audit_log WHERE entity_type = 'insights' ORDER BY id`)).rows);
const insightsOn = (id) => withDb(async (db) => (await db.query(`SELECT insights_enabled FROM company WHERE company_id = $1`, [id])).rows[0].insights_enabled);

test("the column defaults to off for every company", async () => {
  const rows = await withDb(async (db) => (await db.query(`SELECT company_id, insights_enabled FROM company ORDER BY company_id`)).rows);
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(r.insights_enabled, false, `company ${r.company_id}`);
  const col = await withDb(async (db) => (await db.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'company' AND column_name = 'insights_enabled'`)).rows[0]);
  assert.equal(col.is_nullable, "NO");
  assert.equal(col.column_default, "false");
});

test("GET /insights/status answers for every role of the company while the switch is off", async () => {
  for (const who of ["user", "manager", "admin", "multiSiteUser", "otherUser", "otherManager"]) {
    const r = await call("GET", "/insights/status", who);
    assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(r.json, OFF, who);
  }
  assert.deepEqual((await call("GET", "/insights/status?company_id=1", "superadmin")).json, OFF);
  const noCompany = await call("GET", "/insights/status", "superadmin");
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.json.code, "IN_COMPANY_REQUIRED");
  const missing = await call("GET", "/insights/status?company_id=999", "superadmin");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, "IN_SITE_NOT_FOUND");
  assert.equal((await call("GET", "/insights/status")).status, 401);
});

test("tenant isolation: another company's id answers 404, on /status and behind the guard", async () => {
  await setInsights(1, true);
  try {
    for (const [who, id] of [["otherUser", 1], ["otherManager", 1], ["admin", 2], ["manager", 2], ["admin", "abc"]]) {
      const r = await call("GET", `/insights/status?company_id=${id}`, who);
      assert.equal(r.status, 404, `${who} → company ${id}`);
      assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
    }
    // Company 2's manager can't reach company 1's (on) Insights by naming it, on any route.
    for (const route of gatedInsightsRoutes()) {
      const sep = route.path.includes("?") ? "&" : "?";
      const r = await call(route.method, `${route.path}${sep}company_id=1`, "otherManager", route.method === "GET" || route.method === "DELETE" ? undefined : {});
      assert.equal(r.status, 404, `${route.method} ${route.path}`);
      assert.equal(r.json?.code, "IN_SITE_NOT_FOUND", `${route.method} ${route.path}`);
    }
  } finally {
    await setInsights(1, false);
  }
});

test("only a Superadmin sets the switch; a non-boolean is 400", async () => {
  for (const who of ["admin", "manager", "user", "otherManager"]) {
    assert.equal((await call("PUT", "/admin/companies/1", who, { insights_enabled: true })).status, 403, who);
  }
  for (const bad of ["true", 1, null, "yes", {}]) {
    const r = await call("PUT", "/admin/companies/1", "superadmin", { insights_enabled: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.code, "FIELD_INVALID");
    assert.equal(r.json.field, "insights_enabled");
  }
  assert.equal(await insightsOn(1), false);
  assert.equal((await auditRows()).length, 0);
});

test("switching on: an audit row, status enabled; kpi_tracking follows the KPI switch", async () => {
  const r = await call("PUT", "/admin/companies/1", "superadmin", { insights_enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = await auditRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, 1);
  assert.equal(rows[0].action, "switch");
  assert.deepEqual(rows[0].changed_fields, { insights_enabled: { old: false, new: true } });
  assert.equal(rows[0].changed_by, 5);

  for (const who of ["user", "manager", "admin"]) {
    assert.deepEqual((await call("GET", "/insights/status", who)).json, { enabled: true, kpi_tracking: false }, who);
  }
  await setKpi(1, true);
  for (const who of ["manager", "admin"]) {
    assert.deepEqual((await call("GET", "/insights/status", who)).json, { enabled: true, kpi_tracking: true }, who);
  }
  assert.deepEqual((await call("GET", "/insights/status?company_id=1", "superadmin")).json, { enabled: true, kpi_tracking: true });
  // Company 2 stays off.
  assert.deepEqual((await call("GET", "/insights/status", "otherManager")).json, OFF, "company 2 stays off");
  await setKpi(1, false);

  // Saying "on" again changes nothing: no second audit row.
  await call("PUT", "/admin/companies/1", "superadmin", { insights_enabled: true });
  assert.equal((await auditRows()).length, 1);
  // The admin client list carries the switch.
  const list = await call("GET", "/admin/companies", "superadmin");
  assert.equal(list.status, 200);
  assert.equal(list.json.find((c) => c.company_id === 1).insights_enabled, true);
  assert.equal(list.json.find((c) => c.company_id === 2).insights_enabled, false);
});

test("the router: /status is open, everything else is behind the guard", () => {
  const routes = insightsRoutes();
  assert.ok(routes.some((r) => r.method === "GET" && r.path === "/status"));
  assert.ok(gatedInsightsRoutes().length >= 17, "every 01-contracts §4 endpoint is checked");
});

test("role matrix with the switch on: Users get IN_FORBIDDEN, Managers, Admins and Superadmins pass, company 2 stays off", async () => {
  for (const route of gatedInsightsRoutes()) {
    for (const who of ["user", "multiSiteUser"]) {
      const res = await callAs(route, who, 1);
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}: ${res.status}`);
      assert.equal(res.json?.code, "IN_FORBIDDEN", `${who} ${route.method} ${route.path}`);
    }
    for (const who of ["otherManager", "otherUser"]) {
      const res = await callAs(route, who, 2);
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}`);
      assert.equal(res.json?.code, "IN_OFF", `${who} ${route.method} ${route.path}`);
    }
    // Past the guard: never a switch or role error (later modules add the routes).
    for (const who of ["manager", "admin", "superadmin"]) {
      const res = await callAs(route, who, 1);
      assert.ok(!["IN_OFF", "IN_FORBIDDEN", "IN_SITE_NOT_FOUND", "IN_COMPANY_REQUIRED"].includes(res.json?.code), `${who} ${route.method} ${route.path}: ${res.status} ${JSON.stringify(res.json)}`);
    }
  }
  // A Superadmin must name the client behind the guard too.
  const r = await call("GET", "/insights/summary", "superadmin");
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "IN_COMPANY_REQUIRED");
});

test("insightsScope needs the guard; the role list is I1's", () => {
  // The caller context itself (siteIds per role) is read back through GET /insights/sites below:
  // the guard needs the server's database connection, so it is exercised over HTTP.
  const guard = require(path.resolve(__dirname, "../../../dist/insights/guard.js"));
  assert.throws(() => guard.insightsScope({}), /requireInsights did not run/);
  const scope = { companyId: 1, userId: 2, role: "Manager", siteIds: [1, 2], allSites: true, kpiOn: false };
  assert.equal(guard.insightsScope({ insights: scope }), scope);
  for (const role of ["Manager", "Admin", "Superadmin"]) assert.equal(guard.isInsightsRole(role), true, role);
  for (const role of ["User", "", "manager"]) assert.equal(guard.isInsightsRole(role), false, role);
});

test("GET /insights/sites: the caller's sites of the company, by name; site scope for Managers", async () => {
  await setInsights(1, true);
  await setInsights(2, true);
  try {
    const names = await withDb(async (db) => (await db.query(`SELECT site_id, name FROM site ORDER BY name, site_id`)).rows);
    const of = (ids) => names.filter((r) => ids.includes(r.site_id)).map((r) => ({ site_id: r.site_id, name: r.name }));
    for (const who of ["admin", "manager"]) {
      const r = await call("GET", "/insights/sites", who);
      assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.json)}`);
      assert.deepEqual(r.json, { sites: of([1, 2]) }, who);
    }
    assert.deepEqual((await call("GET", "/insights/sites?company_id=1", "superadmin")).json, { sites: of([1, 2]) });
    assert.deepEqual((await call("GET", "/insights/sites", "otherManager")).json, { sites: of([3]) }, "company 2 sees only its own");
    assert.equal((await call("GET", "/insights/sites", "user")).json.code, "IN_FORBIDDEN");
    assert.equal((await call("GET", "/insights/sites?company_id=2", "manager")).json.code, "IN_SITE_NOT_FOUND");
    // Site scope: a Manager of site 1 only sees site 1 (accessibleSiteIds), an Admin still sees both.
    await withDb((db) => db.query(`DELETE FROM user_sites WHERE user_id = 2 AND site_id = 2`));
    try {
      assert.deepEqual((await call("GET", "/insights/sites", "manager")).json, { sites: of([1]) });
      assert.deepEqual((await call("GET", "/insights/sites", "admin")).json, { sites: of([1, 2]) });
    } finally {
      await withDb((db) => db.query(`INSERT INTO user_sites (user_id, site_id) VALUES (2, 2) ON CONFLICT DO NOTHING`));
    }
  } finally {
    await setInsights(1, false);
    await setInsights(2, false);
  }
});

test("switching off: an audit row, and every gated route answers IN_OFF for every role", async () => {
  const r = await call("PUT", "/admin/companies/1", "superadmin", { insights_enabled: false });
  assert.equal(r.status, 200);
  const rows = await auditRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].changed_fields, { insights_enabled: { old: true, new: false } });
  assert.deepEqual((await call("GET", "/insights/status", "admin")).json, OFF);

  for (const route of gatedInsightsRoutes()) {
    for (const who of ["user", "manager", "admin", "superadmin"]) {
      const res = await callAs(route, who, 1);
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}: ${res.status} ${JSON.stringify(res.json)}`);
      assert.equal(res.json?.code, "IN_OFF", `${who} ${route.method} ${route.path}`);
    }
  }
  // An unknown path under /insights is gated too, not a hint that it exists.
  assert.equal((await call("GET", "/insights/nothing-here", "admin")).json?.code, "IN_OFF");
  assert.equal((await call("GET", "/insights/summary")).status, 401, "authenticate first");
});

test("three switches in one request: one audit row each, nothing else changes", async () => {
  const r = await call("PUT", "/admin/companies/2", "superadmin", { insights_enabled: true, kpi_tracking_enabled: true, design_studio_enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = await withDb(async (db) => (await db.query(`SELECT entity_type FROM audit_log WHERE entity_id = 2 AND entity_type IN ('insights', 'kpi_setup', 'design_studio') ORDER BY id`)).rows);
  assert.deepEqual(rows.map((x) => x.entity_type).sort(), ["design_studio", "insights", "kpi_setup"]);
  assert.deepEqual((await call("GET", "/insights/status", "otherManager")).json, { enabled: true, kpi_tracking: true });
  await call("PUT", "/admin/companies/2", "superadmin", { insights_enabled: false, kpi_tracking_enabled: false, design_studio_enabled: false });
  await withDb((db) => db.query(`DELETE FROM notification WHERE type = 'kpi_enabled'`));
  await withDb((db) => db.query(`DELETE FROM audit_log WHERE entity_type = 'design_studio' AND entity_id = 2`));
});

test("migrate:in-switch runs twice and keeps the value", async () => {
  await setInsights(1, true);
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateInSwitch");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /insights_enabled present/);
  }
  assert.equal(await insightsOn(1), true);
  await setInsights(1, false);
});
