// S3-15 review checks: computeChecks is pure. Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { computeChecks, monthChangePct, DEFAULT_THRESHOLD_PCT } = require(path.resolve("dist/scope3/review/checks.js"));
const { CHECK_IDS } = require(path.resolve("dist/scope3/contracts/checks.js"));

const row = (over = {}) => ({
  date_of_reporting: "2026-03-31",
  reporting_period: "monthly",
  activity_data_unit: "litre",
  emission_factor_snapshot: { year: 2025, denominator_unit: "litre" },
  ...over,
});
const ctx = (over = {}) => ({
  hasEvidence: true,
  duplicateOf: null,
  thresholdPct: DEFAULT_THRESHOLD_PCT,
  monthTotal: 10,
  previousMonthTotal: 10,
  importNeedsAttention: false,
  ...over,
});

test("a clean row is ready with nothing held", () => {
  assert.deepEqual(computeChecks(row(), ctx()), { ready: true, held: [] });
});

test("check ids are the contract's §8 list, in order", () => {
  assert.deepEqual([...CHECK_IDS], ["FACTOR_FOUND", "UNIT_OK", "EVIDENCE_ATTACHED", "WITHIN_THRESHOLD", "NO_DUPLICATE", "IMPORT_MATCH_SURE", "METHOD_GIVEN", "DQ_ACCEPTABLE"]);
});

test("FACTOR_FOUND: no factor, or a fallback year, holds the row", () => {
  assert.deepEqual(computeChecks(row({ emission_factor_snapshot: null }), ctx()).held, ["FACTOR_FOUND"]);
  assert.deepEqual(computeChecks(row({ emission_factor_snapshot: { year: 2024, denominator_unit: "litre" } }), ctx()).held, ["FACTOR_FOUND"]);
  assert.equal(computeChecks(row({ date_of_reporting: "2026-01-15" }), ctx()).ready, true, "target year is the reporting year - 1");
});

test("UNIT_OK: a missing or unconvertible unit holds; aliases and conversions pass", () => {
  assert.deepEqual(computeChecks(row({ activity_data_unit: null }), ctx()).held, ["UNIT_OK"]);
  assert.deepEqual(computeChecks(row({ activity_data_unit: "  " }), ctx()).held, ["UNIT_OK"]);
  assert.deepEqual(computeChecks(row({ activity_data_unit: "kWh" }), ctx()).held, ["UNIT_OK"]);
  assert.equal(computeChecks(row({ activity_data_unit: "kg", emission_factor_snapshot: { year: 2025, denominator_unit: "tonne" } }), ctx()).ready, true);
  assert.deepEqual(computeChecks(row({ emission_factor_snapshot: null }), ctx()).held, ["FACTOR_FOUND"], "without a factor only presence counts");
});

test("EVIDENCE_ATTACHED, NO_DUPLICATE and IMPORT_MATCH_SURE read the context", () => {
  assert.deepEqual(computeChecks(row(), ctx({ hasEvidence: false })).held, ["EVIDENCE_ATTACHED"]);
  assert.deepEqual(computeChecks(row(), ctx({ duplicateOf: 12 })).held, ["NO_DUPLICATE"]);
  assert.deepEqual(computeChecks(row(), ctx({ importNeedsAttention: true })).held, ["IMPORT_MATCH_SURE"]);
});

test("WITHIN_THRESHOLD compares the month with the previous one against the company limit", () => {
  assert.deepEqual(computeChecks(row(), ctx({ monthTotal: 10.6, previousMonthTotal: 10 })).held, ["WITHIN_THRESHOLD"], "6 % > 5 %");
  assert.deepEqual(computeChecks(row(), ctx({ monthTotal: 9.3, previousMonthTotal: 10 })).held, ["WITHIN_THRESHOLD"], "drops count too");
  assert.equal(computeChecks(row(), ctx({ monthTotal: 10.5, previousMonthTotal: 10 })).ready, true, "exactly the limit passes");
  assert.equal(computeChecks(row(), ctx({ monthTotal: 12, previousMonthTotal: 10, thresholdPct: 25 })).ready, true, "company limit wins");
  assert.equal(computeChecks(row(), ctx({ previousMonthTotal: null })).ready, true, "no previous month passes");
  assert.equal(computeChecks(row(), ctx({ previousMonthTotal: 0, monthTotal: 50 })).ready, true, "a zero previous month has nothing to compare");
  assert.equal(computeChecks(row({ reporting_period: "yearly" }), ctx({ monthTotal: 99, previousMonthTotal: 1 })).ready, true, "yearly rows pass");
  assert.equal(monthChangePct(15, 10), 50);
  assert.equal(monthChangePct(15, null), null);
});

test("METHOD_GIVEN and DQ_ACCEPTABLE pass until S3-3 fields exist; several holds are listed in id order", () => {
  const all = computeChecks(row({ emission_factor_snapshot: null, activity_data_unit: null }), ctx({ hasEvidence: false, duplicateOf: 3, importNeedsAttention: true, monthTotal: 50 }));
  assert.equal(all.ready, false);
  assert.deepEqual(all.held, ["FACTOR_FOUND", "UNIT_OK", "EVIDENCE_ATTACHED", "WITHIN_THRESHOLD", "NO_DUPLICATE", "IMPORT_MATCH_SURE"]);
});
