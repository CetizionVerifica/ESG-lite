// S3-0 engine split: compute.ts dispatches to emissionWrite/methods/*. Until
// their modules build them, the spend, supplier, hybrid and proxy stubs give
// the activity method's result; spec categories always use the spec.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const engine = require(path.resolve("dist/services/emissionWrite/compute.js"));
const activity = require(path.resolve("dist/services/emissionWrite/methods/activity.js"));
const spec = require(path.resolve("dist/services/emissionWrite/methods/spec.js"));

const diesel = { emission_factor_id: 1, emission_category_name: "Diesel", global_category_name: "Diesel", year: 2024, factor_value: "2680.0000", denominator_unit: "litre", source: "CI" };
const ctx = (over = {}) => ({
  site_id: 1, category_id: 1, category_name: "Stationary Combustion", scope: "Scope 1", assigned: true, hasForm: false,
  spec: null, selectColumns: new Set(), factors: null, fera: null, ...over,
});
const row = (over = {}) => ({ factor: diesel, activity_data: { emission_category: "Diesel", quantity: "500" }, activity_unit: "gallon", ...over });

test("every method file exports compute(ctx, row)", () => {
  for (const name of ["activity", "spec", "spend", "supplier", "hybrid", "proxy"]) {
    const m = require(path.resolve(`dist/services/emissionWrite/methods/${name}.js`));
    assert.equal(typeof m.compute, "function", name);
  }
  assert.equal(typeof require(path.resolve("dist/services/emissionWrite/methods/fera.js")).feraTwinFor, "function");
});

test("rows without a method compute as before: computeTotal = computeRow = activity", () => {
  const expected = activity.compute(ctx(), row());
  assert.equal(expected.ok, true);
  assert.equal(expected.computed.total, Math.round(((500 * 3.78541 * 2680) / 1000) * 100) / 100);
  assert.deepEqual(engine.computeRow(ctx(), row()), expected);
  assert.deepEqual(engine.computeTotal(ctx(), diesel, { emission_category: "Diesel", quantity: "500" }, "gallon"), expected);
  // S3-4 fills total_kgco2e (kg at 4 dp from the unrounded product); the other Scope 3 fields stay unset.
  assert.equal(expected.computed.total_kgco2e, (Math.round(500 * 3.78541 * 2680 * 10000) / 10000).toFixed(4));
  for (const k of ["method", "dq", "data_type", "gas_kg", "biogenic_kg"]) assert.equal(expected.computed[k], undefined, `${k} stays unset`);
});

test("the stub methods fall back to activity until their modules land", () => {
  const expected = activity.compute(ctx(), row());
  for (const method of ["spend_based", "average_data", "distance_based"]) {
    assert.deepEqual(engine.computeRow(ctx(), row({ method })), expected, method);
  }
  assert.deepEqual(engine.computeRow(ctx(), row({ proxy: { basis: "floor_area" } })), expected, "proxy");
});

test("S3-6: supplier-specific and hybrid are real methods; without the supplier's figures they refuse, never fall back", () => {
  for (const method of ["supplier_specific", "hybrid"]) {
    const r = engine.computeRow(ctx(), row({ method }));
    assert.equal(r.ok, false, method);
    assert.equal(r.issue.code, "FIELD_REQUIRED", method);
    assert.equal(r.issue.field, "supplier_id", method);
  }
});

test("spec categories always use the spec method, whatever the row's method", () => {
  const s = {
    mode: "per_method",
    method_column: "Calculation Method",
    identity_columns: ["Product Name"],
    methods: { "Direct energy": { multiply: ["Units Sold", "Energy per use"], activity_unit: "kwh" } },
  };
  const data = () => ({ emission_category: "Grid", "Calculation Method": "Direct energy", "Product Name": "Fan", "Units Sold": "10", "Energy per use": "2" });
  const grid = { ...diesel, emission_factor_id: 2, emission_category_name: "Grid", factor_value: "0.5000", denominator_unit: "kwh" };
  const viaSpec = spec.compute(ctx({ spec: s }), { factor: grid, activity_data: data(), activity_unit: "kwh" });
  const viaEngine = engine.computeRow(ctx({ spec: s }), { factor: grid, activity_data: data(), activity_unit: "kwh", method: "spend_based" });
  assert.equal(viaSpec.ok, true);
  assert.equal(viaSpec.computed.activityValue, 20);
  assert.deepEqual(viaEngine, viaSpec);
});

test("S3-4: gas_kg and biogenic_kg are quantity in the factor's unit × each gas part, at 4 dp", () => {
  const gassy = { ...diesel, co2_kg: "2600.00000000", ch4_kg: "0.10000000", n2o_kg: null, other_kgco2e: "5.00000000", biogenic_co2_kg: "12.34567890" };
  const r = activity.compute(ctx(), row({ factor: gassy }));
  const q = 500 * 3.78541;
  assert.deepEqual(r.computed.gas_kg, { CO2: Math.round(q * 2600 * 10000) / 10000, CH4: Math.round(q * 0.1 * 10000) / 10000 });
  assert.equal(r.computed.biogenic_kg, (Math.round(q * 12.3456789 * 10000) / 10000).toFixed(4));
  assert.deepEqual(activity.gasesFor(0, gassy), { gas_kg: { CO2: 0, CH4: 0 }, biogenic_kg: "0.0000" });
  assert.deepEqual(activity.gasesFor(10, { ...diesel, co2_kg: "", ch4_kg: null }), {});
});
