// IM0 contract tests: the import row schema, limits, error codes and the
// batch-committed hook. Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const contracts = require(path.resolve("dist/imports/contracts.js"));
const errors = require(path.resolve("dist/imports/errors.js"));
const { IMPORT_LIMITS, PLAN_EXPIRY_MS } = require(path.resolve("dist/imports/limits.js"));
const writer = require(path.resolve("dist/imports/writer.js"));

const { ImportRowSchema, ImportRowsSchema, parseImportRows, ToolInputs, TOOL_NAMES, READ_ONLY_TOOLS } = contracts;

const monthlyRow = (over = {}) => ({
  row_ref: "Fuel 2025!B14",
  site_id: 1,
  category_id: 3,
  period: { kind: "monthly", date: "2025-03-15" },
  activity_name: "HSD",
  activity_value: 120.5,
  activity_unit: "L",
  ...over,
});

test("accepts a monthly row and a yearly row (CY and FY)", () => {
  assert.equal(ImportRowSchema.safeParse(monthlyRow()).success, true);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ period: { kind: "yearly", year_type: "CY", year: 2025 } })).success, true);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ period: { kind: "yearly", year_type: "FY", year: 2026 } })).success, true);
});

test("rejects bad periods", () => {
  for (const period of [
    { kind: "monthly", date: "2025-13-01" },
    { kind: "monthly", date: "2025-02-30" },
    { kind: "monthly", date: "15/03/2025" },
    { kind: "yearly", year_type: "XY", year: 2025 },
    { kind: "yearly", year_type: "CY", year: 1999 },
    { kind: "weekly", date: "2025-03-15" },
    { kind: "yearly", year: 2025 },
  ]) {
    assert.equal(ImportRowSchema.safeParse(monthlyRow({ period })).success, false, JSON.stringify(period));
  }
});

test("a value is required unless fields are given", () => {
  const noValue = monthlyRow();
  delete noValue.activity_value;
  assert.equal(ImportRowSchema.safeParse(noValue).success, false);
  assert.equal(ImportRowSchema.safeParse({ ...noValue, fields: {} }).success, false);
  assert.equal(ImportRowSchema.safeParse({ ...noValue, fields: { distance_km: 120, vehicle_type: "Truck" } }).success, true);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ activity_value: "120" })).success, false, "strings are not numbers");
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ activity_value: Infinity })).success, false);
});

test("required text and ids", () => {
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ row_ref: "  " })).success, false);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ activity_name: "" })).success, false);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ activity_unit: "" })).success, false);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ site_id: 0 })).success, false);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ site_id: "1" })).success, false, "names or strings are not ids");
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ category_id: 1.5 })).success, false);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ row_ref: "x".repeat(IMPORT_LIMITS.ROW_REF_MAX_CHARS + 1) })).success, false);
});

test("notes are capped at the limit", () => {
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ notes: "n".repeat(IMPORT_LIMITS.NOTES_MAX_CHARS) })).success, true);
  assert.equal(ImportRowSchema.safeParse(monthlyRow({ notes: "n".repeat(IMPORT_LIMITS.NOTES_MAX_CHARS + 1) })).success, false);
});

test("total-like keys are stripped, not rejected, and reported per row", () => {
  const raw = [
    monthlyRow({ total_emission: 999, factor: 2.68, unit: "tCO2e" }),
    monthlyRow({ row_ref: "Fuel 2025!B15" }),
    monthlyRow({ row_ref: "Fuel 2025!B16", total_tco2e: 1 }),
  ];
  const parsed = parseImportRows(raw);
  assert.equal(parsed.rows.length, 3);
  for (const row of parsed.rows) {
    for (const key of contracts.TOTAL_LIKE_KEYS) assert.equal(key in row, false, key);
  }
  assert.deepEqual(parsed.stripped, [
    { row_ref: "Fuel 2025!B14", keys: ["total_emission", "factor", "unit"] },
    { row_ref: "Fuel 2025!B16", keys: ["total_tco2e"] },
  ]);
  assert.deepEqual(parsed.duplicate_row_refs, []);
  // activity_unit (the input unit) is kept; only the result unit key is dropped
  assert.equal(parsed.rows[0].activity_unit, "L");
});

test("duplicate row_refs are listed and invalid rows throw", () => {
  const parsed = parseImportRows([monthlyRow(), monthlyRow(), monthlyRow({ row_ref: "other" })]);
  assert.deepEqual(parsed.duplicate_row_refs, ["Fuel 2025!B14"]);
  assert.throws(() => parseImportRows([monthlyRow({ site_id: -1 })]));
  assert.throws(() => parseImportRows([]));
  assert.throws(() => parseImportRows("rows"));
});

test("rows per request is enforced", () => {
  const rows = Array.from({ length: IMPORT_LIMITS.ROWS_PER_REQUEST + 1 }, (_, i) => monthlyRow({ row_ref: `r${i}` }));
  assert.equal(ImportRowsSchema.safeParse(rows).success, false);
  assert.equal(ImportRowsSchema.safeParse(rows.slice(0, IMPORT_LIMITS.ROWS_PER_REQUEST)).success, true);
});

test("limits are the agreed constants", () => {
  assert.equal(IMPORT_LIMITS.ROWS_PER_REQUEST, 2000);
  assert.equal(IMPORT_LIMITS.ROWS_PER_PLAN, 20000);
  assert.equal(IMPORT_LIMITS.DRAFT_PLANS_PER_USER, 10);
  assert.equal(IMPORT_LIMITS.PLAN_EXPIRY_HOURS, 24);
  assert.equal(IMPORT_LIMITS.MAX_PAGE_SIZE, 200);
  assert.equal(IMPORT_LIMITS.NOTES_MAX_CHARS, 500);
  assert.equal(PLAN_EXPIRY_MS, 24 * 60 * 60 * 1000);
});

test("every API error code has a status and a message, matching the contract", () => {
  const expected = {
    IMPORT_PLAN_NOT_FOUND: 404,
    IMPORT_PLAN_EXPIRED: 410,
    IMPORT_PLAN_NOT_DRAFT: 409,
    IMPORT_PLAN_VERSION_CONFLICT: 409,
    IMPORT_PLAN_HAS_ISSUES: 422,
    IMPORT_TOO_MANY_ROWS: 413,
    IMPORT_TOO_MANY_PLANS: 429,
    IMPORT_DUPLICATE_ROW_REF: 422,
    IMPORT_COMPANY_REQUIRED: 400,
    MCP_SUPERADMIN_ONLY: 403,
    IMPORT_FORBIDDEN: 403,
    MCP_DISABLED_FOR_CLIENT: 403,
    CLIENT_INACTIVE: 403,
  };
  for (const [code, status] of Object.entries(expected)) {
    assert.equal(errors.IMPORT_ERRORS[code].status, status, code);
    assert.ok(errors.IMPORT_ERRORS[code].message.length > 0, code);
  }
  for (const code of errors.IMPORT_ERROR_CODES) {
    assert.ok(Number.isInteger(errors.IMPORT_ERRORS[code].status), code);
  }
});

test("ImportError and importError produce { code, message, details? }", () => {
  const err = new errors.ImportError("IMPORT_PLAN_VERSION_CONFLICT", { version: 3 });
  assert.equal(err.status, 409);
  assert.deepEqual(err.toBody(), { code: "IMPORT_PLAN_VERSION_CONFLICT", message: errors.IMPORT_ERRORS.IMPORT_PLAN_VERSION_CONFLICT.message, details: { version: 3 } });
  assert.equal(errors.isImportError(err), true);
  assert.equal(errors.isImportError(new Error("x")), false);

  let sent;
  const res = { status(s) { this.s = s; return this; }, json(b) { sent = { status: this.s, body: b }; return this; } };
  errors.importError(res, "MCP_DISABLED_FOR_CLIENT");
  assert.equal(sent.status, 403);
  assert.deepEqual(sent.body, { code: "MCP_DISABLED_FOR_CLIENT", message: errors.IMPORT_ERRORS.MCP_DISABLED_FOR_CLIENT.message });
});

test("row issue codes carry the contract's severity", () => {
  assert.equal(errors.ROW_ISSUE_CODES.DUPLICATE_IN_PLAN, "warning");
  assert.equal(errors.ROW_ISSUE_CODES.FACTOR_FALLBACK_YEAR, "warning");
  assert.equal(errors.ROW_ISSUE_CODES.CLIENT_TOTAL_IGNORED, "warning");
  assert.equal(errors.ROW_ISSUE_CODES.DISTANCE_REQUIRED, "error");
  assert.equal(errors.ROW_ISSUE_CODE_LIST.length, 22); // 17 IM0 codes + 3 XI0 codes + 2 S3-4 codes
  assert.equal(errors.ROW_ISSUE_CODES.UNIT_REQUIRED, "error");
  assert.equal(errors.ROW_ISSUE_CODES.FERA_FACTOR_MISSING, "warning");
  assert.equal(contracts.RowIssueCodeSchema.safeParse("NOT_A_CODE").success, false);
  assert.equal(contracts.RowIssueSchema.safeParse({ code: "UNKNOWN_ACTIVITY", severity: "error", message: "No match" }).success, true);
});

test("request bodies: patch needs a change, commit needs its key, append needs a version", () => {
  assert.equal(contracts.PatchPlanBodySchema.safeParse({ version: 1 }).success, false);
  assert.equal(contracts.PatchPlanBodySchema.safeParse({ version: 1, changes: [{ row_ref: "a" }] }).success, false);
  assert.equal(contracts.PatchPlanBodySchema.safeParse({ version: 1, changes: [{ row_ref: "a", skip: true }] }).success, true);
  assert.equal(contracts.PatchPlanBodySchema.safeParse({ version: 1, changes: [{ row_ref: "a", set: { activity_value: 5 } }] }).success, true);
  assert.equal(contracts.PatchPlanBodySchema.safeParse({ version: 1, changes: [{ row_ref: "a", set: { row_ref: "b" } }] }).success, true, "row_ref in set is stripped");
  assert.equal(contracts.PatchPlanBodySchema.parse({ version: 1, changes: [{ row_ref: "a", set: { row_ref: "b" } }] }).changes[0].set.row_ref, undefined);
  assert.equal(
    contracts.PatchPlanBodySchema.safeParse({ version: 1, activity_matches: [{ site_id: 1, category_id: 2, sheet_name: "HSD", factor_name: "Diesel" }] }).success,
    true,
  );
  assert.equal(contracts.CommitPlanBodySchema.safeParse({ version: 1, skip_rows_with_issues: false }).success, false);
  assert.equal(contracts.CommitPlanBodySchema.safeParse({ version: 1, skip_rows_with_issues: false, idempotency_key: "k1" }).success, true);
  assert.equal(contracts.AppendRowsBodySchema.safeParse({ rows: [monthlyRow()] }).success, false);
  assert.equal(contracts.CreatePlanBodySchema.safeParse({ source_name: "Plant 2.xlsx", channel: "mcp", rows: [monthlyRow()] }).success, true);
  assert.equal(contracts.CreatePlanBodySchema.safeParse({ source_name: "Plant 2.xlsx", channel: "email", rows: [monthlyRow()] }).success, false);
  assert.equal(contracts.GetPlanQuerySchema.parse({ page: "2", page_size: "50" }).page, 2);
  assert.equal(contracts.GetPlanQuerySchema.safeParse({ page_size: String(IMPORT_LIMITS.MAX_PAGE_SIZE + 1) }).success, false);
});

test("tool inputs: the eleven tools of the contract, with the right read-only set", () => {
  assert.deepEqual(TOOL_NAMES, [
    "whoami",
    "list_sites_and_categories",
    "get_category_form",
    "find_activity",
    "check_readiness",
    "plan_import",
    "get_import_plan",
    "update_import_plan",
    "commit_import",
    "cancel_import_plan",
    "list_upload_batches",
  ]);
  for (const name of ["approve", "reject", "delete_emission", "update_emission"]) assert.equal(name in ToolInputs, false, name);
  assert.deepEqual([...READ_ONLY_TOOLS].sort(), ["check_readiness", "find_activity", "get_category_form", "get_import_plan", "list_sites_and_categories", "list_upload_batches", "whoami"]);

  const planId = "3f4a1b2c-9d8e-4f7a-b6c5-d4e3f2a1b0c9";
  assert.equal(ToolInputs.commit_import.safeParse({ plan_id: planId, version: 2, skip_rows_with_issues: false, confirm: true }).success, true);
  assert.equal(ToolInputs.commit_import.safeParse({ plan_id: planId, version: 2, skip_rows_with_issues: false, confirm: false }).success, false, "confirm must be true");
  assert.equal(ToolInputs.commit_import.safeParse({ plan_id: planId, version: 2, skip_rows_with_issues: false }).success, false);
  assert.equal(ToolInputs.plan_import.safeParse({ company_id: 1, source_name: "x.xlsx", rows: [monthlyRow()] }).success, true);
  assert.equal(ToolInputs.plan_import.safeParse({ source_name: "x.xlsx", rows: [monthlyRow()] }).success, false, "company_id is required");
  assert.equal(ToolInputs.list_sites_and_categories.safeParse({}).success, false, "company_id is required");
  assert.equal(ToolInputs.whoami.safeParse({}).success, true);
});

test("batch-committed hook calls every listener and survives a failing one", async () => {
  writer.clearBatchCommittedListeners();
  const seen = [];
  const off = writer.onBatchCommitted((e) => { seen.push(`a:${e.upload_batch_id}`); });
  writer.onBatchCommitted(async () => { throw new Error("listener broke"); });
  writer.onBatchCommitted(async (e) => { seen.push(`c:${e.upload_batch_id}`); });
  const errs = [];
  const origError = console.error;
  console.error = (...args) => errs.push(args.join(" "));
  try {
    await writer.emitBatchCommitted({ upload_batch_id: "b1", company_id: 1, created_by: 1, channel: "mcp", source_name: "x", site_ids: [1], rows: 2, tco2e: 1.5, months: ["2025-03"] });
  } finally {
    console.error = origError;
  }
  assert.deepEqual(seen, ["a:b1", "c:b1"]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /listener broke/);
  off();
  await writer.emitBatchCommitted({ upload_batch_id: "b2", company_id: 1, created_by: 1, channel: "api", source_name: "x", site_ids: [], rows: 0, tco2e: 0, months: [] });
  assert.deepEqual(seen, ["a:b1", "c:b1", "c:b2"]);
  writer.clearBatchCommittedListeners();
});
