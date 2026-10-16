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
const { SCREENING_SCHEMA } = require(path.resolve("dist/scripts/migrateScope3Screening.js"));

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
  for (const k of ["company_id", "year", "ghg_category", "basis", "amount"]) assert.notEqual(cols[k].nullable, true, k);
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
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scope3_screening_input_company_year_n_basis" ON "scope3_screening_input" \("company_id", "year", "ghg_category", "basis"\)/);
  for (const s of SCREENING_SCHEMA) assert.doesNotMatch(s, /\bDROP\b|\bRENAME\b|\bALTER COLUMN\b/i, "additive only");
});

test("Emission.proxy is a nullable jsonb", () => {
  const proxy = columnsOf(Emission).proxy;
  assert.equal(proxy.type, "jsonb");
  assert.equal(proxy.nullable, true);
});
