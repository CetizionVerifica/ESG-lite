// KPI-6 calculated KPIs through the API: formula values recompute when their
// inputs are submitted (site level and company level after aggregation), wait
// for missing inputs instead of showing 0, say what they wait for, explain
// themselves (auto_snapshot), are read-only (KPI_AUTO_READ_ONLY), stay inside
// their company; library and custom KPIs with a bad formula, a unit mismatch
// or a cycle are refused (KPI_FORMULA_INVALID).
//
// Fixture: company 1 (sites 1, 2; user 1 on site 1, manager 2, admin 3, multi user 7), company 2 (site 3).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_value', 'kpi_library', 'kpi_setup')`);
  await q(`DELETE FROM kpi_disclosure_map WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE company_id IN (1, 2) OR code LIKE 'TEST6_%')`);
  await q(`DELETE FROM kpi_definition WHERE company_id IN (1, 2) OR code LIKE 'TEST6_%'`);
  await clearSetup();
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  // GRI only, so BRSR Core evidence doesn't get in the way of submitting.
  await setupCompany(1, { frameworks: ["GRI"] });
  await setupCompany(2, { frameworks: ["GRI"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const save = async (who, item) => {
  const r = await call("PUT", "/kpi/values", who, { items: [item] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.results[0].ok, true, JSON.stringify(r.json.results[0]));
  return r.json.results[0].value;
};
const submit = async (who, ids) => {
  const r = await call("POST", "/kpi/values/submit", who, { ids });
  assert.deepEqual(r.json.refused, [], JSON.stringify(r.json));
};
const formulaValues = (code, who = "admin") => call("GET", `/kpi/values?kpi=${code}`, who).then((r) => r.json.values);

let withdrawal;
test("an input alone gives no value: the formula waits, never 0", async () => {
  withdrawal = await save("user", { kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-09-01", value_numeric: 1.2, unit: "ML" });
  await submit("user", [withdrawal.id]);
  assert.deepEqual(await formulaValues("WATER_CONSUMPTION"), []);
});

test("both inputs submitted: water consumed recomputes per site, pending, waiting for its inputs, with its working", async () => {
  const discharge = await save("user", { kpi_code: "WATER_DISCHARGE", site_id: 1, period_start: "2026-09-01", value_numeric: 840 });
  // A draft isn't an input yet.
  assert.deepEqual(await formulaValues("WATER_CONSUMPTION"), []);
  await submit("user", [discharge.id]);
  const [v] = await formulaValues("WATER_CONSUMPTION");
  assert.ok(v, "a value now");
  assert.deepEqual([v.source, v.status, v.site_id, v.period_start, v.frequency, v.value_canonical, v.unit], ["formula", "pending", 1, "2026-09-01", "monthly", 360, "kL"]);
  assert.equal(v.entered_by, null);
  assert.equal(v.comment, "Waiting for Water withdrawn, Water discharged.");
  assert.equal(v.auto_snapshot.kind, "formula");
  assert.equal(v.auto_snapshot.formula, "WATER_WITHDRAWAL - WATER_DISCHARGE");
  assert.deepEqual(v.auto_snapshot.inputs.map((i) => [i.code, i.value, i.status]), [["WATER_WITHDRAWAL", 1200, "pending"], ["WATER_DISCHARGE", 840, "pending"]]);
  assert.deepEqual(v.auto_snapshot.waiting_for, ["WATER_WITHDRAWAL", "WATER_DISCHARGE"]);
  // Every role of the company sees it on its sites; site 2's people don't need it, company 2 never sees it.
  assert.equal((await formulaValues("WATER_CONSUMPTION", "user")).length, 1);
  assert.equal((await formulaValues("WATER_CONSUMPTION", "manager")).length, 1);
  assert.deepEqual((await call("GET", "/kpi/values", "otherManager")).json.values, []);
  const audit = await q(`SELECT action, changed_by FROM audit_log WHERE entity_type = 'kpi_value' AND entity_id = $1`, [v.id]);
  assert.deepEqual(audit, [{ action: "formula_recompute", changed_by: null }]);
});

test("formula values are read-only: typing one is KPI_AUTO_READ_ONLY, submitting one is KPI_NOT_DRAFT", async () => {
  const r = await call("PUT", "/kpi/values", "admin", { items: [{ kpi_code: "WATER_CONSUMPTION", site_id: 1, period_start: "2026-09-01", value_numeric: 1 }] });
  assert.equal(r.json.results[0].code, "KPI_AUTO_READ_ONLY");
  const [v] = await formulaValues("WATER_CONSUMPTION");
  assert.deepEqual((await call("POST", "/kpi/values/submit", "admin", { ids: [v.id] })).json.refused, [{ id: v.id, code: "KPI_NOT_DRAFT" }]);
});

test("company-level intensity after aggregation: consumption over sites and months ÷ revenue", async () => {
  const revenue = await save("admin", { kpi_code: "REVENUE", site_id: null, period_start: "2026-01-01", value_numeric: 250 });
  assert.deepEqual(await formulaValues("WATER_INTENSITY_REVENUE"), [], "revenue still a draft");
  await submit("admin", [revenue.id]);
  const [w] = await formulaValues("WATER_INTENSITY_REVENUE");
  assert.ok(w);
  assert.deepEqual([w.site_id, w.period_start, w.frequency, w.value_canonical, w.unit, w.status], [null, "2026-01-01", "annual", 1.44, "kL per INR crore", "pending"]);
  // Site 2 adds water in October: the company figure grows.
  const w2 = await save("multiSiteUser", { kpi_code: "WATER_WITHDRAWAL", site_id: 2, period_start: "2026-10-01", value_numeric: 500 });
  const d2 = await save("multiSiteUser", { kpi_code: "WATER_DISCHARGE", site_id: 2, period_start: "2026-10-01", value_numeric: 140 });
  await submit("multiSiteUser", [w2.id, d2.id]);
  assert.equal((await formulaValues("WATER_INTENSITY_REVENUE"))[0].value_canonical, 2.88, "(360 + 360) / 250");
  assert.equal((await formulaValues("WATER_CONSUMPTION")).length, 2, "one per site and month");
  // The other GHG and energy intensities have no inputs yet: nothing, not 0.
  assert.deepEqual(await formulaValues("GHG_INTENSITY_REVENUE"), []);
});

test("a custom calculated KPI evaluates like a library one", async () => {
  const body = {
    name: "Recycled water share",
    question: "What share of the water withdrawn was recycled?",
    topic: "water",
    value_type: "percent",
    unit_dimension: "ratio",
    canonical_unit: "%",
    allowed_units: ["%"],
    aggregation: "none",
    level: "company",
    default_frequency: "annual",
    source: "formula",
    formula: "WATER_RECYCLED / WATER_WITHDRAWAL * 100",
  };
  const bad = await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, formula: "WATER_RECYCLED / REVENUE * 100" });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.code, "KPI_FORMULA_INVALID");
  assert.match(bad.json.details.problems[0], /per INR crore/);
  const syntax = await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, formula: "WATER_RECYCLED / (WATER_WITHDRAWAL" });
  assert.equal(syntax.json.code, "KPI_FORMULA_INVALID");
  assert.equal(typeof syntax.json.details.position, "number");
  const created = await call("POST", "/kpi/setup/custom-kpis", "admin", body);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const recycled = await save("user", { kpi_code: "WATER_RECYCLED", site_id: 1, period_start: "2026-01-01", value_numeric: 170 });
  await submit("user", [recycled.id]);
  const [v] = await formulaValues(created.json.definition.code);
  assert.equal(v.value_canonical, 10, "170 / (1,200 + 500) × 100");
  assert.equal(v.unit, "%");
});

test("library formulas: a unit mismatch, an unknown code and a cycle are refused; a right one is saved", async () => {
  const def = (over) => ({
    code: "TEST6_GHG_PER_REV", name: "x", question: "x?", topic: "climate", value_type: "number", unit_dimension: "none",
    canonical_unit: "GJ per INR crore", allowed_units: ["GJ per INR crore"], aggregation: "none", level: "company",
    default_frequency: "annual", source: "formula", formula: "GHG_SCOPE1 / REVENUE", ...over,
  });
  const wrong = await call("POST", "/kpi/library/definitions", "superadmin", def());
  assert.equal(wrong.status, 422);
  assert.equal(wrong.json.code, "KPI_FORMULA_INVALID");
  assert.match(wrong.json.details.problems[0], /gives tCO2e per INR crore, not GJ per INR crore/);
  const mixed = await call("POST", "/kpi/library/definitions", "superadmin", def({ formula: "GHG_SCOPE1 + ENERGY_TOTAL" }));
  assert.equal(mixed.json.code, "KPI_FORMULA_INVALID");
  const ok = await call("POST", "/kpi/library/definitions", "superadmin", def({ canonical_unit: "tCO2e per INR crore", allowed_units: ["tCO2e per INR crore"] }));
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  // REVENUE can't now become a formula of the new KPI (a cycle through it).
  const revenue = (await q(`SELECT id FROM kpi_definition WHERE code = 'REVENUE' AND company_id IS NULL`))[0].id;
  const loop = await call("PUT", `/kpi/library/definitions/${revenue}`, "superadmin", { source: "formula", formula: "TEST6_GHG_PER_REV * 2", unit_dimension: "none", canonical_unit: "INR crore", allowed_units: ["INR crore"], aggregation: "none", value_type: "number" });
  assert.equal(loop.json.code, "KPI_FORMULA_INVALID");
  assert.ok(loop.json.details.problems.some((p) => /loops back/.test(p)), JSON.stringify(loop.json));
  // Changing a KPI's unit under a formula that uses it is refused too.
  const s1 = (await q(`SELECT id FROM kpi_definition WHERE code = 'ENERGY_TOTAL' AND company_id IS NULL`))[0].id;
  const unit = await call("PUT", `/kpi/library/definitions/${s1}`, "superadmin", { canonical_unit: "kWh", allowed_units: ["kWh", "GJ"] });
  assert.equal(unit.json.code, "KPI_FORMULA_INVALID", JSON.stringify(unit.json));
});
