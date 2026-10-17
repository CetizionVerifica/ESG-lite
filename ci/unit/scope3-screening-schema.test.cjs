// S3-12: the scope3_screening_input entity and its migration agree with the
// contract (ScreeningInputSchema, 01-contracts.md §4), and Emission.proxy is a
// nullable jsonb. Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
require("reflect-metadata");

const { getMetadataArgsStorage } = require("typeorm");
const { Scope3ScreeningInput } = require(path.resolve("dist/entities/Scope3ScreeningInput.js"));
const { Emission } = require(path.resolve("dist/entities/Emission.js"));
const schemas = require(path.resolve("dist/scope3/contracts/schemas.js"));
const { SCREENING_SCHEMA, YEAR_TYPE_COLUMN, YEAR_TYPE_FINISH, YEAR_TYPE_BACKFILL_SQL } = require(path.resolve("dist/scripts/migrateScope3Screening.js"));
const rules = require(path.resolve("dist/scope3/screening/rules.js"));
const boundary = require(path.resolve("dist/scope3/boundary/service.js"));

const columnsOf = (target) =>
  Object.fromEntries(getMetadataArgsStorage().columns.filter((c) => c.target === target).map((c) => [c.propertyName, c.options]));
const ok = (value) => schemas.ScreeningInputSchema.safeParse(value).success;
const base = { company_id: 1, year: 2026, ghg_category: 6, basis: "spend", amount: 120000, currency: "USD" };

test("scope3_screening_input columns carry the contract's limits", () => {
  const cols = columnsOf(Scope3ScreeningInput);
  assert.equal(cols.currency.length, 3);
  assert.equal(cols.eeio_sector.length, 100);
  assert.equal(cols.note.length, 2000);
  assert.equal(cols.basis.length, 20);
  for (const b of schemas.SCREENING_BASES) assert.ok(b.length <= cols.basis.length, b);
  for (const k of ["currency", "eeio_sector", "note", "updated_by"]) assert.equal(cols[k].nullable, true, k);
  for (const k of ["company_id", "year", "year_type", "ghg_category", "basis", "amount"]) assert.notEqual(cols[k].nullable, true, k);
  assert.equal(cols.year_type.length, 2);
  assert.equal(cols.year_type.default, "CY");
  const uq = getMetadataArgsStorage().indices.find((i) => i.target === Scope3ScreeningInput && i.unique);
  assert.deepEqual(uq.columns, ["company_id", "year", "year_type", "ghg_category", "basis"], "CY and FY of a year are separate rows");
  assert.equal(cols.amount.precision, 20);
  assert.equal(cols.amount.scale, 4);
});

test("the contract refuses what the columns can't hold", () => {
  assert.equal(ok(base), true);
  assert.equal(ok({ ...base, eeio_sector: "s".repeat(100), note: "n".repeat(2000) }), true);
  assert.equal(ok({ ...base, eeio_sector: "s".repeat(101) }), false);
  assert.equal(ok({ ...base, note: "n".repeat(2001) }), false);
  assert.equal(ok({ ...base, currency: "USDT" }), false);
  assert.equal(ok({ ...base, amount: -1 }), false);
  assert.equal(ok({ ...base, ghg_category: 0 }), false);
  assert.equal(ok({ ...base, ghg_category: 16 }), false);
  assert.equal(ok({ ...base, basis: "guess" }), false);
});

test("the migration creates the same table, checks and unique key as the entity", () => {
  const sql = SCREENING_SCHEMA.join("\n");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "proxy" jsonb/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "scope3_screening_input"/);
  assert.match(sql, /"currency" character varying\(3\)/);
  assert.match(sql, /"eeio_sector" character varying\(100\)/);
  assert.match(sql, /"note" character varying\(2000\)/);
  assert.match(sql, /"amount" numeric\(20,4\) NOT NULL/);
  assert.match(sql, /CHECK \("amount" >= 0\)/);
  assert.match(sql, /CHECK \("ghg_category" >= 1 AND "ghg_category" <= 15\)/);
  assert.doesNotMatch(sql, /UQ_scope3_screening_input_company_year_n_basis/, "the year-only key is never created again");
  for (const s of SCREENING_SCHEMA) assert.doesNotMatch(s, /\bDROP\b|\bRENAME\b|\bALTER COLUMN\b/i, "additive only");
});

test("year_type: added nullable, filled from the base year or CY, then default, NOT NULL, check and the new key", () => {
  assert.match(YEAR_TYPE_COLUMN, /ADD COLUMN IF NOT EXISTS "year_type" character varying\(2\)$/);
  const finish = YEAR_TYPE_FINISH.join("\n");
  assert.match(finish, /SET DEFAULT 'CY'/);
  assert.match(finish, /SET NOT NULL/);
  assert.match(finish, /CHECK \("year_type" IN \('CY', 'FY'\)\)/);
  assert.match(finish, /CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scope3_screening_input_company_year_type_n_basis" ON "scope3_screening_input" \("company_id", "year", "year_type", "ghg_category", "basis"\)/);
  // Only an index is dropped, after its replacement exists; no column, table or type change.
  assert.ok(finish.indexOf("CREATE UNIQUE INDEX") < finish.indexOf("DROP INDEX IF EXISTS"));
  for (const s of YEAR_TYPE_FINISH) assert.doesNotMatch(s, /DROP\s+(TABLE|COLUMN)|\bRENAME\b|\bTYPE\b/i);
  assert.match(YEAR_TYPE_BACKFILL_SQL(1000, true), /company_base_year[\s\S]*'CY'\)[\s\S]*year_type IS NULL[\s\S]*LIMIT 1000/);
  assert.doesNotMatch(YEAR_TYPE_BACKFILL_SQL(1000, false), /company_base_year/, "works before S3-14's table exists");
});

test("contracts: screening year_type defaults to CY; relevance keys and sector suggestions live in the contracts", () => {
  assert.equal(schemas.ScreeningQuerySchema.parse({ year: "2026" }).year_type, "CY");
  assert.equal(schemas.ScreeningQuerySchema.safeParse({ year: "2026", year_type: "QY" }).success, false);
  assert.equal(schemas.PutScreeningInputsBodySchema.parse({ year: 2026, inputs: [] }).year_type, "CY");
  assert.equal(schemas.PutScreeningInputsBodySchema.parse({ year: 2026, year_type: "FY", inputs: [] }).year_type, "FY");
  assert.equal(schemas.RELEVANCE_KEYS.length, 8, "Table II has 8 criteria");
  assert.equal(boundary.RELEVANCE_KEYS, schemas.RELEVANCE_KEYS, "the boundary validates against the contract's keys");
  assert.deepEqual(Object.keys(rules.RELEVANCE_LABELS).sort(), [...schemas.RELEVANCE_KEYS].sort());
  const line = { description: "Flights to Pune", amount: 1200, currency: "INR" };
  assert.equal(schemas.SectorSuggestionsBodySchema.safeParse(line).success, true);
  assert.equal(schemas.SectorSuggestionsBodySchema.safeParse({ ...line, description: " " }).success, false);
  assert.equal(schemas.SectorSuggestionsBodySchema.safeParse({ ...line, currency: "inr" }).success, false);
  assert.equal(schemas.SectorSuggestionsBodySchema.safeParse({ ...line, description: "d".repeat(501) }).success, false);
  assert.equal(schemas.SECTOR_CONFIRM_BELOW, 80);
  const answer = { available: true, suggestions: [{ code: "481000", name: "Air transportation (NAICS 481000)", confidence: 72, needs_confirmation: true }], confirm_below: 80 };
  assert.equal(schemas.SectorSuggestionsResponseSchema.safeParse(answer).success, true);
});

test("Emission.proxy is a nullable jsonb", () => {
  const proxy = columnsOf(Emission).proxy;
  assert.equal(proxy.type, "jsonb");
  assert.equal(proxy.nullable, true);
});
