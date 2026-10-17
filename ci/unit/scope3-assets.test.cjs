// S3-11 leased assets, franchises and investments: the lease boundary rule,
// the spec's `divide`, the standard forms, the identity factor and the
// Category 15 plan rows. The guidance's worked examples run through the real
// forms and the engine (computeRow), so the forms give the golden figures.
// Runs against the compiled build (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { leaseBoundary, leaseBoundaryNote } = require(path.resolve("dist/scope3/assets/boundary.js"));
const configs = require(path.resolve("dist/scope3/assets/configs.js"));
const { investmentRows } = require(path.resolve("dist/scope3/assets/service.js"));
const { computeSpecActivityValue, normalizeUnitKey } = require(path.resolve("dist/services/calculationSpec.js"));
const { computeRow } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const { GHG_CATEGORIES } = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));

const { assetForm, ASSET_CATEGORIES, REPORTED_KG, REPORTED_T, IDENTITY_FACTORS, METHOD_OPTIONS, UNITS_BY_METHOD, formFields, isStandardConfig } = configs;

test("leaseBoundary: 2 roles × 2 lease types × 3 approaches", () => {
  const expected = {
    lessee: { finance: ["scope12", "scope12", "scope12"], operating: ["scope12", "cat8", "cat8"] },
    lessor: { finance: ["cat13", "cat13", "cat13"], operating: ["cat13", "scope12", "scope12"] },
  };
  const approaches = ["operational_control", "financial_control", "equity_share"];
  for (const role of ["lessee", "lessor"]) {
    for (const type of ["finance", "operating"]) {
      approaches.forEach((a, i) => assert.equal(leaseBoundary(role, type, a), expected[role][type][i], `${role} ${type} ${a}`));
    }
  }
  assert.equal(leaseBoundary("franchisor", null, "equity_share"), "cat14");
  assert.equal(leaseBoundary("franchisee", null, "operational_control"), "scope12");
  assert.equal(leaseBoundary("lessee", null, "financial_control"), null);
  assert.equal(leaseBoundary(null, "operating", "financial_control"), null);
  assert.equal(leaseBoundary("tenant", "operating", "financial_control"), null);
  // No approach yet = the D4 default, operational control.
  assert.equal(leaseBoundary("lessee", "operating", null), "scope12");
});

test("leaseBoundary notes are plain sentences", () => {
  assert.equal(
    leaseBoundaryNote("lessee", "operating", "financial_control"),
    "With financial control, this site's energy belongs in Category 8 · Upstream leased assets.",
  );
  assert.match(leaseBoundaryNote("lessee", null, "financial_control"), /Choose the lease type/);
  assert.equal(leaseBoundaryNote(null, null, "equity_share"), null);
});

test("divide: the product is divided by each divide field, percentages by value / 100", () => {
  const spec = { mode: "per_unit", methods: { kwh: { multiply: ["Q", "A"], divide: ["B", "O"], percent: ["O"] } } };
  const r = computeSpecActivityValue(spec, { Q: "1500", A: "200", B: "2000", O: "75" }, "kWh");
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.value - 200) < 1e-9, String(r.value));
  for (const bad of [{ B: "0" }, { B: "" }, { O: "120" }]) {
    const out = computeSpecActivityValue(spec, { Q: "1500", A: "200", B: "2000", O: "75", ...bad }, "kWh");
    assert.equal(out.ok, false, JSON.stringify(bad));
  }
  // Without divide nothing changes.
  const plain = computeSpecActivityValue({ mode: "per_unit", methods: { km: { multiply: ["D"] } } }, { D: "12" }, "km");
  assert.deepEqual(plain, { ok: true, value: 12, unitKey: "km" });
});

test("forms: every spec field is a column, every unit has a method, every option maps to a factor", () => {
  for (const n of ASSET_CATEGORIES) {
    const form = assetForm(n);
    const columns = new Set(form.columns.map((c) => c.name));
    assert.ok(columns.has(form.select), `${n} select`);
    for (const [key, m] of Object.entries(form.calculation.methods)) {
      for (const f of [...m.multiply, ...(m.divide ?? [])]) assert.ok(columns.has(f), `${n} ${key} ${f}`);
      for (const f of m.percent ?? []) assert.ok([...m.multiply, ...(m.divide ?? [])].includes(f), `${n} ${key} percent ${f}`);
    }
    for (const u of form.units) assert.ok(form.calculation.methods[normalizeUnitKey(u)], `${n} unit ${u}`);
    for (const key of Object.keys(form.calculation.methods)) assert.ok(form.units.some((u) => normalizeUnitKey(u) === key), `${n} spec ${key}`);
    for (const [label, factor] of Object.entries(form.options)) assert.ok(label && factor, `${n} option`);
    assert.ok(isStandardConfig({ config_name: form.config_name }));
    const fields = formFields(form, 77);
    assert.deepEqual(Object.keys(fields.column_options), ["77"]);
    assert.equal(fields.calculation.standard, configs.ASSETS_STANDARD);
    // Methods are the contract's, most specific first, and every method's units are form units.
    const contract = GHG_CATEGORIES.find((c) => c.n === n).methods.map((m) => m.key);
    assert.deepEqual(METHOD_OPTIONS[n], contract.filter((k) => METHOD_OPTIONS[n].includes(k)));
    for (const units of Object.values(UNITS_BY_METHOD[n])) for (const u of units) assert.ok(form.units.includes(u), `${n} ${u}`);
  }
  assert.equal(isStandardConfig({ config_name: "My own leases" }), false);
  assert.equal(assetForm(8).options["Reported Scope 1+2 [kgCO2e]"], REPORTED_KG);
  assert.equal(assetForm(15).options["Reported Scope 1+2 [tCO2e]"], REPORTED_T);
});

test("identity factors: 1 kgCO₂e per kgCO2e and 1,000 per tCO2e", () => {
  assert.deepEqual(
    IDENTITY_FACTORS.map((f) => [f.name, f.unit, f.value]),
    [
      [REPORTED_KG, "kgCO2e", 1],
      [REPORTED_T, "tCO2e", 1000],
    ],
  );
  const years = configs.identityYears(new Date("2026-10-15T00:00:00Z"));
  assert.equal(years[0], 2018);
  assert.equal(years[years.length - 1], 2027);
});

// ---------------------------------------------------------------------------
// Worked examples through the forms and the engine
// ---------------------------------------------------------------------------

const factor = (name, unit, value) => ({
  emission_factor_id: 1,
  emission_category_name: name,
  global_category_name: name,
  year: 2025,
  factor_value: value,
  denominator_unit: unit,
  source: "test",
});
const ctxFor = (n) => ({
  site_id: 1,
  category_id: 1,
  category_name: `Category ${n}`,
  scope: "Scope 3",
  assigned: true,
  hasForm: true,
  spec: assetForm(n).calculation,
  selectColumns: new Set(),
  factors: null,
  fera: null,
});
/** kgCO₂e of one row, from the engine's 2 dp tCO₂e (as stored). */
const kg = (n, f, unit, fields) => {
  const r = computeRow(ctxFor(n), { factor: f, activity_data: { ...fields }, activity_unit: unit });
  assert.equal(r.ok, true, JSON.stringify(r.issue));
  return r.computed.total * 1000;
};
const C = configs;

test("ex-8.1 asset-specific + non-sub-metered space: 1,320 kgCO₂e", () => {
  const space = { [C.COL_AREA]: 200, [C.COL_BUILDING_AREA]: 2000, [C.COL_OCCUPANCY]: 75 };
  const total =
    kg(8, factor("Natural gas [kWh]", "kWh", 0.2), "kWh", { [C.COL_QTY]: 1500, ...space }) +
    kg(8, factor("Electricity [kWh]", "kWh", 0.7), "kWh", { [C.COL_QTY]: 3000, ...space }) +
    kg(8, factor("Refrigerant [kg]", "kg", 1500), "kg", { [C.COL_QTY]: 5, ...space });
  assert.ok(Math.abs(total - 1320) < 0.5, String(total));
});

test("ex-13.1 lessee-specific: 3,000 kgCO₂e", () => {
  const total = kg(13, factor(REPORTED_KG, "kgCO2e", 1), "kgCO2e", { [C.COL_REPORTED_KG]: 9000, [C.COL_AREA]: 5000, [C.COL_BUILDING_AREA]: 15000 });
  assert.equal(total, 3000);
});

test("ex-14.1 franchise-specific: 355,000 kgCO₂e; 14.3 sample extrapolation scales by group ÷ sampled", () => {
  const f = factor(REPORTED_KG, "kgCO2e", 1);
  const one = (s1, s2) => kg(14, f, "kgCO2e", { [C.COL_REPORTED_KG]: s1, [C.COL_GROUP]: 1, [C.COL_SAMPLED]: 1 }) + kg(14, f, "kgCO2e", { [C.COL_REPORTED_KG]: s2, [C.COL_GROUP]: 1, [C.COL_SAMPLED]: 1 });
  const total = one(100000, 20000) + one(25000, 10000) + one(30000, 10000) + one(90000, 30000) + one(30000, 10000);
  assert.equal(total, 355000);
  assert.equal(kg(14, f, "kgCO2e", { [C.COL_REPORTED_KG]: 40000, [C.COL_GROUP]: 50, [C.COL_SAMPLED]: 10 }), 200000);
});

test("ex-14.2 average-data floor area: 23,500,000 kgCO₂e", () => {
  const food = factor("Floor area average [m2.year]", "m2.year", 30000);
  const clothing = factor("Floor area average [m2.year]", "m2.year", 10000);
  const area = (a) => ({ [C.COL_FLOOR_AREA]: a });
  const total = kg(14, food, "m2.year", area(100)) + kg(14, food, "m2.year", area(150)) + kg(14, clothing, "m2.year", area(400)) + kg(14, clothing, "m2.year", area(700)) + kg(14, clothing, "m2.year", area(500));
  assert.equal(total, 23500000);
});

test("ex-15.1 investment-specific: 493,000 tCO₂e", () => {
  const f = factor(REPORTED_T, "tCO2e", 1000);
  const row = (t, pct) => kg(15, f, "tCO2e", { [C.COL_INVESTEE_T]: t, [C.COL_EQUITY]: pct });
  assert.equal(row(120000, 40) + row(200000, 15) + row(1600000, 25) + row(60000, 25), 493000000);
});

test("ex-15.2 average-data: the guidance's own terms sum to 2,332,500 kgCO₂e (it prints 2,242,500)", () => {
  const row = (rev, sectorPct, equityPct, kgPerUsd) =>
    kg(15, factor("Sector", "USD", kgPerUsd), "USD", { [C.COL_REVENUE]: rev, [C.COL_SECTOR_SHARE]: sectorPct, [C.COL_EQUITY]: equityPct });
  const total = row(3000000, 100, 5, 0.6) + row(7500000, 100, 15, 0.5) + row(1150000, 100, 20, 3) + row(5500000, 60, 10, 2) + row(5500000, 40, 10, 1.5);
  assert.equal(total, 2332500);
});

// ---------------------------------------------------------------------------
// Category 15 plan rows
// ---------------------------------------------------------------------------

const inv = (o) => ({ id: 1, company_id: 1, investee: "A", type: "equity", share_pct: 25, investee_scope12_tco2e: null, year: 2025, source: null, revenue: null, currency: null, eeio_sector: null, sector_split: null, ...o });
const period = { kind: "yearly", year_type: "CY", year: 2025 };

test("plan rows: investment-specific with the identity factor, average-data per sector, no totals", () => {
  const { rows, planned, skipped } = investmentRows(
    [
      inv({ id: 1, investee_scope12_tco2e: 60000 }),
      inv({ id: 2, revenue: 5500000, currency: "USD", sector_split: { "Food and beverage": 0.6, Apparel: 0.4 } }),
      inv({ id: 3, revenue: 1000, eeio_sector: "Energy generation" }),
    ],
    9,
    15,
    period,
  );
  assert.deepEqual(skipped, []);
  assert.deepEqual(planned.map((p) => [p.investment_id, p.method, p.row_refs.length]), [
    [1, "investment_specific", 1],
    [2, "average_data", 2],
    [3, "average_data", 1],
  ]);
  assert.equal(rows[0].activity_name, REPORTED_T);
  assert.equal(rows[0].activity_unit, "tCO2e");
  assert.equal(rows[0].fields[C.COL_INVESTEE_T], 60000);
  assert.equal(rows[0].fields[C.COL_EQUITY], 25);
  assert.equal(rows[1].activity_name, "Food and beverage");
  assert.equal(rows[1].fields[C.COL_SECTOR_SHARE], "60");
  assert.equal(rows[2].fields[C.COL_SECTOR_SHARE], "40");
  assert.equal(rows[3].activity_unit, "USD"); // no currency = USD
  for (const r of rows) {
    assert.equal(r.site_id, 9);
    assert.equal(r.category_id, 15);
    for (const k of ["total", "total_emission", "total_tco2e", "factor", "factor_value"]) assert.equal(k in r, false);
  }
  assert.equal(new Set(rows.map((r) => r.row_ref)).size, rows.length);
});

test("plan rows: below the threshold, debt and missing data are listed, not planned", () => {
  const { rows, skipped } = investmentRows(
    [inv({ id: 1, share_pct: 0.5, investee_scope12_tco2e: 10 }), inv({ id: 2, type: "debt", investee_scope12_tco2e: 10 }), inv({ id: 3 }), inv({ id: 4, investee_scope12_tco2e: 10, share_pct: 1 })],
    9,
    15,
    period,
    1,
  );
  assert.deepEqual(skipped.map((s) => [s.investment_id, s.reason]), [
    [1, "below_threshold"],
    [2, "out_of_scope"],
    [3, "missing_data"],
  ]);
  assert.deepEqual(rows.map((r) => r.row_ref), ["investment-4"]);
});
