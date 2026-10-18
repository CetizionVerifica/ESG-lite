// KPI-13 · the KPI golden index (ci/golden/kpi/cases.json): every suite runs
// (none left `skip`), its file and runner exist, and the inline units and
// aggregation cases match the hand figures. The other suites' figures are
// checked by their own runners (named in cases.json).
//   npm run build && node --test ci/unit/kpi-golden.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { toCanonical } = require(path.resolve("dist/kpi/values/units.js"));
const { aggregate } = require(path.resolve("dist/kpi/values/aggregate.js"));

const CASES = require(path.resolve("ci/golden/kpi/cases.json"));
const LIBRARY = require(path.resolve("data/kpi/definitions.json"));
const defs = new Map((LIBRARY.definitions || LIBRARY).map((d) => [d.code, d]));

test("every KPI golden suite runs, with its file and its runner", () => {
  assert.ok(CASES.suites.length >= 5);
  for (const s of CASES.suites) {
    assert.equal(s.status, "run", `${s.id} (${s.owner}) is still ${s.status}`);
    assert.ok(fs.existsSync(path.resolve(s.file)), `${s.id}: ${s.file}`);
    assert.ok(fs.existsSync(path.resolve(s.runner)), `${s.id}: ${s.runner}`);
  }
  for (const f of ["auto.json", "formulas.json"]) {
    const j = require(path.resolve("ci/golden/kpi", f));
    assert.ok(j.cases.length > 0 && !j.cases.some((c) => c.skip), `${f}: no case skipped`);
  }
});

test("units: every allowed unit becomes the canonical unit exactly; others are KPI_UNIT_NOT_ALLOWED", () => {
  for (const c of CASES.units) {
    const d = defs.get(c.kpi);
    assert.ok(d, c.kpi);
    const kpi = { unit_dimension: d.unit_dimension, canonical_unit: d.canonical_unit, allowed_units: d.allowed_units };
    if (c.expected.code) {
      assert.throws(() => toCanonical(c.value, c.unit, kpi), (e) => e.code === c.expected.code, c.name);
      continue;
    }
    const r = toCanonical(c.value, c.unit, kpi);
    assert.equal(r.value_canonical, c.expected.value_canonical, c.name);
    assert.equal(r.converted, c.expected.converted, c.name);
  }
});

test("aggregation: each rule by hand; missing is never 0", () => {
  for (const c of CASES.aggregation) assert.deepEqual(aggregate(c.entries, c.rule), c.expected, c.name);
});
