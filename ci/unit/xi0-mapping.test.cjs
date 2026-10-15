// XI0 contract tests: mapping proposal and profile schemas, ImportRow.meta,
// the new row issue codes, limits and the ai_import switch error. Runs
// against the compiled build (npm run build && npm run test:unit). The JSON
// fixtures are shared with python_AI_service (ci/fixtures/xi0).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const mapping = require(path.resolve("dist/imports/mapping.js"));
const contracts = require(path.resolve("dist/imports/contracts.js"));
const errors = require(path.resolve("dist/imports/errors.js"));
const { IMPORT_LIMITS } = require(path.resolve("dist/imports/limits.js"));
const { AI_IMPORT_STATEMENTS } = require(path.resolve("dist/scripts/addAiImportColumns.js"));

const fixture = (name) => JSON.parse(fs.readFileSync(path.resolve("ci/fixtures/xi0", name), "utf8"));

// sha256 of each shared fixture. python_AI_service/ci/tests/test_mapping_contracts.py
// pins the same values, so the two copies cannot drift apart silently.
// Update both when a fixture changes on purpose.
const FIXTURE_SHA256 = {
  "profile-valid.json": "d46cff40ae067d8345351ae493d9bc480662ba8d2a177b9a34daf2ff8a0e4b37",
  "proposal-bad-fingerprint.json": "4d5cbbc0f82642ab5945a0d4532011e487be08f3288bcc22f6f996dc97682805",
  "proposal-confidence-over-1.json": "b156638fe1d1af27ff29a4e97f1951b66cff6b7ea3d0c5d84f11e2d568fc93ff",
  "proposal-other-site.json": "55986fef5e9685393ddf2fbcfdb36a55e4d3b24025efb74ce2063392a9a6f85c",
  "proposal-valid.json": "0635d17429adcd9276527cbc83c9be1beadf97ef4b2322e336a11f16e2b54a95",
  "row-with-meta.json": "50de2a7136e885fd8e38cda815d07d43d2a1b32e244e9d52cff1f9f2c7d47c48",
};

test("the shared fixtures are byte-identical to the python_AI_service copies (pinned sha256)", () => {
  const dir = path.resolve("ci/fixtures/xi0");
  const present = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(present, Object.keys(FIXTURE_SHA256).sort());
  for (const [name, sha] of Object.entries(FIXTURE_SHA256)) {
    const actual = require("crypto").createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
    assert.equal(actual, sha, `${name} changed; update the pin here and in python_AI_service`);
  }
});

test("the valid proposal fixture parses and keeps every sheet for the chosen site", () => {
  const r = mapping.MappingProposalSchema.safeParse(fixture("proposal-valid.json"));
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  assert.equal(r.data.sheets.length, 2);
  assert.ok(r.data.sheets.every((s) => s.site_id === r.data.site_id));
  assert.deepEqual(r.data.sheets[0].not_in_context, ["Plant 9"]);
  assert.equal(r.data.sheets[0].site_column.values.filter((v) => !v.matches_site).length, 1);
});

test("a sheet for another site, a bad fingerprint and a confidence over 1 are refused", () => {
  for (const name of ["proposal-other-site.json", "proposal-bad-fingerprint.json", "proposal-confidence-over-1.json"]) {
    assert.equal(mapping.MappingProposalSchema.safeParse(fixture(name)).success, false, name);
  }
});

test("defaults: site_column null, not_in_context [], excluded false, save_mapping false, skipped false", () => {
  const p = fixture("proposal-valid.json");
  const sheet = { ...p.sheets[0] };
  delete sheet.site_column; delete sheet.not_in_context; delete sheet.excluded;
  sheet.activities = sheet.activities.map(({ save_mapping, ...a }) => a);
  sheet.fields = sheet.fields.map(({ skipped, ...f }) => f);
  const r = mapping.SheetProposalSchema.parse(sheet);
  assert.equal(r.site_column, null);
  assert.deepEqual(r.not_in_context, []);
  assert.equal(r.excluded, false);
  assert.ok(r.activities.every((a) => a.save_mapping === false));
  assert.ok(r.fields.every((f) => f.skipped === false));
});

test("every period kind parses and an unknown one does not", () => {
  const ok = [
    { kind: "column", column: "Month" },
    { kind: "monthly_fixed", date: "2025-03-31" },
    { kind: "yearly", year_type: "FY", year: 2026 },
    { kind: "months_as_columns", columns: [{ column: "Jan", date: "2025-01-31" }] },
  ];
  for (const p of ok) assert.equal(mapping.SheetPeriodSchema.safeParse(p).success, true, p.kind);
  assert.equal(mapping.SheetPeriodSchema.safeParse({ kind: "weekly", column: "Week" }).success, false);
  assert.equal(mapping.SheetPeriodSchema.safeParse({ kind: "months_as_columns", columns: [] }).success, false);
});

test("unknown keys are stripped from a proposal and a sheet", () => {
  const p = fixture("proposal-valid.json");
  p.total_tco2e = 999;
  p.sheets[0].factor = 2.68;
  const r = mapping.MappingProposalSchema.parse(p);
  assert.equal("total_tco2e" in r, false);
  assert.equal("factor" in r.sheets[0], false);
});

test("a workbook over the sheet limit is refused", () => {
  const p = fixture("proposal-valid.json");
  const one = p.sheets[0];
  p.sheets = Array.from({ length: IMPORT_LIMITS.MAPPING_SHEETS_PER_WORKBOOK + 1 }, (_, i) => ({ ...one, sheet_name: `S${i}` }));
  assert.equal(mapping.MappingProposalSchema.safeParse(p).success, false);
});

test("the profile fixture parses and its query schema coerces ids", () => {
  assert.equal(mapping.MappingProfileSchema.safeParse(fixture("profile-valid.json")).success, true);
  const q = mapping.ListMappingProfilesQuerySchema.parse({ fingerprint: fixture("profile-valid.json").fingerprint, site_id: "2" });
  assert.equal(q.site_id, 2);
  assert.equal(mapping.ListMappingProfilesQuerySchema.safeParse({ fingerprint: "x", site_id: "2" }).success, false);
  assert.equal(mapping.ListMappingProfilesQuerySchema.safeParse({ fingerprint: fixture("profile-valid.json").fingerprint }).success, false);
});

test("ImportRow accepts meta, strips unknown meta keys and refuses a bad source", () => {
  const row = fixture("row-with-meta.json");
  const r = contracts.ImportRowSchema.parse(row);
  assert.deepEqual(r.meta, { source: "llm", confidence: 0.92 });
  const r2 = contracts.ImportRowSchema.parse({ ...row, meta: { ...row.meta, prompt: "secret" } });
  assert.equal("prompt" in r2.meta, false);
  assert.equal(contracts.ImportRowSchema.safeParse({ ...row, meta: { source: "guess", confidence: 0.5 } }).success, false);
  assert.equal(contracts.ImportRowSchema.safeParse({ ...row, meta: { source: "llm", confidence: 2 } }).success, false);
  const { meta, ...plain } = row;
  assert.equal(contracts.ImportRowSchema.parse(plain).meta, undefined);
});

test("CreatePlanBody accepts an optional mapping; the plans controller's schema validates it as a MappingProposal", () => {
  const body = { source_name: "fuel.xlsx", channel: "bulk_upload", rows: [fixture("row-with-meta.json")], mapping: fixture("proposal-valid.json") };
  assert.equal(contracts.CreatePlanBodySchema.safeParse(body).success, true);
  assert.equal(mapping.CreatePlanWithMappingBodySchema.safeParse(body).success, true);
  for (const bad of ["proposal-other-site.json", "proposal-bad-fingerprint.json"]) {
    const r = mapping.CreatePlanWithMappingBodySchema.safeParse({ ...body, mapping: fixture(bad) });
    assert.equal(r.success, false, bad);
    assert.equal(r.error.issues[0].path[0], "mapping");
  }
  assert.equal(mapping.CreatePlanWithMappingBodySchema.safeParse({ ...body, mapping: "yes" }).success, false);
  delete body.mapping;
  assert.equal(mapping.CreatePlanWithMappingBodySchema.safeParse(body).success, true);
});

test("new row issue codes have severities, info included; SITE_NOT_ALLOWED is reused for other-site rows", () => {
  assert.equal(errors.ROW_ISSUE_CODES.NOT_IN_CONTEXT, "error");
  assert.equal(errors.ROW_ISSUE_CODES.LOW_CONFIDENCE_MATCH, "warning");
  assert.equal(errors.ROW_ISSUE_CODES.PIVOT_EMPTY_CELL, "info");
  assert.equal(errors.ROW_ISSUE_CODES.SITE_NOT_ALLOWED, "error");
  assert.equal("SITE_OUT_OF_SCOPE" in errors.ROW_ISSUE_CODES, false);
  assert.equal(contracts.RowIssueSchema.safeParse({ code: "PIVOT_EMPTY_CELL", severity: "info", message: "blank" }).success, true);
});

test("AI_IMPORT_DISABLED_FOR_CLIENT is a 403 and the switch limits exist", () => {
  assert.equal(errors.IMPORT_ERRORS.AI_IMPORT_DISABLED_FOR_CLIENT.status, 403);
  assert.equal(IMPORT_LIMITS.MAPPING_CONFIRM_BELOW, 0.8);
  assert.equal(mapping.needsConfirmation(0.79), true);
  assert.equal(mapping.needsConfirmation(0.8), false);
  assert.equal(IMPORT_LIMITS.MAPPING_SHEETS_PER_WORKBOOK, 20);
  assert.equal(IMPORT_LIMITS.MAPPING_SAMPLE_ROWS_PER_SHEET, 15);
});

test("the migration is additive and idempotent SQL only", () => {
  assert.equal(AI_IMPORT_STATEMENTS.length, 2);
  for (const sql of AI_IMPORT_STATEMENTS) {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
    assert.doesNotMatch(sql, /DROP|RENAME|ALTER COLUMN/i);
  }
});
