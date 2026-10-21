// IN-3 · the insight rules (01-contracts §6, I12) on fixed facts: the golden
// file ci/golden/in/rules/fixture.json (each rule at its firing edge and just
// below; eight rules firing → the right six kept), every rule's params keys
// against the contract, display rounding, months passed, and the engine's
// ranking. Pure: no database. Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const engine = require(path.resolve("dist/insights/rules/engine.js"));
const thresholds = require(path.resolve("dist/insights/rules/thresholds.js"));
const { monthsPassed } = require(path.resolve("dist/insights/rules/coverage_gap.js"));
const contracts = require(path.resolve("dist/insights/contracts/index.js"));
const G = require(path.resolve("ci/golden/in/rules/fixture.json"));

const merge = (base, patch) => ({ ...JSON.parse(JSON.stringify(base)), ...JSON.parse(JSON.stringify(patch)) });

test("the quiet facts fire no rule", () => {
  assert.deepEqual(engine.runRules(G.quiet), []);
});

test("every rule id has a rule, and every contract rule has golden cases that fire and that don't", () => {
  assert.deepEqual(Object.keys(engine.RULES).sort(), [...contracts.RULE_IDS].sort());
  for (const id of contracts.RULE_IDS) {
    const mine = G.cases.filter((c) => c.rule === id);
    assert.ok(mine.some((c) => c.expected), `${id} has a firing case`);
    assert.ok(mine.some((c) => !c.expected), `${id} has a non-firing case`);
  }
});

for (const c of G.cases) {
  test(`golden: ${c.name}`, () => {
    const facts = merge(G.quiet, c.patch);
    const card = engine.RULES[c.rule](facts);
    if (!c.expected) return assert.equal(card, null);
    assert.ok(card, "fires");
    assert.equal(card.rule, c.rule);
    assert.equal(card.id, c.rule);
    assert.equal(card.source, "rule");
    assert.equal(card.severity, c.expected.severity);
    assert.deepEqual(card.params, c.expected.params);
    assert.deepEqual(Object.keys(card.params).sort(), [...contracts.RULES[c.rule].params].sort(), "params keys = the contract's");
    assert.ok(contracts.RULES[c.rule].severities.includes(card.severity), "a contract severity");
    if (c.expected.panel) assert.equal(card.panel, c.expected.panel);
    if (c.expected.link) assert.equal(card.link, c.expected.link);
    assert.equal(card.text, undefined, "rule cards carry no text");
  });
}

test("golden ranking: " + G.ranking.name, () => {
  const facts = merge(G.quiet, G.ranking.patch);
  const fired = engine.runRules(facts, 99);
  assert.equal(fired.length, G.ranking.fired);
  const kept = engine.runRules(facts);
  assert.equal(kept.length, contracts.MAX_CARDS);
  assert.deepEqual(kept.map((c) => c.rule), G.ranking.expected_rules);
});

test("displayPct: 0 dp, 1 dp under 10, never -0", () => {
  assert.equal(thresholds.displayPct(12.5), 13);
  assert.equal(thresholds.displayPct(9.94), 9.9);
  assert.equal(thresholds.displayPct(-9.96), -10);
  assert.equal(thresholds.displayPct(-0.04), 0);
  assert.ok(!Object.is(thresholds.displayPct(-0.04), -0));
  assert.equal(thresholds.displayPct(0.05), 0.1);
});

test("monthsPassed: months of the period ended by today; an ended period is 12", () => {
  assert.equal(monthsPassed({ start: "2026-01-01", end: "2026-12-31" }, "2026-01-15"), 0);
  assert.equal(monthsPassed({ start: "2026-01-01", end: "2026-12-31" }, "2026-10-01"), 9);
  assert.equal(monthsPassed({ start: "2025-04-01", end: "2026-03-31" }, "2026-01-02"), 9);
  assert.equal(monthsPassed({ start: "2025-01-01", end: "2025-12-31" }, "2026-02-01"), 12);
  assert.equal(monthsPassed({ start: "2027-01-01", end: "2027-12-31" }, "2026-02-01"), 0);
});

test("ranking: severity first (critical, attention, good, info), then rule weight", () => {
  const ids = Object.keys(thresholds.RULE_WEIGHT);
  assert.deepEqual(ids.sort(), [...contracts.RULE_IDS].sort());
  assert.deepEqual([...contracts.CARD_SEVERITY_RANK], ["critical", "attention", "good", "info"]);
});
