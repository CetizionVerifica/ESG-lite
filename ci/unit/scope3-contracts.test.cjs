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
  assert.equal(factor.factorTypeAllowed(8, "other"), true); // reported partner emissions (D13)
  assert.equal(factor.factorTypeAllowed(15, "eeio_spend"), true);
  assert.equal(factor.factorTypeAllowed(15, "wtt"), false);
  assert.equal(factor.factorTypeAllowed(10, "process"), true);
  for (const n of [8, 13, 14, 15]) assert.equal(factor.factorTypeAllowed(n, "other"), true);
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
  assert.equal(errors.SCOPE3_WARNING_CODES.length, 9);
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
  // Same limits as the emission_factors columns (varchar 60/40).
  assert.equal(ok(schemas.FactorMetadataSchema, { ...factorRow, factor_type: "combustion", dataset: "d".repeat(61) }), false);
  assert.equal(ok(schemas.FactorMetadataSchema, { ...factorRow, factor_type: "combustion", dataset_version: "v".repeat(41) }), false);

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

test("schemas for the §5 bodies and shapes folded in from §10 and the module specs", () => {
  assert.equal(ok(schemas.MethodOptionsSchema, [{ method: "distance_based", units: ["tonne.km"] }, { method: "spend_based", units: ["USD"] }]), true);
  assert.equal(ok(schemas.MethodOptionsSchema, [{ method: "spend_based", units: ["USD"] }, { method: "spend_based", units: ["EUR"] }]), false);
  assert.equal(ok(schemas.MethodOptionsSchema, [{ method: "unknown", units: ["kg"] }]), false);

  const ex = { ghg_category: 4, site_id: 1, year: 2026, year_type: "CY", basis: "coverage", coverage_pct: 85 };
  assert.equal(ok(schemas.ExtrapolateBodySchema, ex), true);
  assert.equal(ok(schemas.ExtrapolateBodySchema, { ...ex, coverage_pct: 100 }), false);
  assert.equal(ok(schemas.ExtrapolateBodySchema, { ...ex, basis: "guess" }), false);
  const { coverage_pct, ...noPct } = ex;
  assert.equal(ok(schemas.ExtrapolateBodySchema, noPct), false);
  assert.equal(ok(schemas.ExtrapolateBodySchema, { ...noPct, basis: "intensity" }), true);

  const survey = { site_id: 1, year: 2026, year_type: "CY", total_employees: 3, responses: [{ ref: "A1", mode: "Rail", one_way_km: 10, days_per_week: 5, weeks_per_year: 48 }] };
  assert.equal(ok(schemas.CommutingSurveyBodySchema, survey), true);
  assert.equal(ok(schemas.CommutingSurveyBodySchema, { ...survey, responses: [] }), false);
  assert.equal(ok(schemas.CommutingSurveyBodySchema, { ...survey, responses: [{ ...survey.responses[0], days_per_week: 8 }] }), false);

  assert.equal(ok(schemas.SoldProductsPlanBodySchema, { site_id: 1, year: 2026, year_type: "FY", ghg_category: 12 }), true);
  assert.equal(ok(schemas.SoldProductsPlanBodySchema, { site_id: 1, year: 2026, year_type: "FY", ghg_category: 9 }), false);
  assert.equal(ok(schemas.InvestmentsPlanBodySchema, { site_id: 1, year: 2026, year_type: "CY" }), true);
  assert.equal(ok(schemas.PutScreeningInputsBodySchema, { year: 2026, inputs: [{ ghg_category: 1, basis: "spend", amount: 1e6, currency: "USD" }] }), true);
  assert.equal(ok(schemas.BulkApproveBodySchema, { ids: [1, 2], only_ready: true }), true);
  assert.equal(ok(schemas.NothingThisMonthBodySchema, { site_id: 1, category_id: 2, month: "2026-09-01" }), true);
  assert.equal(schemas.EmissionHistoryQuerySchema.parse({}).months, 6);
  assert.equal(ok(schemas.RecalculationEventSchema, { company_id: 1, reason: "error", affected_years: [2023], delta_tco2e: -1, status: "maybe" }), false);

  const row = {
    n: 4, name: "Upstream transportation and distribution", direction: "upstream", status: "included", reason: null, method_note: null,
    tco2e: 5, share_pct: 100, methods: { distance_based: 100 }, primary_pct: 0, value_chain_pct: 0, proxy_pct: 0,
    dq: { overall: 2, good_pct: 0, fair_pct: 100, poor_pct: 0 }, datasets: [{ dataset: "DEFRA", version: "2025", factor_type: "life_cycle" }],
    gwp_sets: ["AR6"], biogenic_tco2e: null, mapped_categories: [{ category_id: 7, name: "Inbound freight" }],
  };
  assert.equal(ok(schemas.Scope3ReportRowSchema, row), true);
  assert.equal(ok(schemas.Scope3ReportRowSchema, { ...row, n: null, direction: null, status: null, name: "Unmapped" }), true);
  for (const t of schemas.SCOPE3_AUDIT_ENTITY_TYPES) assert.match(t, /^scope3_/);
});

test("emission.proxy: basis coverage, intensity or sample; coverage needs 1–99; from is the source row ids", () => {
  const ok = (p) => schemas.ProxySchema.safeParse(p).success;
  assert.equal(ok({ basis: "coverage", coverage_pct: 85, from: [1, 2] }), true);
  assert.equal(ok({ basis: "coverage", from: [1] }), false, "coverage without a share");
  assert.equal(ok({ basis: "coverage", coverage_pct: 100, from: [1] }), false, "coverage of 100 % is not a proxy");
  assert.equal(ok({ basis: "coverage", coverage_pct: 0.5, from: [1] }), false);
  assert.equal(ok({ basis: "intensity", from: [3] }), true, "intensity needs no share");
  assert.equal(ok({ basis: "sample", coverage_pct: 100, from: [] }), true, "a survey may reach everyone");
  assert.equal(ok({ basis: "floor_area", from: [] }), false);
  assert.equal(ok({ basis: "coverage", coverage_pct: 85, from: "known 850,000 kg" }), false);
  for (const b of schemas.PROXY_BASES) assert.match(schemas.PROXY_BASIS_LABELS[b], /^[A-Z][a-z]/, b);
});
