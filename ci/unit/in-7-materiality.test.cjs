// IN-7 · derive/materiality: worst status, topic shares (E1 with and without tCO₂e),
// weights 1–10 at the edges, and a KPI's status from several targets. Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const m = require(path.resolve("dist/insights/derive/materiality.js"));
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("worstStatus: off_track > at_risk > on_track > reached > no_data; none → no_data", () => {
  assert.equal(m.worstStatus([]), "no_data");
  assert.equal(m.worstStatus(["no_data"]), "no_data");
  assert.equal(m.worstStatus(["no_data", "reached"]), "reached");
  assert.equal(m.worstStatus(["reached", "on_track"]), "on_track");
  assert.equal(m.worstStatus(["on_track", "at_risk", "reached"]), "at_risk");
  assert.equal(m.worstStatus(["at_risk", "off_track", "no_data"]), "off_track");
});

test("topicShares: E1 is 100 % with approved tCO₂e, else its KPI share; others by KPI count; zero KPIs → 0", () => {
  const s = m.topicShares({ E1: 2, E3: 1, S1: 3 }, true);
  assert.equal(s.E1, 100);
  close(s.E3, 100 / 6, "E3");
  close(s.S1, 50, "S1");
  close(m.topicShares({ E1: 2, E3: 1, S1: 3 }, false).E1, 100 / 3, "E1 without tCO2e");
  assert.deepEqual(m.topicShares({ E3: 0, S1: 0 }, false), { E3: 0, S1: 0 });
  assert.equal(m.topicShares({ E1: 0 }, true).E1, 100);
});

test("weightOf: 1 + 9 × share ÷ 100, clamped to 1–10", () => {
  assert.equal(m.weightOf(0), 1);
  assert.equal(m.weightOf(100), 10);
  close(m.weightOf(50), 5.5, "half");
  assert.equal(m.weightOf(-5), 1);
  assert.equal(m.weightOf(250), 10);
});

test("kpiStatuses: each KPI takes the worst of its targets", () => {
  const s = m.kpiStatuses([
    { kpi_definition_id: 1, status: "on_track" },
    { kpi_definition_id: 1, status: "off_track" },
    { kpi_definition_id: 2, status: "reached" },
  ]);
  assert.equal(s.get(1), "off_track");
  assert.equal(s.get(2), "reached");
  assert.equal(s.get(3), undefined);
});
