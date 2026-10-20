// DS-0 Design Studio switch: PUT /admin/companies/:id {design_studio_enabled}
// (Superadmin only, boolean, audit row), GET /studio/status as each role with
// KPI tracking on and off, the switch-off gate (DS_STUDIO_OFF) on every /studio
// route (walked from the compiled router plus every 01-contracts §4 endpoint),
// DS_ROLE for Users, tenant isolation, the kind guard, and
// migrate:ds-0-switch running twice.
//
// Fixture: company 1 (sites 1, 2; user 1, manager 2, admin 3, multi user 7),
// company 2 (site 3; other user 4, other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { call, withDb } = require("../helpers.cjs");
const { setStudio, setKpi, runScript, studioRoutes, gatedStudioRoutes, callAs } = require("./ds-lib.cjs");

const OFF = { enabled: false, kinds: { ghg: false, sustainability: false } };

const reset = async () => {
  for (const id of [1, 2]) {
    await setStudio(id, false);
    await setKpi(id, false);
  }
  await withDb((db) => db.query(`DELETE FROM audit_log WHERE entity_type IN ('design_studio', 'kpi_setup')`));
};
test.before(reset);
test.after(reset);

const auditRows = () =>
  withDb(async (db) => (await db.query(`SELECT entity_id, action, changed_fields, changed_by FROM audit_log WHERE entity_type = 'design_studio' ORDER BY id`)).rows);
const studioOn = (id) => withDb(async (db) => (await db.query(`SELECT design_studio_enabled FROM company WHERE company_id = $1`, [id])).rows[0].design_studio_enabled);

test("the column defaults to off for every company", async () => {
  const rows = await withDb(async (db) => (await db.query(`SELECT company_id, design_studio_enabled FROM company ORDER BY company_id`)).rows);
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(r.design_studio_enabled, false, `company ${r.company_id}`);
  const col = await withDb(async (db) => (await db.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'company' AND column_name = 'design_studio_enabled'`)).rows[0]);
  assert.equal(col.is_nullable, "NO");
  assert.equal(col.column_default, "false");
});

test("GET /studio/status answers for every role of the company while the switch is off", async () => {
  for (const who of ["user", "manager", "admin", "multiSiteUser", "otherUser", "otherManager"]) {
    const r = await call("GET", "/studio/status", who);
    assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.json)}`);
    assert.deepEqual(r.json, OFF, who);
  }
  assert.deepEqual((await call("GET", "/studio/status?company_id=1", "superadmin")).json, OFF);
  const noCompany = await call("GET", "/studio/status", "superadmin");
  assert.equal(noCompany.status, 400);
  assert.equal(noCompany.json.code, "DS_COMPANY_REQUIRED");
  const missing = await call("GET", "/studio/status?company_id=999", "superadmin");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, "DS_DOC_NOT_FOUND");
  assert.equal((await call("GET", "/studio/status")).status, 401);
});

test("tenant isolation: another company's id answers 404, on /status and behind the guard", async () => {
  await setStudio(1, true);
  try {
    for (const [who, id] of [["otherUser", 1], ["otherManager", 1], ["admin", 2], ["manager", 2], ["admin", "abc"]]) {
      const r = await call("GET", `/studio/status?company_id=${id}`, who);
      assert.equal(r.status, 404, `${who} → company ${id}`);
      assert.equal(r.json.code, "DS_DOC_NOT_FOUND");
    }
    // Company 2's manager can't reach company 1's (on) studio by naming it.
    const r = await call("GET", "/studio/docs?company_id=1", "otherManager");
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "DS_DOC_NOT_FOUND");
  } finally {
    await setStudio(1, false);
  }
});

test("only a Superadmin sets the switch; a non-boolean is 400", async () => {
  for (const who of ["admin", "manager", "user", "otherManager"]) {
    assert.equal((await call("PUT", "/admin/companies/1", who, { design_studio_enabled: true })).status, 403, who);
  }
  for (const bad of ["true", 1, null, "yes", {}]) {
    const r = await call("PUT", "/admin/companies/1", "superadmin", { design_studio_enabled: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.code, "FIELD_INVALID");
    assert.equal(r.json.field, "design_studio_enabled");
  }
  assert.equal(await studioOn(1), false);
  assert.equal((await auditRows()).length, 0);
});

test("switching on: an audit row, status enabled; the sustainability kind follows KPI tracking", async () => {
  const r = await call("PUT", "/admin/companies/1", "superadmin", { design_studio_enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = await auditRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, 1);
  assert.equal(rows[0].action, "switch");
  assert.deepEqual(rows[0].changed_fields, { design_studio_enabled: { old: false, new: true } });
  assert.equal(rows[0].changed_by, 5);

  // KPI tracking off: GHG only.
  for (const who of ["user", "manager", "admin"]) {
    assert.deepEqual((await call("GET", "/studio/status", who)).json, { enabled: true, kinds: { ghg: true, sustainability: false } }, who);
  }
  // KPI tracking on: both kinds.
  await setKpi(1, true);
  for (const who of ["manager", "admin"]) {
    assert.deepEqual((await call("GET", "/studio/status", who)).json, { enabled: true, kinds: { ghg: true, sustainability: true } }, who);
  }
  assert.deepEqual((await call("GET", "/studio/status?company_id=1", "superadmin")).json, { enabled: true, kinds: { ghg: true, sustainability: true } });
  // KPI on but the studio off (company 2): nothing.
  await setKpi(2, true);
  assert.deepEqual((await call("GET", "/studio/status", "otherManager")).json, OFF, "company 2 stays off");
  await setKpi(2, false);
  await setKpi(1, false);

  // Saying "on" again changes nothing: no second audit row.
  await call("PUT", "/admin/companies/1", "superadmin", { design_studio_enabled: true });
  assert.equal((await auditRows()).length, 1);
  // The admin client list carries the switch.
  const list = await call("GET", "/admin/companies", "superadmin");
  assert.equal(list.status, 200);
  assert.equal(list.json.find((c) => c.company_id === 1).design_studio_enabled, true);
  assert.equal(list.json.find((c) => c.company_id === 2).design_studio_enabled, false);
});

test("the router: /status is open, everything else is behind the guard", () => {
  const routes = studioRoutes();
  assert.ok(routes.some((r) => r.method === "GET" && r.path === "/status"));
  assert.ok(gatedStudioRoutes().length >= 46, "every 01-contracts §4 endpoint is checked");
});

test("switch on for company 1: Users get DS_ROLE, Admins and Managers pass the guard, company 2 stays off", async () => {
  for (const route of gatedStudioRoutes()) {
    for (const who of ["user", "multiSiteUser"]) {
      const res = await callAs(route, who, 1);
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}: ${res.status}`);
      assert.equal(res.json?.code, "DS_ROLE", `${who} ${route.method} ${route.path}`);
    }
    for (const who of ["otherManager", "otherUser"]) {
      const res = await callAs(route, who, 2);
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}`);
      assert.equal(res.json?.code, "DS_STUDIO_OFF", `${who} ${route.method} ${route.path}`);
    }
  }
  // Past the guard there is nothing yet (later modules add routes): never a switch or role error.
  for (const who of ["manager", "admin", "superadmin"]) {
    const res = await callAs({ method: "GET", path: "/studio/nothing-here" }, who, 1);
    assert.ok(!["DS_STUDIO_OFF", "DS_ROLE"].includes(res.json?.code), `${who}: ${res.status} ${JSON.stringify(res.json)}`);
  }
});

test("switching off: an audit row, and every gated route answers DS_STUDIO_OFF for every role", async () => {
  const r = await call("PUT", "/admin/companies/1", "superadmin", { design_studio_enabled: false });
  assert.equal(r.status, 200);
  const rows = await auditRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].changed_fields, { design_studio_enabled: { old: true, new: false } });
  assert.deepEqual((await call("GET", "/studio/status", "admin")).json, OFF);

  for (const route of gatedStudioRoutes()) {
    for (const who of ["user", "manager", "admin", "superadmin"]) {
      const res = await callAs(route, who, 1);
      assert.equal(res.status, 403, `${who} ${route.method} ${route.path}: ${res.status} ${JSON.stringify(res.json)}`);
      assert.equal(res.json?.code, "DS_STUDIO_OFF", `${who} ${route.method} ${route.path}`);
    }
  }
  // An unknown path under /studio is gated too, not a hint that it exists.
  assert.equal((await call("GET", "/studio/nothing-here", "admin")).json?.code, "DS_STUDIO_OFF");
  assert.equal((await call("GET", "/studio/docs")).status, 401, "authenticate first");
});

test("both switches in one request: one audit row each", async () => {
  const r = await call("PUT", "/admin/companies/2", "superadmin", { design_studio_enabled: true, kpi_tracking_enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = await withDb(async (db) => (await db.query(`SELECT entity_type, changed_fields FROM audit_log WHERE entity_id = 2 AND entity_type IN ('design_studio', 'kpi_setup') ORDER BY id`)).rows);
  assert.deepEqual(rows.map((x) => x.entity_type).sort(), ["design_studio", "kpi_setup"]);
  assert.deepEqual((await call("GET", "/studio/status", "otherManager")).json, { enabled: true, kinds: { ghg: true, sustainability: true } });
  await call("PUT", "/admin/companies/2", "superadmin", { design_studio_enabled: false, kpi_tracking_enabled: false });
  await withDb((db) => db.query(`DELETE FROM notification WHERE type = 'kpi_enabled'`));
});

test("the kind guard: sustainability needs KPI tracking, GHG does not", () => {
  const guard = require(path.resolve(__dirname, "../../../dist/studio/guard.js"));
  assert.equal(guard.assertKind({ kpiEnabled: false }, "ghg"), "ghg");
  assert.equal(guard.assertKind({ kpiEnabled: true }, "sustainability"), "sustainability");
  assert.throws(() => guard.assertKind({ kpiEnabled: false }, "sustainability"), (e) => e.code === "DS_KIND_OFF" && e.status === 403);
  assert.throws(() => guard.assertKind({ kpiEnabled: true }, "brochure"), (e) => e.code === "DS_VALIDATION");
  assert.deepEqual(guard.studioKinds(false, true), { ghg: false, sustainability: false });
  assert.deepEqual(guard.studioKinds(true, false), { ghg: true, sustainability: false });

  // requireKind and requireManager as middleware.
  const run = (mw, req) => {
    let status = 0;
    let body = null;
    let passed = false;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    mw(req, res, () => (passed = true));
    return { status, body, passed };
  };
  const studio = (roleClass, kpiEnabled) => ({ companyId: 1, userId: 2, role: roleClass === "M" ? "Manager" : "Admin", roleClass, sites: null, kpiEnabled });
  assert.equal(run(guard.requireKind(), { body: { kind: "ghg" }, query: {}, studio: studio("R", false) }).passed, true);
  const off = run(guard.requireKind(), { body: {}, query: { kind: "sustainability" }, studio: studio("R", false) });
  assert.deepEqual([off.passed, off.status, off.body.code], [false, 403, "DS_KIND_OFF"]);
  assert.equal(run(guard.requireManager, { studio: studio("M", false) }).passed, true);
  const admin = run(guard.requireManager, { studio: studio("R", false) });
  assert.deepEqual([admin.passed, admin.status, admin.body.code], [false, 403, "DS_ROLE"]);
});

test("migrate:ds-0-switch runs twice and keeps the value", async () => {
  await setStudio(1, true);
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateDs0Switch");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /design_studio_enabled present/);
  }
  assert.equal(await studioOn(1), true);
  await setStudio(1, false);
});
