// KPI-11 framework reports: GET /kpi/reports/:framework as JSON (approved
// values only, display units, previous year, omissions, the audit trail with
// approver and evidence names), XLSX for GRI, BRSR and ESRS, the GRI PDF
// (when a browser is installed; CI skips the download), report auth with
// ?token=, auto GHG figures equal to the GHG report's own (and the
// dashboard's), the role matrix, tenant isolation, sites, setup first and the
// switch. The model itself is checked against hand-worked goldens in
// ci/unit/kpi-reports.test.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const XLSX = require("xlsx");
const { call, withDb, USERS } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, kpiRoutes, concrete } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const ids = {};
const EMISSIONS = [9811, 9812];
const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_target WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM notification WHERE type LIKE 'kpi_%'`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_value', 'emission') AND (entity_type = 'kpi_value' OR entity_id = ANY($1::int[]))`, [EMISSIONS]);
  await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [EMISSIONS]);
  await clearSetup();
};
const entered = async (who, item) => {
  const r = await call("PUT", "/kpi/values", who, { items: [item] });
  assert.equal(r.json.results?.[0]?.ok, true, JSON.stringify(r.json));
  return r.json.results[0].value.id;
};
const approved = (code, site, start, freq, v) =>
  q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
     VALUES (1, $1, $2, $3, (($3::date + CASE WHEN $4 = 'annual' THEN interval '1 year' ELSE interval '1 month' END) - interval '1 day')::date, $4, 'CY', $5, NULL, $5, 'manual', 'approved') RETURNING id`,
    [site, ids[code], start, freq, v],
  );
const report = async (who, fw, qs = "") => {
  const r = await call("GET", `/kpi/reports/${fw}?year=2026${qs}`, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const item = (rep, disclosure, code) => rep.rows.find((r) => r.code === disclosure)?.items.find((i) => i.code === code);

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTargets"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI", "BRSR", "ESRS"], kpis: ["WATER_WITHDRAWAL", "GHG_SCOPE1", "AIR_NOX"], frequencies: { WATER_WITHDRAWAL: "annual" } });
  await setupCompany(2, { frameworks: ["GRI"], kpis: ["WATER_WITHDRAWAL"], completed: false });
  for (const code of ["WATER_WITHDRAWAL", "GHG_SCOPE1", "AIR_NOX"]) ids[code] = (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
  await q(`INSERT INTO company_material_topic (company_id, esrs_topic, material, reason) VALUES (1, 'E1', true, NULL), (1, 'E2', true, NULL), (1, 'E3', false, 'No water stress')`);
  await setSwitch(1, true);
  await setSwitch(2, true);

  // Water 2026: site 1 entered, evidenced, submitted and approved through the API; site 2 only pending.
  ids.w1 = await entered("user", { kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-01-01", value_numeric: 1200 });
  await call("POST", `/kpi/values/${ids.w1}/evidence`, "user", { document_url: "https://x.invalid/bill.pdf", document_name: "water-bill-2026.pdf" });
  await call("POST", "/kpi/values/submit", "user", { ids: [ids.w1] });
  assert.deepEqual((await call("PUT", "/kpi/values/approve", "manager", { ids: [ids.w1] })).json.updated, [ids.w1]);
  ids.w2 = await entered("multiSiteUser", { kpi_code: "WATER_WITHDRAWAL", site_id: 2, period_start: "2026-01-01", value_numeric: 800 });
  await call("POST", `/kpi/values/${ids.w2}/evidence`, "multiSiteUser", { document_url: "https://x.invalid/b.pdf", document_name: "b.pdf" });
  await call("POST", "/kpi/values/submit", "multiSiteUser", { ids: [ids.w2] });
  ids.wPrev = (await approved("WATER_WITHDRAWAL", 1, "2025-01-01", "annual", 1000))[0].id;
  ids.nox = (await approved("AIR_NOX", 2, "2026-01-01", "annual", 1.5))[0].id;
  // Scope 1 from approved emission rows (KPI-5 refresh), one on each site.
  for (const [pk, site, t] of [[9811, 1, 2.5], [9812, 2, 1.25]]) {
    await q(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, activity_data_unit)
       VALUES ($1, '{"activity_value": 1000, "emission_category": "Diesel"}', $2, 'tCO2e', '2026-03-31', 'approved', 1, 1, $3, 'monthly', 'litre')`,
      [pk, t, site],
    );
  }
  const refresh = await call("POST", "/kpi/auto/refresh?year=2026", "manager");
  assert.equal(refresh.status, 200, JSON.stringify(refresh.json));
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

test("JSON: approved values only, in each framework's unit, with the previous year, omissions and the audit trail", async () => {
  const gri = await report("manager", "GRI");
  const m = gri;
  assert.deepEqual([m.framework, m.version, m.year, m.label, m.previous_label, m.company.name], ["GRI", "GRI 2021+", 2026, "2026", "2025", "CI Steel Co"]);
  assert.deepEqual(m.sites.map((s) => s.site_id), [1, 2]);
  const w = item(gri, "303-3", "WATER_WITHDRAWAL");
  assert.deepEqual([w.value, w.previous, w.unit, w.complete, w.missing_sites, w.value_ids, w.evidence_count], [1.2, 1, "ML", false, [2], [ids.w1], 1], "1,200 kL = 1.2 ML; site 2 is pending");
  assert.ok(m.pending_ids.includes(ids.w2));
  assert.equal(m.pending_count, 1);
  const row = m.rows.find((r) => r.code === "303-3");
  assert.deepEqual([row.value, row.previous, row.unit, row.fit, row.requirement, row.kpi_definition_ids, row.value_ids, row.evidence_count, row.sites], [1.2, 1, "ML", "exact", "required", [ids.WATER_WITHDRAWAL], [ids.w1], 1, [1]]);
  const om = m.omissions.find((o) => o.code === "401-1");
  assert.deepEqual([om.kind, om.reason_kind, om.esrs_topic], ["not_tracked", "not_tracked", null]);
  assert.equal(m.omissions.find((o) => o.code === "401-1").reason, "Not tracked in ESGLite");
  const trail = gri.audit_trail.find((a) => a.value_id === ids.w1);
  assert.deepEqual([trail.kpi_code, trail.site_name, trail.period_label, trail.value, trail.approved_by, trail.approved_by_name, trail.evidence], ["WATER_WITHDRAWAL", "CI Plant A", "2026", 1200, 2, "CI Manager", ["water-bill-2026.pdf"]]);
  assert.ok(trail.approved_at);
  assert.ok(gri.audit_trail.some((a) => a.value_id === ids.wPrev), "the previous year's values too");
  assert.ok(!gri.audit_trail.some((a) => a.value_id === ids.w2), "never a pending value");

  const esrs = await report("admin", "esrs");
  assert.deepEqual([item(esrs, "E2-4", "AIR_NOX").value, item(esrs, "E2-4", "AIR_NOX").unit], [1500, "kg"], "1.5 t = 1,500 kg");
  const e3 = esrs.omissions.find((o) => o.code === "E3-4");
  assert.deepEqual([e3.reason_kind, e3.reason], ["not_material", "No water stress"]);
  const brsr = await report("manager", "BRSR");
  assert.deepEqual([item(brsr, "P6-E3", "WATER_WITHDRAWAL").value, item(brsr, "P6-E3", "WATER_WITHDRAWAL").unit], [1200, "kL"]);
  assert.equal(item(brsr, "P6-E6", "AIR_NOX").value, 1.5);
});

test("auto GHG figures equal the GHG report's own (and the dashboard's)", async () => {
  const t = await call("POST", "/user/ghg/tables", "admin", { siteIds: [1, 2], yearType: "CY", year: 2026 });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const want = Number(t.json.totals["2026"].scope1);
  assert.ok(want >= 3.75, `the two rows at least (${want})`);
  const s1 = item(await report("manager", "GRI"), "305-1", "GHG_SCOPE1");
  assert.equal(s1.value, want);
  assert.equal(item(await report("manager", "BRSR"), "P6-E7", "GHG_SCOPE1").value, want);
  const dash = await call("GET", "/kpi/dashboard?year=2026", "manager");
  assert.equal(dash.json.cards.find((c) => c.code === "GHG_SCOPE1").value, want);
  // A single site's report equals that site's GHG table.
  const t1 = await call("POST", "/user/ghg/tables", "admin", { siteIds: [1], yearType: "CY", year: 2026 });
  assert.equal(item(await report("manager", "GRI", "&sites=1"), "305-1", "GHG_SCOPE1").value, Number(t1.json.totals["2026"].scope1));
});

test("XLSX for each framework: sheet names, headers, the audit trail", async () => {
  const xlsx = async (fw) => {
    const r = await call("GET", `/kpi/reports/${fw}?year=2026&format=xlsx`, "manager");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.match(r.headers.get("content-disposition"), new RegExp(`attachment; filename="${fw}-CI-Steel-Co-2026.xlsx"`));
    assert.equal(r.headers.get("access-control-expose-headers"), "Content-Disposition");
    return XLSX.read(r.buffer, { type: "buffer" });
  };
  const gri = await xlsx("GRI");
  assert.deepEqual(gri.SheetNames, ["GRI content index", "Audit trail"]);
  const trail = XLSX.utils.sheet_to_json(gri.Sheets["Audit trail"], { header: 1, defval: null });
  assert.deepEqual(trail[0].slice(0, 3), ["Value id", "KPI code", "KPI"]);
  assert.ok(trail.some((r) => r[0] === ids.w1 && r[10] === "CI Manager" && r[12] === "water-bill-2026.pdf"));
  assert.deepEqual((await xlsx("BRSR")).SheetNames, ["Section A", "Principle 1", "Principle 3", "Principle 5", "Principle 6", "Principle 9", "Audit trail"]);
  assert.deepEqual((await xlsx("ESRS")).SheetNames, ["Datapoints", "Not material", "Audit trail"]);
});

test("GRI PDF (skipped when no browser is installed); PDF is GRI only", async (t) => {
  const brsr = await call("GET", "/kpi/reports/BRSR?year=2026&format=pdf", "manager");
  assert.deepEqual([brsr.status, brsr.json.code], [400, "KPI_VALIDATION"]);
  let browser = null;
  try {
    browser = await require("playwright").chromium.launch();
  } catch {
    t.skip("no Chromium for Playwright here (CI sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)");
    return;
  } finally {
    if (browser) await browser.close();
  }
  const r = await call("GET", "/kpi/reports/GRI?year=2026&format=pdf", "manager");
  assert.equal(r.status, 200, r.json ? JSON.stringify(r.json) : "");
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.equal(r.buffer.subarray(0, 5).toString(), "%PDF-");
});

test("report auth: the token in the query works for reports (a browser download), and only for reports", async () => {
  const token = jwt.sign(USERS.manager, process.env.JWT_SECRET);
  const viaQuery = await fetch(`${process.env.API_BASE}/kpi/reports/GRI?year=2026&format=xlsx&token=${token}`);
  assert.equal(viaQuery.status, 200);
  assert.equal((await fetch(`${process.env.API_BASE}/kpi/dashboard?year=2026&token=${token}`)).status, 401, "other KPI routes need the header");
  assert.equal((await fetch(`${process.env.API_BASE}/kpi/reports/GRI?year=2026&token=nonsense`)).status, 401);
  assert.equal((await fetch(`${process.env.API_BASE}/kpi/reports/GRI?year=2026`)).status, 401);
});

test("who may: Managers, Admins, the Superadmin; Users can't; tenant isolation; sites; framework enabled; setup first", async () => {
  for (const who of ["user", "multiSiteUser"]) {
    const r = await call("GET", "/kpi/reports/GRI?year=2026", who);
    assert.deepEqual([r.status, r.json.code], [403, "KPI_FORBIDDEN"], who);
  }
  assert.equal((await call("GET", "/kpi/reports/GRI?year=2026", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/kpi/reports/GRI?year=2026&company_id=1", "superadmin")).status, 200);
  assert.equal((await call("GET", "/kpi/reports/GRI?year=2026&company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/kpi/reports/GRI?year=2026&sites=3", "manager")).status, 404, "company 2's site");
  assert.equal((await call("GET", "/kpi/reports/ISSB?year=2026", "manager")).status, 404);
  assert.equal((await call("GET", "/kpi/reports/GRI", "manager")).json.code, "KPI_VALIDATION");
  assert.equal((await call("GET", "/kpi/reports/GRI?year=2026&format=docx", "manager")).status, 400);
  const site2 = await report("manager", "GRI", "&sites=2");
  assert.deepEqual(site2.sites.map((s) => s.site_id), [2]);
  assert.equal(item(site2, "303-3", "WATER_WITHDRAWAL")?.value ?? null, null, "site 2's water is only pending");
  const notSetUp = await call("GET", "/kpi/reports/GRI?year=2026", "otherManager");
  assert.deepEqual([notSetUp.status, notSetUp.json.code], [409, "KPI_SETUP_INCOMPLETE"]);
  await q(`UPDATE company_kpi_settings SET setup_completed_at = now() WHERE company_id = 2`);
  assert.equal((await call("GET", "/kpi/reports/BRSR?year=2026", "otherManager")).status, 404, "company 2 doesn't report on BRSR");
  const other = await report("otherManager", "GRI");
  assert.equal(item(other, "303-3", "WATER_WITHDRAWAL"), undefined, "none of company 1's values");
});

test("switch off: the KPI-11 route answers KPI_TRACKING_OFF", async () => {
  const routes = kpiRoutes().filter((r) => r.path.startsWith("/reports"));
  assert.equal(routes.length, 1);
  await setSwitch(1, false);
  try {
    const res = await call("GET", concrete(routes[0].path) + "?year=2026", "manager");
    assert.deepEqual([res.status, res.json?.code], [403, "KPI_TRACKING_OFF"]);
  } finally {
    await setSwitch(1, true);
  }
});
