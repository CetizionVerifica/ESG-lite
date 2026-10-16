// S3-10 sold products: the BOM mass split, mass-sold maths, the plan rows for
// Categories 10, 11 and 12, the standard forms (and the Category 11 upgrade of
// the seeded form), the AR6 refrigerant seed rows, and the guidance's worked
// examples 10.1, 10.2, 11.1, 11.3 (formula 11.5) and 12.1 run through the
// real forms and the engine (computeRow).
// Runs against the compiled build (npm run build && npm run test:unit).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { computeSpecActivityValue, ROW_METHOD_COLUMN } = require(path.resolve("dist/services/calculationSpec.js"));
const { computeRow } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const C = require(path.resolve("dist/scope3/soldProducts/configs.js"));
const { massKg, materialOf, splitByMass, bomFromLines } = require(path.resolve("dist/scope3/soldProducts/bom.js"));
const R = require(path.resolve("dist/scope3/soldProducts/rows.js"));
const { EOL_FACTORS, REFRIGERANT_AR6, perTonneToPerKg } = require(path.resolve("dist/scope3/soldProducts/factors.js"));
const S = require(path.resolve("dist/scope3/soldProducts/schemas.js"));
const { ImportRowSchema } = require(path.resolve("dist/imports/contracts.js"));

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const base = { site_id: 1, category_id: 9, period: { kind: "yearly", year_type: "CY", year: 2025 } };

/** kgCO₂e of one row through a form's spec and the engine. */
function engineKg(spec, fields, unit, factorValue, factorUnit = unit) {
  const value = computeSpecActivityValue(spec, fields, unit, fields[ROW_METHOD_COLUMN]);
  assert.equal(value.ok, true, value.message);
  const ctx = { spec, factors: null, fera: null };
  const factor = { emission_factor_id: 1, emission_category_name: "F", global_category_name: "F", factor_value: String(factorValue), denominator_unit: factorUnit, year: 2025 };
  const out = computeRow(ctx, { factor, activity_data: { emission_category: "F", ...fields }, activity_unit: unit, method: fields[ROW_METHOD_COLUMN] });
  assert.equal(out.ok, true, JSON.stringify(out.issue));
  const c = out.computed;
  return c.total_kgco2e !== undefined ? Number(c.total_kgco2e) : c.total * 1000;
}

// ── BOM split ───────────────────────────────────────────────────────────────
test("massKg: kg, g and tonnes; anything else is not a mass", () => {
  assert.equal(massKg(5, "kg"), 5);
  assert.equal(massKg(500, "g"), 0.5);
  assert.equal(massKg(2, "t"), 2000);
  assert.equal(massKg(2, " Tonnes "), 2000);
  assert.equal(massKg(3, "units"), null);
  assert.equal(massKg(3, "m"), null);
});

test("materialOf: material factor group first, then the line name; unknown is Mixed", () => {
  assert.equal(materialOf({ name: "Rod", material_group: "aluminium" }), "Aluminium");
  assert.equal(materialOf({ name: "XLPE insulation", material_group: null }), "Plastics");
  assert.equal(materialOf({ name: "PVC sheath", material_group: "chemical" }), "Plastics");
  assert.equal(materialOf({ name: "Steel tape armour", material_group: null }), "Steel");
  assert.equal(materialOf({ name: "Wooden drum", material_group: "packaging" }), "Wood");
  assert.equal(materialOf({ name: "Corrugated cardboard", material_group: "packaging" }), "Paper and board");
  assert.equal(materialOf({ name: "Mystery compound", material_group: null }), "Mixed");
});

test("splitByMass: shares by mass of mass-unit lines only; none → Mixed 100 %", () => {
  const split = splitByMass([
    { name: "Aluminium rod", material_group: "aluminium", quantity: 600, unit: "g" },
    { name: "XLPE", material_group: "polymer", quantity: 0.3, unit: "kg" },
    { name: "PVC", material_group: null, quantity: 0.1, unit: "kg" },
    { name: "Electricity", material_group: "energy", quantity: 5, unit: "kWh" },
  ]);
  close(split.Aluminium, 0.6);
  close(split.Plastics, 0.4);
  assert.deepEqual(Object.keys(split), ["Aluminium", "Plastics"]);
  assert.deepEqual(splitByMass([]), { Mixed: 1 });
  assert.deepEqual(splitByMass([{ name: "x", material_group: null, quantity: 3, unit: "m2" }]), { Mixed: 1 });
  const bom = bomFromLines(
    [
      { stage: "A1", name: "Copper", material_group: "copper", quantity: 1, unit: "kg" },
      { stage: "A3_packaging", name: "Cardboard box", material_group: "packaging", quantity: 50, unit: "g" },
      { stage: "A2", name: "Truck", material_group: null, quantity: 9, unit: "kg" },
    ],
    7,
  );
  assert.deepEqual(bom, { product: { Copper: 1 }, packaging: { "Paper and board": 1 }, pcf_study_id: 7 });
});

// ── Mass-sold maths ─────────────────────────────────────────────────────────
const product = (over = {}) => ({ product_id: 1, name: "Cable A", mass_per_unit_kg: 2.5, lifetime_uses: null, eol_mix: null, use_profile: null, ...over });

test("soldTotals: units × mass per unit; sales in mass count as mass; packaging per unit", () => {
  const t = R.soldTotals(product({ use_profile: { packaging_kg_per_unit: 0.2 } }), [
    { product_id: 1, quantity: 100, unit: "units" },
    { product_id: 1, quantity: 1, unit: "t" },
  ]);
  close(t.units, 100 + 1000 / 2.5);
  close(t.mass_kg, 250 + 1000);
  close(t.packaging_kg, (100 + 400) * 0.2);
  // No mass per unit: units known only for unit sales, mass unknown.
  const u = R.soldTotals(product({ mass_per_unit_kg: null }), [{ product_id: 1, quantity: 10, unit: "pcs" }]);
  assert.equal(u.units, 10);
  assert.equal(u.mass_kg, null);
  const m = R.soldTotals(product({ mass_per_unit_kg: null }), [{ product_id: 1, quantity: 10, unit: "kg" }]);
  assert.equal(m.units, null);
  assert.equal(m.mass_kg, 10);
});

test("monthOf and yearWindow: months are stored as the first day; FY is April to March", () => {
  assert.equal(R.monthOf("2026-03"), "2026-03-01");
  assert.equal(R.monthOf("2026-03-17"), "2026-03-01");
  assert.equal(R.monthOf("2026-13"), null);
  assert.equal(R.monthOf("2026-02-30"), null);
  assert.equal(R.monthOf("March 2026"), null);
  assert.deepEqual(R.yearWindow(2026, "CY"), { from: "2026-01-01", to: "2026-12-01" });
  assert.deepEqual(R.yearWindow(2026, "FY"), { from: "2025-04-01", to: "2026-03-01" });
});

// ── Plan rows ───────────────────────────────────────────────────────────────
const sales = [{ product_id: 1, quantity: 4000, unit: "units" }];

test("Category 10 rows: one average_data row per product with Mass sold (kg); no mass → skipped", () => {
  const out = R.soldProductRows(10, [product(), product({ product_id: 2, name: "B", mass_per_unit_kg: null })], [...sales, { product_id: 2, quantity: 5, unit: "units" }], new Map(), base);
  assert.equal(out.rows.length, 1);
  const [row] = out.rows;
  assert.equal(row.activity_name, C.PROCESSING_AVERAGE);
  assert.equal(row.fields[ROW_METHOD_COLUMN], "average_data");
  assert.equal(row.fields[C.COL_MASS_SOLD], 10000);
  assert.equal(row.fields[C.COL_PRODUCT], "Cable A");
  assert.deepEqual(out.skipped, [{ product_id: 2, product: "B", reason: "missing_mass" }]);
  assert.equal(C.PROCESSING_OPTIONS[row.activity_name], "Processing of sold products [kg]");
});

test("Category 11 rows: the use profile picks the method, option and fields; missing data is skipped", () => {
  const energy = product({ lifetime_uses: 11500, use_profile: { use_type: "energy", use_option: "India", energy_per_use_kwh: 1.3 } });
  const gas = product({ product_id: 2, name: "Chiller", use_profile: { use_type: "gas", use_option: "R134a", gas_per_product_kg: 2 } });
  const part = product({ product_id: 3, name: "Engine", lifetime_uses: 300000, use_profile: { use_type: "intermediate", final_product_share_pct: 4 } });
  const none = product({ product_id: 4, name: "Plain" });
  const badOption = product({ product_id: 5, name: "Odd", use_profile: { use_type: "fuel", use_option: "Kerosene" } });
  const s = [1, 2, 3, 4, 5].map((id) => ({ product_id: id, quantity: 10, unit: "units" }));
  const out = R.soldProductRows(11, [energy, gas, part, none, badOption], s, new Map(), base);
  const byRef = Object.fromEntries(out.rows.map((r) => [r.row_ref, r]));
  assert.deepEqual(Object.keys(byRef), ["sold-11-1", "sold-11-2", "sold-11-3"]);
  assert.equal(byRef["sold-11-1"].activity_name, "Product that uses energy|India");
  assert.equal(byRef["sold-11-1"].activity_unit, "kWh");
  assert.deepEqual(byRef["sold-11-1"].fields, {
    Method: "Product that uses energy",
    "Country / Fuel / Gas": "India",
    "Product Name": "Cable A",
    "Units Sold": 10,
    "Energy per Use (kWh)": 1.3,
    "Lifetime Uses": 11500,
  });
  // 100 % released when the profile doesn't say (L5442-5452).
  assert.equal(byRef["sold-11-2"].fields["% of Gas Released"], 100);
  assert.equal(byRef["sold-11-3"].activity_name, "Part of a customer's product|Final product use");
  assert.equal(byRef["sold-11-3"].activity_unit, "use");
  assert.deepEqual(
    out.skipped.map((x) => [x.product_id, x.reason]),
    [
      [4, "missing_use_profile"],
      [5, "missing_use_profile"],
    ],
  );
  // Every row's label chain is one the form maps to a factor.
  const mapping = C.useMapping();
  for (const r of out.rows) assert.ok(mapping[r.activity_name], r.activity_name);
});

test("Category 12 rows: product × material × treatment with a share above 0, packaging included", () => {
  const p = product({ eol_mix: [{ treatment: "landfill", share: 0.9 }, { treatment: "incineration", share: 0.1 }, { treatment: "recycling", share: 0 }], use_profile: { packaging_kg_per_unit: 0.5 } });
  const boms = new Map([[1, { product: { Aluminium: 0.6, Plastics: 0.4 }, packaging: { Wood: 1 }, pcf_study_id: 3 }]]);
  const out = R.soldProductRows(12, [p], sales, boms, base);
  // 3 materials × 2 treatments; the 0 % recycling rows are not created.
  assert.equal(out.rows.length, 6);
  const al = out.rows.filter((r) => r.fields.Material === "Aluminium");
  assert.deepEqual(al.map((r) => [r.activity_name, r.fields["Share treated this way (%)"]]), [
    ["Aluminium|Landfill", 90],
    ["Aluminium|Incineration", 10],
  ]);
  assert.equal(al[0].fields["Mass at end of life (kg)"], 6000);
  assert.equal(out.rows.find((r) => r.fields.Material === "Wood").fields["Mass at end of life (kg)"], 2000);
  assert.ok(out.rows.every((r) => r.fields[ROW_METHOD_COLUMN] === "waste_type_specific"));
  assert.deepEqual(out.planned, [{ product_id: 1, row_refs: out.rows.map((r) => r.row_ref), method: "waste_type_specific" }]);
  // No mix: one average_data row per material; no study: one Mixed line.
  const avg = R.soldProductRows(12, [product()], sales, new Map(), base);
  assert.deepEqual(avg.rows.map((r) => [r.activity_name, r.fields[ROW_METHOD_COLUMN], r.fields["Mass at end of life (kg)"]]), [
    ["Mixed|Average (treatment unknown)", "average_data", 10000],
  ]);
  const mapping = C.eolMapping();
  for (const r of [...out.rows, ...avg.rows]) assert.ok(mapping[r.activity_name], r.activity_name);
});

test("plan rows are valid import rows and carry no total", () => {
  const p = product({ lifetime_uses: 10, eol_mix: [{ treatment: "landfill", share: 1 }], use_profile: { use_type: "fuel", use_option: "Diesel" } });
  for (const n of [10, 11, 12]) {
    const { rows } = R.soldProductRows(n, [p], sales, new Map(), base);
    assert.ok(rows.length > 0, String(n));
    for (const r of rows) {
      assert.equal(ImportRowSchema.safeParse(r).success, true, JSON.stringify(r));
      for (const k of ["total", "total_emission", "total_tco2e", "total_kgco2e"]) assert.equal(k in r, false);
      assert.equal(r.activity_value, undefined);
    }
  }
});

// ── Forms ───────────────────────────────────────────────────────────────────
test("forms: every select option chain maps to a factor; methods and units follow the contracts", () => {
  const ids = { [C.COL_PROCESSING]: 1, [C.COL_METHOD]: 2, [C.COL_MATERIAL]: 3, [C.COL_TREATMENT]: 4 };
  const f10 = C.formFields(C.soldProductForm(10), ids);
  assert.deepEqual(f10.column_options["1"].map((o) => o.id), Object.keys(C.PROCESSING_OPTIONS));
  assert.deepEqual(Object.keys(f10.calculation.methods), ["site_specific", "average_data"]);
  assert.equal(f10.calculation.method_column, "@method");

  const f11 = C.formFields(C.soldProductForm(11), ids);
  for (const [method, opts] of Object.entries(f11.dependent_options["Country / Fuel / Gas"])) {
    for (const o of opts) assert.ok(f11.emission_category_mapping[`${method}|${o.id}`], `${method}|${o.id}`);
  }
  assert.deepEqual(f11.column_options["2"].map((o) => o.id), [C.METHOD_ENERGY, C.METHOD_FUEL, C.METHOD_GAS, C.METHOD_PART]);
  // The seeded formulas are kept as they are.
  for (const k of [C.METHOD_ENERGY, C.METHOD_FUEL, C.METHOD_GAS]) assert.deepEqual(f11.calculation.methods[k], C.LEGACY_USE_CALCULATION.methods[k]);
  assert.deepEqual(f11.calculation.identity_columns, ["Product Name"]);

  const f12 = C.formFields(C.soldProductForm(12), ids);
  for (const [material, opts] of Object.entries(f12.dependent_options.Treatment)) {
    for (const o of opts) assert.ok(f12.emission_category_mapping[`${material}|${o.id}`], `${material}|${o.id}`);
  }
  // Composting only for organic materials; recycling is the cut-off factor.
  assert.equal(f12.emission_category_mapping["Steel|Composting"], undefined);
  assert.equal(f12.emission_category_mapping["Steel|Recycling"], "End of life - Steel - Recycling (cut-off) [kg]");
  assert.deepEqual(C.METHOD_OPTIONS, { 10: ["site_specific", "average_data"], 11: ["direct_use"], 12: ["waste_type_specific", "average_data"] });
});

test("Category 11: the seeded form is recognised for the upgrade; a changed one is not", () => {
  const legacy = {
    config_name: "Use of Sold Products - Standard",
    columns: C.LEGACY_USE_COLUMNS.map((c, i) => ({ pk_id: i + 1, column_name: c.name })),
    emission_category_mapping: C.LEGACY_USE_MAPPING,
    dependent_options: {
      "Country / Fuel / Gas": {
        [C.METHOD_ENERGY]: ["Germany", "Denmark", "Netherlands", "India"].map((x) => ({ id: x, label: x })),
        [C.METHOD_FUEL]: ["Petrol", "Diesel"].map((x) => ({ id: x, label: x })),
        [C.METHOD_GAS]: ["R134a", "R410A"].map((x) => ({ id: x, label: x })),
      },
    },
    calculation: JSON.parse(JSON.stringify(C.LEGACY_USE_CALCULATION)),
  };
  assert.equal(C.isLegacyUseConfig(legacy), true);
  assert.equal(C.isLegacyUseConfig({ ...legacy, config_name: "Client form" }), false);
  assert.equal(C.isLegacyUseConfig({ ...legacy, emission_category_mapping: { ...C.LEGACY_USE_MAPPING, "x|y": "z" } }), false);
  const changedCalc = JSON.parse(JSON.stringify(C.LEGACY_USE_CALCULATION));
  changedCalc.methods[C.METHOD_FUEL].multiply.push("Lifetime Uses");
  assert.equal(C.isLegacyUseConfig({ ...legacy, calculation: changedCalc }), false);
  // A standard form stays standard only while its hash matches.
  const fields = C.formFields(C.soldProductForm(12), { Material: 3, Treatment: 4 });
  const columns = [{ pk_id: 3 }, { pk_id: 4 }];
  const calculation = { ...fields.calculation, standard_hash: C.standardHash({ ...fields, columns, calculation: fields.calculation }) };
  assert.equal(C.isStandardConfig({ ...fields, columns, calculation }), true);
  assert.equal(C.isStandardConfig({ ...fields, columns, calculation, emission_category_mapping: {} }), false);
});

// ── Seed factors ────────────────────────────────────────────────────────────
test("AR6 refrigerant rows (D7): R134a 1530 and R410A 2256 for 2026, gwp_set AR6", () => {
  assert.deepEqual(
    REFRIGERANT_AR6.map((f) => [f.name, f.unit, f.gwp_set, f.factor_type, Object.entries(f.values).map(([y, v]) => [y, v.value])]),
    [
      ["R134a - GWP", "kg", "AR6", "other", [["2026", 1530]]],
      ["R410A - GWP", "kg", "AR6", "other", [["2026", 2256]]],
    ],
  );
  // The AR4 rows the seed wrote are the ones the migration marks AR4.
  assert.deepEqual(C.REFRIGERANT_FACTORS.map((f) => [f.name, f.ar4]), [
    ["R134a - GWP", 1430],
    ["R410A - GWP", 2088],
  ]);
  assert.equal(C.LEGACY_USE_MAPPING[`${C.METHOD_GAS}|R134a`], "R134a - GWP");
});

test("Category 12 seed factors: one per mapped name, per kg, process type; per tonne → per kg", () => {
  const mapped = new Set(Object.values(C.eolMapping()));
  assert.deepEqual(new Set(EOL_FACTORS.map((f) => f.name)), mapped);
  assert.ok(EOL_FACTORS.every((f) => f.unit === "kg" && f.factor_type === "process"));
  assert.equal(perTonneToPerKg(1250.5), 1.2505);
});

// ── Schemas ─────────────────────────────────────────────────────────────────
test("schemas: EOL mix must add up to 1; plan body; sales body ≤ 5,000 rows", () => {
  assert.equal(S.PutUseProfileBodySchema.safeParse({ eol_mix: [{ treatment: "landfill", share: 0.6 }, { treatment: "recycling", share: 0.4 }] }).success, true);
  assert.equal(S.PutUseProfileBodySchema.safeParse({ eol_mix: [{ treatment: "landfill", share: 0.6 }] }).success, false);
  assert.equal(S.PutUseProfileBodySchema.safeParse({ use_profile: { use_type: "steam" } }).success, false);
  assert.equal(S.PutUseProfileBodySchema.safeParse({ colour: "red" }).success, false);
  assert.equal(S.SoldProductsPlanBodySchema.safeParse({ site_id: 1, year: 2026, year_type: "FY", ghg_category: 12 }).success, true);
  assert.equal(S.SoldProductsPlanBodySchema.safeParse({ site_id: 1, year: 2026, year_type: "FY", ghg_category: 9 }).success, false);
  const sale = { product_id: 1, period: "2026-01", quantity: 5, unit: "units" };
  assert.equal(S.PostSalesBodySchema.safeParse({ sales: [sale] }).success, true);
  assert.equal(S.PostSalesBodySchema.safeParse({ sales: [{ ...sale, quantity: 0 }] }).success, false);
  assert.equal(S.PostSalesBodySchema.safeParse({ sales: Array(S.PRODUCT_SALES_MAX_ROWS + 1).fill(sale) }).success, false);
});

// ── Worked examples through the forms and the engine ────────────────────────
test("ex-10.1 site-specific processing: 3,500 kWh × 0.2 + 2,000 kWh × 0.5 + 50 kg × 0.5, share 100 % = 1,725 kg", () => {
  const spec = C.processingSpec();
  const value = (q) => computeSpecActivityValue(spec, { "@method": "site_specific", [C.COL_QUANTITY]: String(q), [C.COL_SHARE_OURS]: "100" }, "kWh").value;
  // The form's activity values × the guidance's factors.
  close(value(3500) * 0.2 + value(2000) * 0.5 + value(50) * 0.5, 1725, 1e-9);
  // Through the engine: rows are stored at 2 dp tCO₂e until S3-4's kg figure, so the
  // 25 kg waste row reads 30 kg (golden ex-10.1 runs once S3-4 lands).
  const row = (q, unit, f) => engineKg(spec, { "@method": "site_specific", [C.COL_QUANTITY]: String(q), [C.COL_SHARE_OURS]: "100" }, unit, f);
  close(row(3500, "kWh", 0.2) + row(2000, "kWh", 0.5), 1700, 1e-9);
  assert.ok(Math.abs(row(50, "kg", 0.5) - 25) <= 5);
});

test("ex-10.2 average processing: 1,000 kg × 1.5 = 1,500 kg", () => {
  close(engineKg(C.processingSpec(), { "@method": "average_data", [C.COL_MASS_SOLD]: "1000" }, "kg", 1.5), 1500, 1e-6);
});

test("ex-11.1 energy-using products: 13,042,500 kg", () => {
  const spec = C.useSpec();
  const row = (sold, uses, kwh) =>
    engineKg(spec, { Method: C.METHOD_ENERGY, [C.COL_UNITS_SOLD]: String(sold), [C.COL_LIFETIME_USES]: String(uses), [C.COL_ENERGY_PER_USE]: String(kwh) }, "kWh", 0.5);
  close(row(1000, 11500, 1.3) + row(1100, 1900, 1.5) + row(2000, 20000, 0.2), 13042500, 1e-6);
});

test("ex-11.3 part of a customer's product (11.5): 10 × 300,000 × 4 % × 0.3 = 36,000 kg", () => {
  const fields = { Method: C.METHOD_PART, [C.COL_UNITS_SOLD]: "10", [C.COL_FINAL_USES]: "300000", [C.COL_FINAL_SHARE]: "4" };
  close(engineKg(C.useSpec(), fields, "use", 0.3), 36000, 1e-6);
});

test("ex-12.1 end of life: 10,000 kg × 90 % × 0.3 + 10,000 × 10 % × 1.0 = 3,700 kg (the 0 % row is not created)", () => {
  const p = product({ mass_per_unit_kg: 1, eol_mix: [{ treatment: "landfill", share: 0.9 }, { treatment: "incineration", share: 0.1 }, { treatment: "recycling", share: 0 }] });
  const { rows } = R.soldProductRows(12, [p], [{ product_id: 1, quantity: 10000, unit: "units" }], new Map(), base);
  assert.equal(rows.length, 2);
  const factor = { "Mixed|Landfill": 0.3, "Mixed|Incineration": 1.0 };
  const total = rows.reduce((sum, r) => sum + engineKg(C.eolSpec(), r.fields, "kg", factor[r.activity_name]), 0);
  close(total, 3700, 1e-6);
});

test("withoutImported: saved rows leave the plan; the product is listed once as already_imported", () => {
  const base = { site_id: 1, category_id: 12, period: { kind: "yearly", year_type: "CY", year: 2025 } };
  const product = { product_id: 7, name: "Drum", mass_per_unit_kg: 1, lifetime_uses: null, eol_mix: [{ treatment: "landfill", share: 0.9 }, { treatment: "incineration", share: 0.1 }], use_profile: null };
  const out = R.soldProductRows(12, [product], [{ product_id: 7, quantity: 100, unit: "unit" }], new Map(), base);
  assert.equal(out.rows.length, 2);
  assert.equal(R.withoutImported(out, () => false), out);
  const one = R.withoutImported(out, (r) => r.activity_name === "Mixed|Landfill");
  assert.deepEqual(one.rows.map((r) => r.activity_name), ["Mixed|Incineration"]);
  assert.deepEqual(one.planned[0].row_refs, [one.rows[0].row_ref]);
  assert.deepEqual(one.skipped, [{ product_id: 7, product: "Drum", reason: "already_imported" }]);
  const all = R.withoutImported(out, () => true);
  assert.deepEqual([all.rows.length, all.planned.length, all.skipped.length], [0, 0, 1]);
});
