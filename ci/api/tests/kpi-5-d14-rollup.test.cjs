// KPI-5 × D14 review fix: GHG auto values are stored per site and period, each
// the GHG report's figure for that site and period (its rows' kg rounded once).
// Each keeps its rows' exact kg (auto_snapshot.kg), and the company and year
// figures add that kg and round once, so they are the report's figure for the
// same sites and year, not the rounded parts added up.
//
// Company 1, CY 2014 (no other test writes that year), every row 1,000.4 kgCO₂e
// (stored 1.0 t: 1.0004 to 3 dp). Worked by hand:
//   Scope 1 (monthly KPI): site 1 in January and February, site 2 in January.
//     each site-month 1,000.4 kg → 1.0 t
//     company year 3 × 1,000.4 = 3,001.2 kg → 3.001 t   (parts added: 1 + 1 + 1 = 3.0)
//     site 1 year 2 × 1,000.4 = 2,000.8 kg → 2.001 t   (1 + 1 = 2.0)
//     January, both sites 2,000.8 kg → 2.001 t        (1 + 1 = 2.0)
//   Scope 2 (annual KPI): one row at each site in March.
//     each site 1,000.4 kg → 1.0 t; company 2,000.8 kg → 2.001 t   (1 + 1 = 2.0)
//
// Rows use pk_id 82120–82129.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const YEAR = 2014;
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);

const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id = 1)`);
  await q(`DELETE FROM kpi_value WHERE company_id = 1`);
  await q(`DELETE FROM audit_log WHERE entity_type = 'kpi_value'`);
  await clearSetup();
  await q(`DELETE FROM emission WHERE pk_id BETWEEN 82120 AND 82129`);
};
const insert = (id, category, site, date) =>
  q(
    `INSERT INTO emission (pk_id, activity_data, total_emission, total_kgco2e, unit, date_of_reporting, status, category_id, site_id, reporting_period)
     VALUES ($1, '{"activity_value": 1}', 1.0, 1000.4, 'tCO2e', $2, 'approved', $3, $4, 'monthly')`,
    [id, date, category, site],
  );

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  const [other] = await q(
    `SELECT COUNT(*)::int AS n FROM emission e JOIN site s ON s.site_id = e.site_id WHERE s.company_id = 1 AND e.status = 'approved' AND e.date_of_reporting BETWEEN $1 AND $2`,
    [`${YEAR}-01-01`, `${YEAR}-12-31`],
  );
  assert.equal(other.n, 0, `company 1 has no other approved rows in ${YEAR}`);
  await insert(82120, 1, 1, `${YEAR}-01-15`);
  await insert(82121, 1, 1, `${YEAR}-02-15`);
  await insert(82122, 1, 2, `${YEAR}-01-15`);
  await insert(82123, 2, 1, `${YEAR}-03-15`);
  await insert(82124, 2, 2, `${YEAR}-03-15`);
  await setupCompany(1, { frameworks: ["GRI"], kpis: ["GHG_SCOPE1", "GHG_SCOPE2_LB"], frequencies: { GHG_SCOPE1: "monthly" } });
  await setSwitch(1, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
});

const ok = (r, what) => {
  assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.json)}`);
  return r.json;
};

test("GHG KPIs roll sites and periods up in kg: the company and year figures are the GHG report's", async () => {
  ok(await call("POST", `/kpi/auto/refresh?year=${YEAR}`, "admin"), "refresh");
  const stored = await q(
    `SELECT d.code, v.site_id, v.period_start::text AS start, v.value_canonical::float8 AS value, v.auto_snapshot->'kg' AS kg
       FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = 1 ORDER BY d.code, v.site_id, v.period_start`,
  );
  // Each stored value stays the report's figure for its site and period, and keeps its rows' kg.
  assert.deepEqual(stored, [
    { code: "GHG_SCOPE1", site_id: 1, start: `${YEAR}-01-01`, value: 1, kg: 1000.4 },
    { code: "GHG_SCOPE1", site_id: 1, start: `${YEAR}-02-01`, value: 1, kg: 1000.4 },
    { code: "GHG_SCOPE1", site_id: 2, start: `${YEAR}-01-01`, value: 1, kg: 1000.4 },
    { code: "GHG_SCOPE2_LB", site_id: 1, start: `${YEAR}-01-01`, value: 1, kg: 1000.4 },
    { code: "GHG_SCOPE2_LB", site_id: 2, start: `${YEAR}-01-01`, value: 1, kg: 1000.4 },
  ]);

  const report = ok(await call("POST", "/user/ghg/tables", "admin", { siteIds: [1, 2], yearType: "CY", year: YEAR }), "ghg tables").totals[String(YEAR)];
  assert.deepEqual([report.scope1, report.scope2], [3.001, 2.001]);
  const jan = ok(await call("POST", "/user/ghg/tables", "admin", { siteIds: [1, 2], yearType: "CY", year: YEAR, frequency: "monthly", month: 1 }), "ghg tables, January").totals[String(YEAR)];
  const site1 = ok(await call("POST", "/user/ghg/tables", "admin", { siteIds: [1], yearType: "CY", year: YEAR }), "ghg tables, site 1").totals[String(YEAR)];

  const card = (d, code) => d.cards.find((c) => c.code === code);
  const all = ok(await call("GET", `/kpi/dashboard?year=${YEAR}`, "admin"), "dashboard");
  assert.equal(card(all, "GHG_SCOPE1").value, 3.001);
  assert.equal(card(all, "GHG_SCOPE1").value, report.scope1, "company Scope 1 = the report");
  assert.equal(card(all, "GHG_SCOPE2_LB").value, report.scope2, "company Scope 2 = the report (2.001)");
  const janPoint = card(all, "GHG_SCOPE1").series.find((p) => p.period_start === `${YEAR}-01-01`);
  assert.equal(janPoint.value, 2.001);
  assert.equal(janPoint.value, jan.scope1, "January across both sites = the report for January");

  const one = ok(await call("GET", `/kpi/dashboard?year=${YEAR}&site=1`, "admin"), "dashboard, site 1");
  assert.equal(card(one, "GHG_SCOPE1").value, 2.001);
  assert.equal(card(one, "GHG_SCOPE1").value, site1.scope1, "site 1's year = the report for site 1");
});
