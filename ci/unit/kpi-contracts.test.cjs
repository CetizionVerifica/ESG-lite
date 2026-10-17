// KPI-0 contract tests: enums, error codes, check ids, labels and the zod
// schemas match docs/kpi/01-contracts.md. Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const enums = require(path.resolve("dist/kpi/contracts/enums.js"));
const errors = require(path.resolve("dist/kpi/contracts/errors.js"));
const checks = require(path.resolve("dist/kpi/contracts/checks.js"));
const labels = require(path.resolve("dist/kpi/contracts/labels.js"));
const schemas = require(path.resolve("dist/kpi/contracts/schemas.js"));

const ok = (schema, value) => schema.safeParse(value).success;

test("§1 enums hold exactly the contract values, in order", () => {
  assert.deepEqual([...enums.FRAMEWORK_CODES], ["GRI", "BRSR", "ESRS"]);
  assert.deepEqual([...enums.REQUIREMENT_LEVELS], ["required", "if_material", "voluntary", "core"]);
  assert.deepEqual([...enums.KPI_TOPICS], [
    "climate", "energy", "water", "waste", "pollution", "biodiversity", "materials", "workforce",
    "health_safety", "diversity", "training", "human_rights", "community", "customers", "governance", "ethics",
  ]);
  assert.deepEqual([...enums.KPI_VALUE_TYPES], ["number", "percent", "integer", "currency", "yes_no", "choice", "text"]);
  assert.deepEqual([...enums.KPI_SOURCES], ["manual", "auto", "formula"]);
  assert.deepEqual([...enums.KPI_AGGREGATIONS], ["sum", "average", "weighted_average", "max", "latest", "none"]);
  assert.deepEqual([...enums.KPI_LEVELS], ["site", "company"]);
  assert.deepEqual([...enums.KPI_FREQUENCIES], ["monthly", "quarterly", "annual"]);
  assert.deepEqual([...enums.KPI_VALUE_STATUSES], ["draft", "pending", "approved", "rejected"]);
  assert.deepEqual([...enums.MAPPING_FITS], ["exact", "partial", "derived"]);
  assert.deepEqual([...enums.AUTO_SOURCE_KEY_TEMPLATES], [
    "ghg_scope1", "ghg_scope2_location", "ghg_scope2_market", "ghg_scope3_total", "ghg_scope3_category_n",
    "energy_total", "energy_renewable", "energy_non_renewable", "production_output", "waste_total",
  ]);
  assert.deepEqual([...enums.UNIT_DIMENSIONS], ["energy", "mass", "volume", "count", "currency", "ratio", "time", "none"]);
  assert.deepEqual([...enums.KPI_AUDIT_ENTITY_TYPES], ["kpi_value", "kpi_setup", "kpi_period_lock", "kpi_target", "kpi_library"]);
});

test("auto source keys: the template expands to categories 1–15", () => {
  assert.ok(ok(enums.AutoSourceKeySchema, "ghg_scope1"));
  assert.ok(ok(enums.AutoSourceKeySchema, "ghg_scope3_category_1"));
  assert.ok(ok(enums.AutoSourceKeySchema, "ghg_scope3_category_15"));
  assert.ok(!ok(enums.AutoSourceKeySchema, "ghg_scope3_category_16"));
  assert.ok(!ok(enums.AutoSourceKeySchema, "ghg_scope3_category_n"));
  assert.equal(enums.AUTO_SOURCE_KEYS.length, 9 + 15);
});

test("§4 error codes and statuses match the contract", () => {
  const expected = {
    KPI_TRACKING_OFF: 403, KPI_SETUP_INCOMPLETE: 409, KPI_NOT_SELECTED: 422, KPI_NOT_ASSIGNED: 403,
    KPI_UNIT_NOT_ALLOWED: 422, KPI_VALUE_INVALID: 422, KPI_AUTO_READ_ONLY: 409, KPI_PERIOD_LOCKED: 409,
    KPI_PERIOD_INCOMPLETE: 422, KPI_NOT_DRAFT: 409, KPI_EVIDENCE_REQUIRED: 422, KPI_FORMULA_INVALID: 422,
    KPI_REASON_REQUIRED: 400,
  };
  for (const [code, status] of Object.entries(expected)) {
    assert.equal(errors.KPI_ERRORS[code]?.status, status, code);
    assert.ok(errors.KPI_ERRORS[code].message.length > 0);
  }
  // Plumbing codes are the only extras.
  const extras = errors.KPI_ERROR_CODES.filter((c) => !(c in expected));
  assert.deepEqual(extras.sort(), ["KPI_CODE_TAKEN", "KPI_COMPANY_REQUIRED", "KPI_FORBIDDEN", "KPI_NOT_FOUND", "KPI_VALIDATION"]);
});

test("KpiError carries code, status and details; the body never has a stack", () => {
  const err = new errors.KpiError("KPI_PERIOD_INCOMPLETE", { left: 3 });
  assert.equal(err.status, 422);
  assert.deepEqual(err.toBody(), { code: "KPI_PERIOD_INCOMPLETE", message: errors.KPI_ERRORS.KPI_PERIOD_INCOMPLETE.message, details: { left: 3 } });
  assert.deepEqual(Object.keys(new errors.KpiError("KPI_TRACKING_OFF").toBody()), ["code", "message"]);
  let sent;
  const res = { status(s) { sent = { s }; return this; }, json(b) { sent.b = b; return this; } };
  errors.sendKpiError(res, err);
  assert.equal(sent.s, 422);
  assert.equal(sent.b.code, "KPI_PERIOD_INCOMPLETE");
});

test("§5 check ids, rules and labels", () => {
  assert.deepEqual([...checks.KPI_CHECK_IDS], ["KPI_EVIDENCE", "KPI_CHANGE_LIMIT", "KPI_BREAKDOWN_SUM", "KPI_UNIT_CONVERTED", "KPI_ESTIMATE", "KPI_AUTO_STALE"]);
  for (const id of checks.KPI_CHECK_IDS) {
    assert.ok(checks.KPI_CHECK_RULES[id]);
    assert.ok(labels.CHECK_LABELS[id]);
  }
  assert.equal(checks.BREAKDOWN_TOLERANCE, 0.005);
  assert.ok(ok(checks.KpiValueChecksSchema, { ready: false, held: ["KPI_EVIDENCE"] }));
  assert.ok(!ok(checks.KpiValueChecksSchema, { ready: false, held: ["NOPE"] }));
});

test("every enum value has a label", () => {
  const pairs = [
    [enums.FRAMEWORK_CODES, labels.FRAMEWORK_LABELS],
    [enums.REQUIREMENT_LEVELS, labels.REQUIREMENT_LABELS],
    [enums.KPI_TOPICS, labels.TOPIC_LABELS],
    [enums.KPI_VALUE_TYPES, labels.VALUE_TYPE_LABELS],
    [enums.KPI_SOURCES, labels.SOURCE_LABELS],
    [enums.KPI_AGGREGATIONS, labels.AGGREGATION_LABELS],
    [enums.KPI_LEVELS, labels.LEVEL_LABELS],
    [enums.KPI_FREQUENCIES, labels.FREQUENCY_LABELS],
    [enums.KPI_VALUE_STATUSES, labels.STATUS_LABELS],
    [enums.MAPPING_FITS, labels.FIT_LABELS],
    [enums.UNIT_DIMENSIONS, labels.UNIT_DIMENSION_LABELS],
    [enums.YEAR_TYPES, labels.YEAR_TYPE_LABELS],
    [enums.ESRS_TOPICS, labels.ESRS_TOPIC_LABELS],
    [enums.TARGET_DIRECTIONS, labels.TARGET_DIRECTION_LABELS],
  ];
  for (const [values, table] of pairs) {
    for (const v of values) assert.ok(typeof table[v] === "string" && table[v].length > 0, `label for ${v}`);
    assert.equal(Object.keys(table).length, values.length);
  }
  assert.deepEqual(Object.values(labels.STATUS_LABELS), ["Draft", "Pending", "Approved", "Rejected"]);
});

const definition = {
  code: "WATER_WITHDRAWAL", name: "Water withdrawn", question: "How much water did the site take in?", topic: "water",
  value_type: "number", unit_dimension: "volume", canonical_unit: "kL", allowed_units: ["kL", "m3"], aggregation: "sum",
  level: "site", default_frequency: "monthly", source: "manual",
};

test("library schemas: definitions, frameworks, disclosures, mappings", () => {
  assert.ok(ok(schemas.KpiDefinitionCreateSchema, definition));
  assert.ok(!ok(schemas.KpiDefinitionCreateSchema, { ...definition, code: "water" }));
  assert.ok(!ok(schemas.KpiDefinitionCreateSchema, { ...definition, source: "auto" }), "auto needs auto_source");
  assert.ok(ok(schemas.KpiDefinitionCreateSchema, { ...definition, source: "auto", auto_source: "energy_total" }));
  assert.ok(!ok(schemas.KpiDefinitionCreateSchema, { ...definition, source: "formula" }), "formula needs formula");
  assert.ok(!ok(schemas.KpiDefinitionCreateSchema, { ...definition, formula: "A / B" }), "manual has no formula");
  assert.ok(ok(schemas.KpiDefinitionUpdateSchema, { question: "New question?" }));
  assert.ok(!("code" in schemas.KpiDefinitionUpdateSchema.parse({ code: "X_Y", question: "Q?" })));
  assert.ok(ok(schemas.KpiFrameworkCreateSchema, { code: "GRI", version: "GRI 2021+", name: "GRI Standards", source_url: "https://www.globalreporting.org/standards/" }));
  assert.ok(!ok(schemas.KpiFrameworkCreateSchema, { code: "ISSB", version: "1", name: "x", source_url: "https://x.org" }));
  assert.ok(ok(schemas.KpiDisclosureCreateSchema, { framework_id: 1, code: "303-3", title: "Water withdrawal", section: "GRI 303", requirement: "required", source_url: "https://x.org/a" }));
  assert.ok(!ok(schemas.KpiDisclosureCreateSchema, { framework_id: 1, code: "303-3", title: "t", section: "s", requirement: "required", source_url: "not a url" }));
  assert.ok(ok(schemas.KpiMappingCreateSchema, { disclosure_id: 1, kpi_definition_id: 2, fit: "exact" }));
  assert.ok(!ok(schemas.KpiMappingCreateSchema, { disclosure_id: 1, kpi_definition_id: 2, fit: "partial" }), "partial needs a note");
});

test("value schemas: items, ids, query", () => {
  const item = { kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-09-01", value_numeric: 1200, unit: "m3" };
  assert.ok(ok(schemas.KpiValueItemSchema, item));
  assert.ok(ok(schemas.KpiValueItemSchema, { ...item, kpi_code: undefined, kpi_definition_id: 4 }));
  assert.ok(!ok(schemas.KpiValueItemSchema, { ...item, kpi_code: undefined }), "names the KPI");
  assert.ok(!ok(schemas.KpiValueItemSchema, { ...item, period_start: "2026-02-30" }));
  assert.ok(!ok(schemas.KpiValueItemSchema, { ...item, site_id: undefined }), "site_id is explicit (null for company)");
  assert.ok(ok(schemas.KpiValueItemSchema, { ...item, breakdown: { groundwater: 700, surface: 500 } }));
  assert.ok(!ok(schemas.KpiValueItemSchema, { ...item, breakdown: { "Ground Water": 700 } }));
  assert.ok(ok(schemas.KpiValuesPutSchema, { items: [item] }));
  assert.ok(!ok(schemas.KpiValuesPutSchema, { items: [] }));
  assert.ok(ok(schemas.KpiIdsSchema, { ids: [1, 2] }));
  assert.ok(!ok(schemas.KpiIdsSchema, { ids: [0] }));
  assert.ok(ok(schemas.KpiValuesQuerySchema, { kpi: "ENERGY_TOTAL", site: "company", status: "draft", from: "2026-01-01" }));
  assert.equal(schemas.KpiValuesQuerySchema.parse({ kpi: "7", site: "2" }).kpi, 7);
  assert.ok(!ok(schemas.KpiValuesQuerySchema, { status: "done" }));
});

test("setup, review, lock and other module schemas", () => {
  assert.ok(ok(schemas.KpiSetupPutSchema, { settings: { year_type: "FY", due_day: 15 }, frameworks: [1, 2], material_topics: [{ esrs_topic: "E1", material: true }] }));
  assert.ok(!ok(schemas.KpiSetupPutSchema, { material_topics: [{ esrs_topic: "E3", material: false }] }), "not material needs a reason");
  assert.ok(ok(schemas.KpiReviewSchema, { ids: [1], only_ready: true }));
  assert.ok(ok(schemas.KpiPeriodLockBodySchema, { year: 2026, period: 9, site_id: 1 }));
  assert.ok(!ok(schemas.KpiPeriodLockBodySchema, { year: 2026, period: 13 }));
  assert.ok(ok(schemas.KpiTargetSchema, { kpi_definition_id: 1, baseline_year: 2024, baseline_value: 10, target_year: 2030, target_value: 5, direction: "reduce" }));
  assert.ok(ok(schemas.KpiDashboardQuerySchema, { year: "2026", framework: "BRSR" }));
  assert.ok(ok(schemas.KpiReportQuerySchema, { year: 2026, format: "xlsx", sites: "1,2" }));
  assert.ok(ok(schemas.CustomKpiCreateSchema, { ...definition, code: "OWN_KPI" }));
  assert.ok(!ok(schemas.CustomKpiCreateSchema, { ...definition, code: "OWN_KPI", source: "auto", auto_source: "ghg_scope1" }));
});
