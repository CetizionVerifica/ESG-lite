// S3-0 contract tests: the Scope 3 categories, methods, factor types, data
// quality, error and warning codes, review checks and the zod schemas match
// docs/scope3/01-contracts.md. Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const cat = require(path.resolve("dist/scope3/contracts/ghgCategory.js"));
const factor = require(path.resolve("dist/scope3/contracts/factor.js"));
const dq = require(path.resolve("dist/scope3/contracts/dq.js"));
const errors = require(path.resolve("dist/scope3/contracts/errors.js"));
const checks = require(path.resolve("dist/scope3/contracts/checks.js"));
const schemas = require(path.resolve("dist/scope3/contracts/schemas.js"));

const ok = (schema, value) => schema.safeParse(value).success;

test("there are 15 categories, numbered 1–15 in order, with unique keys and names", () => {
  assert.deepEqual(cat.GHG_CATEGORIES.map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(new Set(cat.GHG_CATEGORIES.map((c) => c.key)).size, 15);
  assert.equal(new Set(cat.GHG_CATEGORIES.map((c) => c.name)).size, 15);
  assert.deepEqual(cat.GHG_CATEGORIES.map((c) => c.key), [...cat.GHG_CATEGORY_KEYS]);
});

test("every category offers at least one method, each method once, all from the Method enum", () => {
  for (const c of cat.GHG_CATEGORIES) {
    assert.ok(c.methods.length >= 1, `Category ${c.n} has no method`);
    const keys = c.methods.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length, `Category ${c.n} repeats a method`);
    for (const k of keys) assert.ok(cat.MethodSchema.safeParse(k).success, `${k} is not a Method`);
    for (const m of c.methods) assert.ok(m.label.length > 0);
  }
  assert.equal(new Set(cat.METHOD_KEYS).size, cat.METHOD_KEYS.length);
  assert.ok(cat.METHOD_KEYS.includes("unknown"));
});

test("categories 1–8 are upstream and 9–15 downstream", () => {
  for (const c of cat.GHG_CATEGORIES) assert.equal(c.direction, c.n <= 8 ? "upstream" : "downstream", `Category ${c.n}`);
});

test("methods come in specificity order, with the plain labels of the contract", () => {
  assert.deepEqual(cat.ghgCategory(1).methods.map((m) => m.key), ["supplier_specific", "hybrid", "average_data", "spend_based"]);
  assert.deepEqual(cat.ghgCategory(2).methods, cat.ghgCategory(1).methods);
  assert.deepEqual(cat.ghgCategory(9).methods, cat.ghgCategory(4).methods);
  assert.equal(cat.methodRank(1, "supplier_specific"), 0);
  assert.equal(cat.methodRank(1, "spend_based"), 3);
  assert.equal(cat.methodRank(1, "fuel_based"), -1);
  assert.equal(cat.methodLabel("average_data", 1), "Average for the material");
  assert.equal(cat.methodLabel("average_data", 7), "Headcount × national average");
  assert.equal(cat.methodLabel("distance_based", 4), "Weight × distance");
  assert.equal(cat.methodLabel("distance_based", 6), "Distance travelled");
  assert.equal(cat.methodLabel("site_specific", 4), "Warehouse energy");
  assert.equal(cat.methodLabel("spend_based"), "From the amount spent");
  assert.equal(cat.categoryLabel(1), "Category 1 · Purchased goods and services");
  assert.equal(cat.methodAllowed(3, "spend_based"), false);
  assert.equal(cat.methodAllowed(11, "direct_use"), true);
});

test("scope is Scope 1, 2, 3 or null; Cat 3 has four sub-activities", () => {
  for (const s of ["Scope 1", "Scope 2", "Scope 3", null]) assert.ok(ok(cat.ScopeSchema, s), String(s));
  assert.equal(ok(cat.ScopeSchema, "Scope 4"), false);
  assert.deepEqual([...cat.SCOPE3_SUBS], ["3a_upstream_fuels", "3b_upstream_electricity", "3c_td_losses", "3d_resold_energy"]);
});

test("factor types, GWP sets and gases match §2; allowed types per category warn only where listed", () => {
  assert.equal(factor.FACTOR_TYPES.length, 9);
  assert.deepEqual([...factor.GWP_SETS], ["AR4", "AR5", "AR6"]);
  assert.equal(factor.DEFAULT_GWP_SET, "AR6");
  assert.equal(factor.GASES.length, 7);
  assert.equal(factor.factorTypeAllowed(1, "eeio_spend"), true);
  assert.equal(factor.factorTypeAllowed(3, "combustion"), false);
  assert.equal(factor.factorTypeAllowed(4, "other"), true); // §10
  assert.equal(factor.factorTypeAllowed(6, "other"), false);
  assert.equal(factor.factorTypeAllowed(8, "other"), true); // no list yet (§10 follow-up)
  for (const types of Object.values(factor.ALLOWED_FACTOR_TYPES)) {
    for (const t of types) assert.ok(factor.FactorTypeSchema.safeParse(t).success, t);
  }
});

test("data quality: scores 1–3, overall is the rounded mean", () => {
  const scores = { technology: 1, geography: 2, time: 1, completeness: 1, reliability: 2 };
  assert.equal(dq.overallOf(scores), 1); // 1.4
  assert.equal(dq.overallOf({ ...scores, completeness: 3 }), 2); // 1.8
  assert.equal(dq.overallOf({ technology: 3, geography: 3, time: 3, completeness: 3, reliability: 3 }), 3);
  assert.equal(ok(dq.DqSchema, { ...scores, overall: 1, source: "auto" }), true);
  assert.equal(ok(dq.DqSchema, { ...scores, overall: 4, source: "auto" }), false);
  assert.equal(ok(dq.DqSchema, { ...scores, overall: 1, source: "guess" }), false);
  assert.equal(ok(dq.DataTypeSchema, "primary"), true);
});

test("every §7 error has a status and a message; warnings never carry a status", () => {
  const expected = [
    "SCOPE_INVALID", "GHG_CATEGORY_INVALID", "GHG_CATEGORY_REQUIRED", "EXCLUSION_REASON_REQUIRED", "UNIT_REQUIRED",
    "METHOD_NOT_ALLOWED", "CURRENCY_NOT_SUPPORTED", "SUPPLIER_FACTOR_BOUNDARY", "PERIOD_LOCKED", "UNLOCK_REASON_REQUIRED",
    "NOT_DRAFT", "EXTRAPOLATION_BASIS_INVALID", "PERIOD_INCOMPLETE", "BASE_YEAR_NO_DATA", "RECALCULATION_REASON_REQUIRED",
  ];
  assert.deepEqual([...errors.SCOPE3_ERROR_CODES].sort(), [...expected].sort());
  for (const code of expected) {
    const e = errors.SCOPE3_ERRORS[code];
    assert.ok(e.status >= 400 && e.status < 500, code);
    assert.ok(e.message.length > 0, code);
  }
  const err = new errors.Scope3Error("PERIOD_LOCKED", { site_id: 1 });
  assert.deepEqual(err.toBody(), { code: "PERIOD_LOCKED", message: errors.SCOPE3_ERRORS.PERIOD_LOCKED.message, details: { site_id: 1 } });
  assert.equal(err.status, 409);
  assert.equal(errors.SCOPE3_WARNING_CODES.length, 8);
  assert.deepEqual(errors.scope3Warning("NO_DEFLATOR"), { code: "NO_DEFLATOR", message: errors.SCOPE3_WARNINGS.NO_DEFLATOR });
  for (const code of errors.SCOPE3_WARNING_CODES) assert.ok(!errors.SCOPE3_ERROR_CODES.includes(code), code);
});

test("the eight review checks of §8", () => {
  assert.deepEqual([...checks.CHECK_IDS], [
    "FACTOR_FOUND", "UNIT_OK", "EVIDENCE_ATTACHED", "WITHIN_THRESHOLD", "NO_DUPLICATE", "IMPORT_MATCH_SURE", "METHOD_GIVEN", "DQ_ACCEPTABLE",
  ]);
  for (const id of checks.CHECK_IDS) assert.ok(checks.CHECK_RULES[id]);
  assert.equal(checks.IMPORT_MATCH_SURE_AT, 0.8);
  assert.equal(ok(checks.RowChecksSchema, { ready: false, held: ["EVIDENCE_ATTACHED"] }), true);
  assert.equal(ok(checks.RowChecksSchema, { ready: false, held: ["SOMETHING_ELSE"] }), false);
});

test("schemas: boundary reasons, GHG numbers only for Scope 3, spend factors, supplier boundary, EoL mix", () => {
  assert.equal(ok(schemas.PutScope3CategoryBodySchema, { status: "included" }), true);
  assert.equal(ok(schemas.PutScope3CategoryBodySchema, { status: "excluded" }), false);
  assert.equal(ok(schemas.PutScope3CategoryBodySchema, { status: "excluded", reason: "  " }), false);
  assert.equal(ok(schemas.PutScope3CategoryBodySchema, { status: "not_relevant", reason: "No franchises" }), true);

  assert.equal(ok(schemas.CategoryGhgSchema, { scope: "Scope 3", ghg_category: 4 }), true);
  assert.equal(ok(schemas.CategoryGhgSchema, { scope: "Scope 1", ghg_category: 4 }), false);
  assert.equal(ok(schemas.CategoryGhgSchema, { scope: "Scope 3", ghg_category: 16 }), false);
  assert.equal(ok(schemas.CategoryGhgSchema, { scope: null, ghg_category: null }), true);

  const factorRow = { factor_type: "eeio_spend", gwp_set: "AR6", geography: "US", dataset: "USEEIO" };
  assert.equal(ok(schemas.FactorMetadataSchema, factorRow), false);
  assert.equal(ok(schemas.FactorMetadataSchema, { ...factorRow, price_base_year: 2022, price_currency: "USD" }), true);
  assert.equal(ok(schemas.FactorMetadataSchema, { ...factorRow, factor_type: "combustion" }), true);

  const sf = { item: "Aluminium ingot", unit: "kg", kgco2e_per_unit: 8.3, boundary: "cradle_to_gate", reference_year: 2025, gwp_set: "AR6" };
  assert.equal(ok(schemas.SupplierFactorBodySchema, sf), true);
  assert.equal(ok(schemas.SupplierFactorBodySchema, { ...sf, boundary: "cradle_to_grave" }), false);

  assert.equal(ok(schemas.EolMixSchema, [{ treatment: "landfill", share: 0.6 }, { treatment: "recycling", share: 0.4 }]), true);
  assert.equal(ok(schemas.EolMixSchema, [{ treatment: "landfill", share: 0.6 }]), false);

  assert.equal(ok(schemas.SubmitEmissionsBodySchema, { ids: [] }), false);
  assert.equal(ok(schemas.UnlockPeriodBodySchema, { year: 2025, month: 9 }), false);
  assert.equal(ok(schemas.UnlockPeriodBodySchema, { year: 2025, month: 9, reason: "Late invoice" }), true);
  assert.equal(ok(schemas.FxRatesQuerySchema, { currency: "usd", date: "2025-09-30" }), false);
  assert.equal(ok(schemas.EmissionStatusSchema, "draft"), true);
  assert.equal(ok(schemas.EmissionScope3FieldsSchema, { method: "spend_based", total_kgco2e: "1234.5678", gas_kg: { CO2: 10 } }), true);
});
