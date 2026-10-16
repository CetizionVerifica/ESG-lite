// S3-6: the supplier-specific and hybrid methods, the allocation helper shared
// with PCF, and the choice of supplier figure. No database; runs against the
// compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { computeRow } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const { allocationShare, allocatedKg } = require(path.resolve("dist/scope3/suppliers/allocate.js"));
const { pickSupplierFactor, pickFacility, parseHybridLines } = require(path.resolve("dist/scope3/suppliers/engineInput.js"));
const { parseSupplierRef } = require(path.resolve("dist/scope3/suppliers/entryInput.js"));
const { computePcf } = require(path.resolve("dist/pcf/engine/computePcf.js"));

const ctx = {
  site_id: 1,
  category_id: 1,
  category_name: "Purchased goods",
  scope: "Scope 3",
  assigned: true,
  hasForm: true,
  spec: null,
  selectColumns: new Set(),
  factors: null,
  fera: null,
  site_country: "IN",
};

const ef = (id, name, value, unit, year = 2025) => ({
  emission_factor_id: id,
  emission_category_name: name,
  global_category_name: name,
  year,
  factor_value: String(value),
  denominator_unit: unit,
  source: "test",
  geography: "GLO",
  factor_type: "cradle_to_gate",
});

const figure = (o = {}) => ({
  supplier_factor_id: 7,
  item: "P1020 ingot",
  unit: "kg",
  kgco2e_per_unit: 8.6,
  boundary: "cradle_to_gate",
  reference_year: 2025,
  gwp_set: "AR6",
  has_evidence: false,
  source: "manual",
  ...o,
});

const row = (o) => ({
  factor: null,
  activity_data: { emission_category: "P1020 ingot", activity_value: "1000" },
  activity_unit: "kg",
  reportingYear: 2025,
  ...o,
});

test("supplier-specific: quantity × the supplier's figure, with the supplier snapshot", () => {
  const r = computeRow(ctx, row({ method: "supplier_specific", supplier: { supplier_id: 3, country: "AE", factor: figure() } }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.computed.total_kgco2e, "8600.0000");
  assert.equal(r.computed.total, 8.6);
  assert.equal(r.computed.method, "supplier_specific");
  assert.equal(r.computed.data_type, "primary");
  assert.equal(r.computed.supplier_id, 3);
  const snap = r.computed.snapshot;
  assert.equal(snap.factor_type, "supplier");
  assert.equal(snap.supplier_factor_id, 7);
  assert.equal(snap.reference_year, 2025);
  assert.equal(snap.gwp_set, "AR6");
  assert.equal(r.computed.quality, undefined, "the DQ inputs are never stored");
});

test("supplier-specific: the quantity converts into the figure's unit", () => {
  const r = computeRow(ctx, row({ method: "supplier_specific", activity_unit: "tonne", activity_data: { emission_category: "x", activity_value: "2" }, supplier: { supplier_id: 3, country: null, factor: figure() } }));
  assert.ok(r.ok);
  assert.equal(r.computed.total_kgco2e, "17200.0000");
  const bad = computeRow(ctx, row({ method: "supplier_specific", activity_unit: "kwh", supplier: { supplier_id: 3, country: null, factor: figure() } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.issue.code, "UNIT_NOT_CONVERTIBLE");
});

test("supplier-specific DQ: reliability 1 with evidence on the figure, 2 without", () => {
  const withEvidence = computeRow(ctx, row({ method: "supplier_specific", supplier: { supplier_id: 3, country: "AE", factor: figure({ has_evidence: true }) } }));
  assert.equal(withEvidence.computed.dq.reliability, 1);
  assert.equal(withEvidence.computed.dq.technology, 1);
  assert.equal(withEvidence.computed.dq.geography, 1, "the supplier's figure is for where the goods were made");
  assert.equal(withEvidence.computed.dq.time, 1);
  assert.equal(withEvidence.computed.dq.overall, 1);
  const without = computeRow(ctx, row({ method: "supplier_specific", supplier: { supplier_id: 3, country: "AE", factor: figure() } }));
  assert.equal(without.computed.dq.reliability, 2);
});

test("supplier-specific without a supplier or a figure is refused, never averaged", () => {
  const none = computeRow(ctx, row({ method: "supplier_specific" }));
  assert.equal(none.issue.code, "FIELD_REQUIRED");
  const noFigure = computeRow(ctx, row({ method: "supplier_specific", supplier: { supplier_id: 3, country: null, factor: null } }));
  assert.equal(noFigure.issue.code, "NO_FACTOR_FOR_YEAR");
  assert.match(noFigure.issue.message, /No figure from this supplier yet/);
});

test("supplier-specific wins over a form's calculation spec", () => {
  const specCtx = { ...ctx, spec: { mode: "per_unit" } };
  const r = computeRow(specCtx, row({ method: "supplier_specific", supplier: { supplier_id: 3, country: null, factor: figure() } }));
  assert.ok(r.ok);
  assert.equal(r.computed.total_kgco2e, "8600.0000");
});

const facility = (o = {}) => ({
  supplier_facility_data_id: 11,
  year: 2025,
  scope12_tco2e: 500,
  output_qty: 100000,
  output_unit: "kg",
  allocation_key: "mass",
  ...o,
});

test("hybrid by mass: the facility's Scope 1+2 × bought / made, plus the input lines", () => {
  const lines = [
    { kind: "material", name: "Alumina", quantity: 1930, unit: "kg", factor: ef(1, "Alumina", 1.2, "kg") },
    { kind: "transport", name: "Truck", quantity: 2, unit: "tonne.km", factor: ef(2, "Truck", 100, "tonne.km") },
  ];
  const r = computeRow(ctx, row({ method: "hybrid", supplier: { supplier_id: 3, country: "AE", facility: facility(), lines } }));
  assert.ok(r.ok, JSON.stringify(r));
  // 500 t × 1,000 / 100,000 = 5,000 kg; 1,930 × 1.2 = 2,316; 2 × 100 = 200
  assert.equal(r.computed.total_kgco2e, "7516.0000");
  const comps = r.computed.snapshot.components;
  assert.deepEqual(comps.map((c) => c.kind), ["supplier_scope12", "material", "transport"]);
  assert.equal(comps[0].share, 0.01);
  assert.equal(comps[0].kgco2e, 5000);
  assert.equal(comps.reduce((s, c) => s + c.kgco2e, 0), 7516, "the total is the sum of the components");
  assert.equal(r.computed.method, "hybrid");
  assert.equal(r.computed.dq.reliability, 2, "hybrid scores fair on reliability");
});

test("hybrid by mass converts the bought quantity into the facility's output unit", () => {
  const r = computeRow(ctx, row({ method: "hybrid", activity_unit: "tonne", activity_data: { emission_category: "x", activity_value: "1" }, supplier: { supplier_id: 3, country: null, facility: facility() } }));
  assert.ok(r.ok);
  assert.equal(r.computed.total_kgco2e, "5000.0000");
});

test("hybrid by economic value allocates by what was paid", () => {
  const econ = facility({ output_qty: 2000000, output_unit: "USD", allocation_key: "economic" });
  const r = computeRow(ctx, row({ method: "hybrid", supplier: { supplier_id: 3, country: null, facility: econ, purchased_value: 50000 } }));
  assert.ok(r.ok, JSON.stringify(r));
  // 500 t × 50,000 / 2,000,000 = 12.5 t
  assert.equal(r.computed.total_kgco2e, "12500.0000");
  assert.equal(r.computed.snapshot.allocation_key, "economic");
  const missing = computeRow(ctx, row({ method: "hybrid", supplier: { supplier_id: 3, country: null, facility: econ } }));
  assert.equal(missing.issue.code, "FIELD_REQUIRED");
  assert.equal(missing.issue.field, "purchased_value");
});

test("hybrid with energy lines uses them for the supplier's Scope 1+2, never the facility as well", () => {
  const lines = [{ kind: "energy", name: "Electricity", quantity: 5000, unit: "kwh", factor: ef(1, "Electricity", 0.5, "kwh") }];
  const r = computeRow(ctx, row({ method: "hybrid", supplier: { supplier_id: 3, country: null, facility: facility(), lines } }));
  assert.ok(r.ok);
  assert.equal(r.computed.total_kgco2e, "2500.0000");
  assert.ok(!r.computed.snapshot.components.some((c) => c.kind === "supplier_scope12"));
});

test("hybrid refuses a row with no supplier part, or more bought than made", () => {
  const none = computeRow(ctx, row({ method: "hybrid", supplier: { supplier_id: 3, country: null, facility: null, lines: [] } }));
  assert.equal(none.issue.code, "FIELD_REQUIRED");
  const tooMuch = computeRow(ctx, row({ method: "hybrid", activity_data: { emission_category: "x", activity_value: "200000" }, supplier: { supplier_id: 3, country: null, facility: facility() } }));
  assert.equal(tooMuch.issue.code, "FIELD_INVALID");
});

test("allocate.ts is the arithmetic PCF used, so PCF results do not move", () => {
  assert.equal(allocationShare(25, 100), 0.25);
  assert.equal(allocatedKg(2, 0.25), 500);
  // The PCF A3 energy line, before the extraction: (t × 1000 × share) / units.
  const r = computePcf({
    study: { cut_off_rule_pct: 1, cut_off_max_total_pct: 5 },
    factors: [],
    inputs: [],
    energy: [{ id: "e", category_name: "Electricity", scope: 2, period_total_tco2e: 123.456 }],
    allocation: { key_value_product: 37, key_value_site_total: 113, product_output_units: 7, dqr: { technology: 1, geography: 1, time: 1 } },
  });
  const share = 37 / 113;
  assert.equal(r.by_input.e, (123.456 * 1000 * share) / 7);
});

test("pickSupplierFactor: newest figure up to the reporting year, by item, else the only item", () => {
  const figs = [
    figure({ supplier_factor_id: 1, item: "Ingot", reference_year: 2023 }),
    figure({ supplier_factor_id: 2, item: "Ingot", reference_year: 2025 }),
    figure({ supplier_factor_id: 3, item: "Ingot", reference_year: 2027 }),
  ];
  assert.equal(pickSupplierFactor(figs, 2026, "ingot").factor.supplier_factor_id, 2, "case-folded name, newest not after the year");
  assert.equal(pickSupplierFactor(figs, 2026, "Something else").factor.supplier_factor_id, 2, "only one item: that item");
  assert.equal(pickSupplierFactor(figs, 2022, "Ingot").reason, "none_for_year");
  assert.equal(pickSupplierFactor(figs, 2026, "Ingot", 3).reason, "future_year");
  assert.equal(pickSupplierFactor(figs, 2026, "Ingot", 99).reason, "not_found");
  const two = [...figs, figure({ supplier_factor_id: 4, item: "Billet", reference_year: 2024 })];
  assert.equal(pickSupplierFactor(two, 2026, "Wire").reason, "ambiguous");
  assert.equal(pickSupplierFactor(two, 2026, "Wire", 4).factor.supplier_factor_id, 4);
  assert.equal(pickSupplierFactor([], 2026, "Ingot").reason, "not_found");
});

test("pickFacility: the newest year up to the reporting year", () => {
  const list = [facility({ supplier_facility_data_id: 1, year: 2023 }), facility({ supplier_facility_data_id: 2, year: 2025 }), facility({ supplier_facility_data_id: 3, year: 2027 })];
  assert.equal(pickFacility(list, 2026).supplier_facility_data_id, 2);
  assert.equal(pickFacility(list, 2022), null);
});

test("parseHybridLines and parseSupplierRef name the first bad field", () => {
  assert.deepEqual(parseHybridLines(undefined), { ok: true, lines: [] });
  assert.equal(parseHybridLines([{ kind: "material", name: "Cotton", quantity: 5, unit: "kg" }]).lines[0].name, "Cotton");
  assert.equal(parseHybridLines([{ kind: "material", name: "Cotton", quantity: 0, unit: "kg" }]).field, "extra_data.inputs[0].quantity");
  assert.equal(parseHybridLines([{ kind: "fuel", name: "x", quantity: 1, unit: "kg" }]).field, "extra_data.inputs[0].kind");
  assert.equal(parseHybridLines("nope").ok, false);
  assert.deepEqual(parseSupplierRef({ supplier_id: "4" }), { ok: true, value: { supplier_id: 4 } });
  assert.deepEqual(parseSupplierRef({ supplier_id: null }), { ok: true, value: { supplier_id: null } });
  assert.equal(parseSupplierRef({ supplier_id: "abc" }).field, "supplier_id");
  assert.equal(parseSupplierRef({ supplier_factor_id: -1 }).field, "supplier_factor_id");
});
