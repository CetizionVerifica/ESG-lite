// IM1 engine unit tests: factor resolution order, year fallback, unit
// conversion, period mapping, in-plan mode conflicts and rounding. No
// database: the pieces under test take loaded data. Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { FactorIndex, MappingIndex, resolveActivity, suggestNames, targetYearFor, planMatchFor } = require(path.resolve("dist/services/emissionWrite/resolve.js"));
const { computeTotal, feraGap, feraTwinFor, totalFor } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const { toStoredPeriod, monthsCovered } = require(path.resolve("dist/services/emissionWrite/period.js"));
const { planModeConflicts, planIdentity, findDuplicate, isLowConfidenceAiMatch } = require(path.resolve("dist/services/emissionWrite/checks.js"));
const { getConversionFactor, unitsMatchExact } = require(path.resolve("dist/services/emissionWrite/units.js"));

const factor = (id, name, year, value, unit, global = name) => ({
  emission_factor_id: id,
  emission_category_name: name,
  global_category_name: global,
  year,
  factor_value: String(value.toFixed(4)), // decimal columns arrive as strings
  denominator_unit: unit,
  source: "CI",
});

const index = new FactorIndex([
  factor(1, "Diesel", 2024, 2680, "litre"),
  factor(2, "Diesel", 2023, 2650, "litre"),
  factor(3, "Natural Gas", 2024, 183, "kwh"),
  factor(4, "Grid Electricity", 2024, 708, "kwh"),
  factor(5, "Grid Electricity", 2023, 690.5, "kwh"),
  factor(6, "Coal (global only)", 2024, 2400, "tonne", "Coal"),
]);

const ctx = (over = {}) => ({
  site_id: 1,
  category_id: 1,
  category_name: "Stationary Combustion",
  scope: "Scope 1",
  assigned: true,
  hasForm: false,
  spec: null,
  selectColumns: new Set(),
  factors: index,
  fera: null,
  ...over,
});

test("target year is the reporting year minus one, parsed from the string", () => {
  assert.equal(targetYearFor("2025-01-15"), 2024);
  assert.equal(targetYearFor("2026-03-31"), 2025);
});

test("factor resolution follows the typed-entry order, with a fallback flag", () => {
  assert.deepEqual(pick(index.find("Diesel", 2024)), { id: 1, fallback: false });
  assert.deepEqual(pick(index.find("Diesel", 2022)), { id: 1, fallback: true }, "any year falls back to the newest");
  assert.deepEqual(pick(index.find("Coal", 2024)), { id: 6, fallback: false }, "global name matches");
  assert.deepEqual(pick(index.find(" grid electricity ", 2023)), { id: 5, fallback: false }, "trimmed, case-blind");
  assert.deepEqual(pick(index.find("GRID ELECTRICITY", 2021)), { id: 4, fallback: true }, "case-blind, newest year");
  assert.equal(index.find("Unobtainium", 2024), null);
  assert.equal(index.knows("diesel"), true);
  assert.equal(index.knows("Petrol"), false);
  assert.deepEqual(index.years(), [2024, 2023]);
});

test("plan match wins over mapping, mapping over the factor name", () => {
  const mappings = new MappingIndex();
  mappings.byName.set("hsd", { factor_name: "Diesel", emission_factor_id: null });
  mappings.byName.set("gas", { factor_name: "Natural Gas", emission_factor_id: 3 });
  const matches = [{ site_id: 1, category_id: 1, sheet_name: "HSD", factor_name: "Natural Gas" }];

  const viaPlan = resolveActivity(index, mappings, planMatchFor(matches, 1, 1, "hsd"), "hsd", 2024);
  assert.deepEqual([viaPlan.matched_by, viaPlan.match.factor.emission_factor_id], ["plan_match", 3]);
  const viaMapping = resolveActivity(index, mappings, null, "HSD ", 2024);
  assert.deepEqual([viaMapping.matched_by, viaMapping.match.factor.emission_factor_id], ["mapping", 1]);
  const viaId = resolveActivity(index, mappings, null, "Gas", 2024);
  assert.deepEqual([viaId.matched_by, viaId.match.factor.emission_factor_id], ["mapping", 3]);
  const direct = resolveActivity(index, mappings, null, "Grid Electricity", 2024);
  assert.deepEqual([direct.matched_by, direct.match.factor.emission_factor_id], ["factor", 4]);
  assert.equal(resolveActivity(index, mappings, null, "Petrol", 2024), null);
  assert.equal(planMatchFor(matches, 2, 1, "HSD"), null, "plan matches are per site and category");
  assert.deepEqual(suggestNames(index, "grid elec", 2), ["Grid Electricity", "Diesel"].slice(0, 1).concat(suggestNames(index, "grid elec", 2).slice(1)));
  assert.equal(suggestNames(index, "grid elec", 5)[0], "Grid Electricity");
});

test("totals use the typed-entry expression and rounding", () => {
  assert.equal(totalFor(1000, index.factors[0]), 2680);
  assert.equal(totalFor(1.25, index.find("Grid Electricity", 2024).factor), 0.89); // 1.25 × 708 / 1000 = 0.885 → 0.89
  assert.equal(totalFor(0.001, index.find("Grid Electricity", 2024).factor), 0); // tiny totals round to 0 but stay rows
  const direct = computeTotal(ctx(), index.factors[0], { emission_category: "Diesel", activity_value: "1000" }, "litre");
  assert.deepEqual(direct, { ok: true, computed: { activityValue: 1000, activity_unit: "litre", total: 2680, total_kg: "2680000.0000" } });
  const converted = computeTotal(ctx(), index.factors[0], { emission_category: "Diesel", quantity: "500" }, "gallon");
  assert.equal(converted.ok, true);
  assert.equal(converted.computed.conversion, 3.78541);
  assert.equal(converted.computed.total, Math.round(((500 * 3.78541 * 2680) / 1000) * 100) / 100);
  const bad = computeTotal(ctx(), index.factors[0], { emission_category: "Diesel", activity_value: "10" }, "kg");
  assert.equal(bad.ok, false);
  assert.equal(bad.issue.code, "UNIT_NOT_CONVERTIBLE");
  assert.equal(bad.issue.message, 'Unit mismatch: Expected "litre" but received "kg". No conversion available.');
  assert.deepEqual(bad.issue.extra, { expected_unit: "litre", received_unit: "kg" });
  const zero = computeTotal(ctx(), index.factors[0], { emission_category: "Diesel", activity_value: "0" }, "litre");
  assert.deepEqual(zero, { ok: true, computed: { activityValue: 0, activity_unit: "litre", total: 0, total_kg: "0.0000" } });
});

test("S3-4: total_kgco2e keeps 4 dp where the tCO2e total rounds to 0.01 t (D5)", () => {
  const grid = index.find("Grid Electricity", 2024).factor; // 708 kg/kWh
  const tiny = computeTotal(ctx(), grid, { emission_category: "Grid Electricity", activity_value: "0.001" }, "kwh");
  assert.equal(tiny.computed.total, 0); // 0.000708 t rounds away, as before
  assert.equal(tiny.computed.total_kg, "0.7080"); // the kg column keeps it
  const half = computeTotal(ctx(), grid, { emission_category: "Grid Electricity", activity_value: "1.25" }, "kwh");
  assert.deepEqual([half.computed.total, half.computed.total_kg], [0.89, "885.0000"]); // never rounded before multiplying
  const converted = computeTotal(ctx(), index.factors[0], { emission_category: "Diesel", quantity: "500" }, "gallon");
  assert.equal(converted.computed.total_kg, (Math.round(500 * 3.78541 * 2680 * 10000) / 10000).toFixed(4));
  const fera = feraTwinFor(
    ctx({ fera: { category_id: 9, factors: new FactorIndex([factor(20, "Diesel", 2024, 610.5, "litre")]) } }),
    "Diesel", { emission_category: "Diesel", activity_value: "3" }, "litre", 2024,
  );
  assert.deepEqual([fera.total, fera.total_kg], [1.83, "1831.5000"]);
});

test("spec categories multiply their fields and report missing or invalid fields", () => {
  const spec = {
    mode: "per_method",
    method_column: "Calculation Method",
    identity_columns: ["Product Name"],
    methods: {
      "Direct energy": { multiply: ["Units Sold", "Energy per use", "Lifetime uses"], activity_unit: "kwh" },
      "Share of energy": { multiply: ["Units Sold", "Energy per use", "Share in use"], percent: ["Share in use"] },
    },
  };
  const grid = factor(7, "India Grid", 2024, 0.233, "kwh");
  const data = { emission_category: "India Grid", "Calculation Method": "Direct energy", "Product Name": "Fan X1", "Units Sold": "1,200", "Energy per use": "0.75", "Lifetime uses": "3650" };
  const ok = computeTotal(ctx({ spec }), grid, data, "kwh");
  assert.equal(ok.ok, true);
  assert.equal(ok.computed.activityValue, 1200 * 0.75 * 3650);
  assert.equal(data.activity_value, String(1200 * 0.75 * 3650), "the product is written back for reports");
  const missing = computeTotal(ctx({ spec }), grid, { ...data, "Energy per use": "" }, "kwh");
  assert.deepEqual([missing.ok, missing.issue.code], [false, "FIELD_REQUIRED"]);
  const over = computeTotal(ctx({ spec }), grid, { ...data, "Calculation Method": "Share of energy", "Share in use": "140" }, "kwh");
  assert.deepEqual([over.ok, over.issue.code], [false, "FIELD_INVALID"]);
  const unknownMethod = computeTotal(ctx({ spec }), grid, { ...data, "Calculation Method": "Magic" }, "kwh");
  assert.deepEqual([unknownMethod.ok, unknownMethod.issue.code], [false, "FIELD_INVALID"]);
  assert.equal(feraTwinFor(ctx({ spec, fera: { category_id: 9, factors: index } }), "Diesel", data, "litre", 2024), null, "never for spec categories");
});

test("the FERA twin needs an exact factor for the year and a convertible unit", () => {
  const feraFactors = new FactorIndex([factor(20, "Diesel", 2024, 500, "litre"), factor(21, "Diesel", 2023, 480, "litre")]);
  const c = ctx({ fera: { category_id: 5, factors: feraFactors } });
  const twin = feraTwinFor(c, "Diesel", { emission_category: "Diesel", activity_value: "1000" }, "litre", 2024);
  assert.deepEqual([twin.category_id, twin.factor.emission_factor_id, twin.activityValue, twin.total], [5, 20, 1000, 500]);
  assert.equal(feraTwinFor(c, "Diesel", { emission_category: "Diesel", activity_value: "1000" }, "litre", 2022), null, "no looser year fallback for the twin");
  assert.equal(feraTwinFor(c, "Diesel", { emission_category: "Diesel", activity_value: "1000" }, "kg", 2024), null, "no conversion → no twin");
  assert.equal(feraTwinFor(c, "Diesel", { emission_category: "Diesel", activity_value: "10" }, "gallon", 2024).total, Math.round(((10 * 3.78541 * 500) / 1000) * 100) / 100);
  assert.equal(feraTwinFor(ctx(), "Diesel", { activity_value: "1" }, "litre", 2024), null, "site without FERA");
});

test("unit helpers behave as before", () => {
  assert.equal(getConversionFactor("MWh", "kwh"), 1000);
  assert.equal(getConversionFactor("ton", "kg"), 1000);
  assert.equal(getConversionFactor("kg", "litre"), null);
  assert.equal(unitsMatchExact("kWh ", "kwh"), true);
  // S3-4: a missing unit on either side is no longer a match.
  assert.equal(unitsMatchExact(null, "kwh"), false);
  assert.equal(unitsMatchExact("kwh", ""), false);
});

test("S3-4: why a FERA twin is missing, in words (feraGap)", () => {
  const fera = (factors) => ctx({ fera: { category_id: 9, factors: new FactorIndex(factors) } });
  // Glochem's real case: the FERA factor is "Natural Gas", the fuel "Natural gas".
  const gas = fera([factor(40, "Natural Gas", 2021, 0.3, "cubic meter")]);
  assert.equal(feraGap(gas, "Natural gas", "cubic meter", 2021), 'the 2021 FERA factor is named "Natural Gas", not "Natural gas" (FERA names must match exactly)');
  assert.equal(feraGap(gas, "Natural gas", "cubic meter", 2019), 'there is no 2019 FERA factor for "Natural gas"');
  // LSHS: fuel per litre, FERA per kWh.
  const lshs = fera([factor(41, "LSHS", 2021, 0.5, "kwh")]);
  assert.equal(feraGap(lshs, "LSHS", "litre", 2021), `"litre" can't be converted to the FERA factor unit "kwh"`);
  assert.equal(feraGap(lshs, "Refrigerant R32", "kg", 2021), null, "no FERA factors at all for the activity: FERA does not apply");
  assert.equal(feraGap(ctx(), "LSHS", "litre", 2021), null, "no FERA category: FERA does not apply");
});

test("S3-4: forms offer only currencies the table converts", () => {
  const { CONVERTIBLE_CURRENCIES } = require(path.resolve("dist/services/emissionWrite/units.js"));
  const { getDefaultExtraFieldsByName } = require(path.resolve("dist/utils/defaultExtraFields.js"));
  for (const c of CONVERTIBLE_CURRENCIES) {
    assert.ok(CONVERTIBLE_CURRENCIES.some((o) => o !== c && getConversionFactor(c, o)), `${c} converts to another currency`);
  }
  for (const name of ["Purchased Goods and Services", "Capital Goods"]) {
    const currency = (getDefaultExtraFieldsByName(name) || []).find((f) => f.key === "currency");
    if (currency) assert.deepEqual(currency.options.filter((o) => !CONVERTIBLE_CURRENCIES.includes(o)), [], `${name}: no unconvertible currency`);
  }
});

test("S3-4: a factor with no unit is UNIT_REQUIRED, never applied unchecked", () => {
  const noUnit = factor(30, "Mystery fuel", 2024, 1000, "");
  const r = computeTotal(ctx(), noUnit, { emission_category: "Mystery fuel", activity_value: "10" }, "litre");
  assert.equal(r.ok, false);
  assert.equal(r.issue.code, "UNIT_REQUIRED");
  assert.match(r.issue.message, /"Mystery fuel" has no unit/);
  const nullUnit = computeTotal(ctx(), { ...noUnit, denominator_unit: null }, { emission_category: "Mystery fuel", activity_value: "10" }, "litre");
  assert.equal(nullUnit.issue.code, "UNIT_REQUIRED");
  // No FERA twin without a unit on both sides.
  const fera = (unit) => ({ fera: { category_id: 9, factors: new FactorIndex([factor(21, "Diesel", 2024, 610.5, unit)]) } });
  assert.equal(feraTwinFor(ctx(fera("litre")), "Diesel", { emission_category: "Diesel", activity_value: "3" }, null, 2024), null);
  assert.equal(feraTwinFor(ctx(fera("")), "Diesel", { emission_category: "Diesel", activity_value: "3" }, "litre", 2024), null);
  assert.notEqual(feraTwinFor(ctx(fera("litre")), "Diesel", { emission_category: "Diesel", activity_value: "3" }, "litre", 2024), null);
});

test("periods map to stored columns; future months and unstarted years are invalid", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  assert.deepEqual(toStoredPeriod({ kind: "monthly", date: "2025-03-15" }, 1, now), { ok: true, period: { date_of_reporting: "2025-03-15", reporting_period: "monthly", year_type: null } });
  assert.equal(toStoredPeriod({ kind: "monthly", date: "2026-10-31" }, 1, now).ok, true, "the current month is fine");
  assert.equal(toStoredPeriod({ kind: "monthly", date: "2026-11-01" }, 1, now).ok, false);
  assert.deepEqual(toStoredPeriod({ kind: "yearly", year_type: "CY", year: 2025 }, 1, now), { ok: true, period: { date_of_reporting: "2025-12-31", reporting_period: "yearly", year_type: "CY" } });
  assert.deepEqual(toStoredPeriod({ kind: "yearly", year_type: "FY", year: 2026 }, 1, now).period, { date_of_reporting: "2026-03-31", reporting_period: "yearly", year_type: "FY" });
  assert.equal(toStoredPeriod({ kind: "yearly", year_type: "CY", year: 2026 }, 1, now).ok, true, "a started year may be filed");
  assert.equal(toStoredPeriod({ kind: "yearly", year_type: "FY", year: 2028 }, 1, now).ok, false);
  assert.deepEqual(monthsCovered({ date_of_reporting: "2026-03-31", reporting_period: "yearly", year_type: "FY" }).slice(0, 2), ["2025-04", "2025-05"]);
  assert.equal(monthsCovered({ date_of_reporting: "2025-12-31", reporting_period: "yearly", year_type: "CY" }).length, 12);
  assert.deepEqual(monthsCovered({ date_of_reporting: "2025-03-15", reporting_period: "monthly", year_type: null }), ["2025-03"]);
});

test("a plan may not mix monthly rows with a yearly batch, or CY with FY, for one site and category", () => {
  const monthly = (d, cat = 1) => ({ site_id: 1, category_id: cat, period: { date_of_reporting: d, reporting_period: "monthly", year_type: null } });
  const yearly = (t, y, cat = 1) => ({ site_id: 1, category_id: cat, period: { date_of_reporting: t === "CY" ? `${y}-12-31` : `${y}-03-31`, reporting_period: "yearly", year_type: t } });
  const conflicts = planModeConflicts([yearly("CY", 2025), monthly("2025-06-15"), monthly("2024-06-15"), monthly("2025-06-15", 2), yearly("FY", 2026), yearly("CY", 2024), null]);
  assert.deepEqual([...conflicts.keys()].sort(), [1, 2, 4], "row 2 falls inside the CY 2024 batch of row 5");
  assert.match(conflicts.get(1), /yearly batch covering 2025-01-01 – 2025-12-31/);
  assert.match(conflicts.get(4), /CY yearly data/);
});

test("duplicate identity uses the month, the activity and the spec's identity columns", () => {
  const spec = { mode: "per_unit", identity_columns: ["Shipment Ref"], methods: { km: { multiply: ["Distance travelled"] } } };
  const p = { date_of_reporting: "2025-07-31", reporting_period: "monthly", year_type: null };
  const a = planIdentity(1, 4, p, "Van Diesel [km]", { "Shipment Ref": "S-1 " }, spec);
  const b = planIdentity(1, 4, { ...p, date_of_reporting: "2025-07-02" }, "van diesel [km]", { "Shipment Ref": "s-1" }, spec);
  const c = planIdentity(1, 4, p, "Van Diesel [km]", { "Shipment Ref": "S-2" }, spec);
  assert.equal(a, b);
  assert.notEqual(a, c);
  const existing = [{ pk_id: 1, activity_data: { emission_category: "Diesel", "Shipment Ref": "S-1" } }, { pk_id: 2, activity_data: { emission_category: "Petrol" } }];
  assert.equal(findDuplicate(existing, { emission_category: "Petrol" }, null).pk_id, 2);
  assert.equal(findDuplicate(existing, { emission_category: "Diesel", "Shipment Ref": "S-9" }, spec), null);
  assert.equal(findDuplicate(existing, { emission_category: "Diesel", "Shipment Ref": "s-1" }, spec).pk_id, 1);
  assert.equal(findDuplicate(existing, { activity_value: "1" }, null).pk_id, 1, "no activity: any row on the date, as typed entries do");
  assert.equal(findDuplicate([], { emission_category: "Diesel" }, null), null);
});

function pick(m) {
  return m ? { id: m.factor.emission_factor_id, fallback: m.fallback_year } : null;
}

test("unit spellings from client sheets resolve to the canonical unit; existing conversions are unchanged", () => {
  const { getConversionFactor, unitsMatchExact } = require(path.resolve("dist/services/emissionWrite/units.js"));
  // Indian records: metric tonne, city-gas standard cubic metre, litre abbreviations
  assert.equal(getConversionFactor("MT", "tonne"), 1);
  assert.equal(getConversionFactor("MT", "kg"), 1000);
  assert.equal(getConversionFactor("SCM", "Cubic meter"), 1);
  assert.equal(getConversionFactor("Ltr", "litre"), 1);
  assert.equal(getConversionFactor("Ltrs", "kl"), 0.001);
  assert.ok(unitsMatchExact("Litres", "litre"));
  assert.ok(unitsMatchExact("kgs", "Kg"));
  // unchanged
  assert.equal(getConversionFactor("kwh", "mwh"), 0.001);
  assert.equal(getConversionFactor("tonne", "kg"), 1000);
  assert.equal(getConversionFactor("litre", "kg"), null);
  assert.ok(!unitsMatchExact("kwh", "mwh"));
});

test("a confirmed AI match below 0.8 is a low-confidence match; profile, rules and rows without meta are not", () => {
  assert.equal(isLowConfidenceAiMatch({ source: "llm", confidence: 0.6 }), true);
  assert.equal(isLowConfidenceAiMatch({ source: "llm", confidence: 0.79 }), true);
  assert.equal(isLowConfidenceAiMatch({ source: "llm", confidence: 0.8 }), false, "the threshold itself is confident enough");
  assert.equal(isLowConfidenceAiMatch({ source: "llm", confidence: 0.9 }), false);
  assert.equal(isLowConfidenceAiMatch({ source: "rules", confidence: 0.5 }), false);
  assert.equal(isLowConfidenceAiMatch({ source: "profile", confidence: 0.5 }), false);
  assert.equal(isLowConfidenceAiMatch(undefined), false, "Claude and API rows carry no meta");
  assert.equal(isLowConfidenceAiMatch(null), false);
});
