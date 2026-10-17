// S3-12 screening suggestions (src/scope3/screening/rules.ts): top 95 % or a
// Table II tick → included; below 1 % with no tick → excluded with the spec's
// reason; nothing at all → not relevant; an input without a size → screening.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const rules = require(path.resolve("dist/scope3/screening/rules.js"));

const row = (n, size, over = {}) => ({ n, size_tco2e: size, size_basis: size === null ? null : "spend", has_input: size !== null, has_rows: false, ticks: [], ...over });

test("thresholds are the spec's constants", () => {
  assert.equal(rules.TOP_SHARE_PCT, 95);
  assert.equal(rules.BELOW_SHARE_PCT, 1);
  assert.equal(Object.keys(rules.RELEVANCE_LABELS).length, 8, "Table II has 8 criteria");
});

test("categories making up the top 95 % are included; the rest below 1 % are excluded with the spec's reason", () => {
  // 1,000 t total: 700 + 200 + 60 = 96 % (the third crosses 95 %), then 30 t (3 %), 9 t (0.9 %), 1 t (0.1 %).
  const rows = [row(1, 700), row(4, 200), row(6, 60), row(5, 30), row(7, 9), row(12, 1)];
  const s = rules.suggest(rows, 2026);
  assert.equal(s.get(1).status, "included");
  assert.equal(s.get(4).status, "included");
  assert.equal(s.get(6).status, "included", "the category that crosses 95 % is inside the top set");
  assert.equal(s.get(5).status, "included", "3 % is outside the top 95 % but not below 1 %");
  assert.match(s.get(5).reason, /^Estimated at 3 % of Scope 3/);
  assert.equal(s.get(7).status, "excluded");
  assert.equal(s.get(7).reason, "Estimated below 1 % of Scope 3 (≈ 9 tCO₂e by spend screening, 2026)");
  assert.equal(s.get(12).reason, "Estimated below 1 % of Scope 3 (≈ 1 tCO₂e by spend screening, 2026)");
  assert.match(s.get(1).reason, /^Among the categories that make up 95 % of estimated Scope 3 \(≈ 700 tCO₂e, 70 %\)$/);
});

test("a Table II tick includes the category whatever its size", () => {
  const s = rules.suggest([row(1, 1000), row(6, 0.5, { ticks: ["stakeholders", "risk"] })], 2026);
  assert.equal(s.get(6).status, "included");
  assert.equal(s.get(6).reason, "Relevant: stakeholders, risk");
  const unknownTick = rules.suggest([row(1, 1000), row(6, 0.5, { ticks: ["made_up"] })], 2026);
  assert.equal(unknownTick.get(6).status, "excluded", "only Table II keys count");
});

test("no input, no rows and no tick → not relevant; an input with no estimate → keep screening", () => {
  const s = rules.suggest([row(1, 100), row(9, null, { has_input: false }), row(10, null, { has_input: true })], 2027);
  assert.deepEqual(s.get(9), { status: "not_relevant", reason: "No activity in this category in 2027" });
  assert.equal(s.get(10).status, "screening");
});

test("basis words follow where the size came from", () => {
  const s = rules.suggest([row(1, 10000), row(7, 20, { size_basis: "headcount" }), row(3, 5, { size_basis: "recorded", has_input: false, has_rows: true })], 2026);
  assert.match(s.get(7).reason, /by headcount screening, 2026\)$/);
  assert.match(s.get(3).reason, /from recorded data, 2026\)$/);
});

test("shares: per category %, zero and unknown sizes are left out", () => {
  const { total, share, top } = rules.shares([row(1, 75), row(2, 25), row(3, 0), row(4, null)]);
  assert.equal(total, 100);
  assert.equal(share.get(1), 75);
  assert.equal(share.get(2), 25);
  assert.equal(share.has(3), false);
  assert.deepEqual([...top].sort(), [1, 2]);
  assert.equal(rules.approxTonnes(1234.4), "≈ 1,234 tCO₂e");
  assert.equal(rules.approxTonnes(4.26), "≈ 4.3 tCO₂e");
});
