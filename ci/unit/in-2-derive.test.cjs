// IN-2 · unit tests for the story-panel derive functions: indexSeries,
// combinedOutputIndex (I7, two units by base-year emission weight), lastValue,
// towardsTarget (up and down is good) and the target wall order, with zero,
// null and negative inputs. Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const d = require(path.resolve("dist/insights/derive/index.js"));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("indexSeries: base = 100; null for missing values, a missing or zero base", () => {
  assert.deepEqual(d.indexSeries([200, 250, null, 100], 0), [100, 125, null, 50]);
  assert.deepEqual(d.indexSeries([null, 5], 0), [null, null]);
  assert.deepEqual(d.indexSeries([0, 5], 0), [null, null]);
  assert.deepEqual(d.indexSeries([-10, -5], 0), [100, 50], "negative values keep their ratio");
  assert.deepEqual(d.indexSeries([], 0), []);
  assert.deepEqual(d.indexSeries([1, 2, 4], 1), [50, 100, 200]);
});

test("combinedOutputIndex: each site in its own unit, averaged by base-year emissions (I7)", () => {
  // Plant in t (10,000 → 12,000) weighted 2,000 t CO2e; plant in MWh (2,000 → 2,000) weighted 1,000.
  const r = d.combinedOutputIndex([[10000, 12000], [2000, 2000]], [2000, 1000], 0);
  close(r[0], 100, "base");
  close(r[1], (2000 * 120 + 1000 * 100) / 3000, "weighted");
  // A site missing in a year: the weights of the sites present (renormalised).
  const gap = d.combinedOutputIndex([[100, null, 150], [100, 110, 120]], [1, 3], 0);
  close(gap[0], 100, "gap base");
  close(gap[1], 110, "only the second site");
  close(gap[2], (1 * 150 + 3 * 120) / 4, "both");
  // No weight (no base-year output) → the site is left out; nobody → null.
  assert.deepEqual(d.combinedOutputIndex([[null, 5], [100, 200]], [0, 4], 0), [100, 200]);
  assert.deepEqual(d.combinedOutputIndex([[null, 5]], [0], 0), [null, null]);
  assert.deepEqual(d.combinedOutputIndex([[0, 5]], [1], 0), [null, null], "zero base output");
  assert.deepEqual(d.combinedOutputIndex([], [], 0), []);
});

test("lastValue: the last non-null value", () => {
  assert.equal(d.lastValue([1, 2, null]), 2);
  assert.equal(d.lastValue([null, null]), null);
  assert.equal(d.lastValue([]), null);
  assert.equal(d.lastValue([0]), 0);
  assert.equal(d.lastValue([-3, null]), -3);
});

test("towardsTarget: 0 at the baseline, 100 at the target, either direction; null without a span or figure", () => {
  close(d.towardsTarget(1000, 500, 950), 10, "down is good");
  close(d.towardsTarget(20, 40, 45), 125, "up is good, beyond the target");
  close(d.towardsTarget(1000, 500, 1100), -20, "the wrong way");
  assert.equal(d.towardsTarget(1000, 500, 1000), 0);
  assert.equal(d.towardsTarget(1000, 1000, 900), null);
  assert.equal(d.towardsTarget(1000, 500, null), null);
  close(d.towardsTarget(0, -10, -5), 50, "negative target");
});

test("wallOrder: status worst first, then the widest gap, unknown gaps last, then id", () => {
  const it = (id, status, progress_pct, expected_pct) => ({ id, status, progress_pct, expected_pct });
  const items = [
    it("a", "on_track", 60, 50),
    it("b", "off_track", 10, 50),
    it("c", "no_data", null, 50),
    it("d", "off_track", 30, 90),
    it("e", "reached", 120, 50),
    it("f", "at_risk", 45, 50),
    it("g", "off_track", null, null),
  ];
  assert.deepEqual(items.sort(d.wallOrder).map((x) => x.id), ["d", "b", "g", "f", "a", "e", "c"]);
});
