// S3-12 proxy method (emissionWrite/methods/proxy.ts): coverage and intensity
// maths, the sample basis keeping the form's own method, invalid bases
// refused; the survey proxy shape the backfill and commit write; the most
// common source method.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const engine = require(path.resolve("dist/services/emissionWrite/compute.js"));
const activity = require(path.resolve("dist/services/emissionWrite/methods/activity.js"));
const proxyMethod = require(path.resolve("dist/services/emissionWrite/methods/proxy.js"));
const rows = require(path.resolve("dist/scope3/screening/proxyRows.js"));

const ctx = { site_id: 1, category_id: 1, category_name: "Cat", scope: "Scope 3", assigned: true, hasForm: false, spec: null, selectColumns: new Set(), factors: null, fera: null };
const factor = (value, unit) => ({ emission_factor_id: null, emission_category_name: "Proxy", factor_value: String(value), denominator_unit: unit, source: "CI", year: 2026 });
const compute = (quantity, unit, f, proxy, method) =>
  engine.computeRow(ctx, { factor: f, activity_data: { activity_value: String(quantity) }, activity_unit: unit, proxy, method });

test("coverage: 850,000 kg known at 85 % → 150,000 kg for the missing 15 % (L1189-1196)", () => {
  const r = compute(850000, "kgCO2e", factor(1, "kgCO2e"), { basis: "coverage", coverage_pct: 85, from: [1, 2] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.computed.total_kgco2e, "150000.0000");
  assert.equal(r.computed.total, 150);
  assert.equal(r.computed.data_type, "secondary");
  assert.equal(proxyMethod.coverageScale(85), 15 / 85);
  // Rounded only at the end: 1 kg at 3 % → 32.3333 kg.
  assert.equal(compute(1, "kgCO2e", factor(1, "kgCO2e"), { basis: "coverage", coverage_pct: 3, from: [] }).computed.total_kgco2e, "32.3333");
});

test("intensity: 1,000 t for 500 t output, missing site 250 t → 500,000 kg", () => {
  const r = compute(250, "tonne", factor(1000000 / 500, "tonne"), { basis: "intensity", from: [5, 6] }, "average_data");
  assert.equal(r.ok, true);
  assert.equal(r.computed.total_kgco2e, "500000.0000");
  assert.equal(r.computed.total, 500);
  assert.equal(r.computed.method, "average_data");
  // Output in another mass unit converts like any quantity: 250,000 kg = 250 t.
  assert.equal(compute(250000, "kg", factor(2000, "tonne"), { basis: "intensity", from: [] }).computed.total_kgco2e, "500000.0000");
});

test("sample keeps the category's own method; a bad basis or share is refused", () => {
  const f = factor(0.5, "km");
  const plain = activity.compute(ctx, { factor: f, activity_data: { activity_value: "10" }, activity_unit: "km" });
  const sample = compute(10, "km", f, { basis: "sample", coverage_pct: 40, from: [] });
  // Same total as the form's own method; the engine adds method and DQ (S3-3), with completeness 3 for a proxy.
  const { method: _m, dq, data_type: _d, ...total } = sample.computed;
  assert.deepEqual({ ok: sample.ok, computed: total }, plain);
  assert.equal(dq.completeness, 3);
  for (const bad of [{ basis: "coverage", from: [] }, { basis: "coverage", coverage_pct: 100, from: [] }, { basis: "floor_area", from: [] }, { basis: "intensity", from: "x" }]) {
    const r = compute(10, "km", f, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.issue.code, "FIELD_INVALID");
  }
  const unit = compute(10, "litre", factor(1, "kgCO2e"), { basis: "coverage", coverage_pct: 50, from: [] });
  assert.equal(unit.issue.code, "UNIT_NOT_CONVERTIBLE");
});

test("a proxy row stays secondary and scores completeness 3 whatever its sources' method (S3-3 columns)", () => {
  const r = compute(850000, "kgCO2e", factor(1, "kgCO2e"), { basis: "coverage", coverage_pct: 85, from: [1] }, "supplier_specific");
  assert.equal(r.computed.method, "supplier_specific");
  assert.equal(r.computed.data_type, "secondary", "a primary method's sources still make a secondary proxy row");
  assert.equal(r.computed.dq.completeness, 3);
  // A measured row with a primary method stays primary. (site_specific, not
  // supplier_specific: since S3-6 a supplier row needs its supplier's figures.)
  const measured = engine.computeRow(ctx, { factor: factor(1, "kgCO2e"), activity_data: { activity_value: "1" }, activity_unit: "kgCO2e", method: "site_specific" });
  assert.equal(measured.computed.data_type, "primary");
  assert.equal(measured.computed.dq.completeness, 1);
});

test("a survey row's proxy: basis sample, the respondents share, no source rows", () => {
  assert.deepEqual(rows.surveyProxy({ basis: "sample", respondents: 40, total_employees: 100, coverage_pct: 40 }), { basis: "sample", coverage_pct: 40, from: [] });
  assert.deepEqual(rows.surveyProxy({ respondents: 1, total_employees: 3 }), { basis: "sample", coverage_pct: 33.33, from: [] });
  assert.deepEqual(rows.surveyProxy({}), { basis: "sample", from: [] });
  assert.equal(rows.surveyProxy({ coverage_pct: 120 }).coverage_pct, 100);
  const sql = rows.SURVEY_BACKFILL_SQL(1000);
  assert.match(sql, /WHERE proxy IS NULL AND extra_data \? 'survey'/, "only fills rows without a proxy (re-runnable)");
  assert.match(sql, /LIMIT 1000/);
});

test("the extrapolated row's method is the most common source method", () => {
  assert.equal(rows.commonMethod(["spend_based", "average_data", "spend_based", null]), "spend_based");
  assert.equal(rows.commonMethod(["spend_based", "average_data"]), "average_data", "a tie goes to the more specific method");
  assert.equal(rows.commonMethod([null, "unknown", "nonsense"]), null);
});
