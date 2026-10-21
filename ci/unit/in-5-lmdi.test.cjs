// IN-5 · derive/lmdi.ts: the log mean, the additive LMDI identity on 500 random
// cases, small-value substitution, and bridgeSteps (order, folding into Other,
// labels, the waterfall closing exactly; the artifact's 52,100 → 49,700 example
// from ci/golden/in/bridge/fixture.json). Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const l = require(path.resolve("dist/insights/derive/lmdi.js"));
const G = require(path.resolve("ci/golden/in/bridge/fixture.json"));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("logMean: L(a, a) = a, symmetric, between the two values; positive values only", () => {
  assert.equal(l.logMean(5, 5), 5);
  near(l.logMean(1, Math.E), (Math.E - 1) / 1, 1e-12, "L(e, 1)");
  assert.equal(l.logMean(2, 8), l.logMean(8, 2));
  const m = l.logMean(2, 8);
  assert.ok(m > 2 && m < 8);
  assert.throws(() => l.logMean(0, 1));
  assert.throws(() => l.logMean(-1, 1));
});

test("LMDI identity: the effects of 500 random decompositions sum to Eᵀ − E⁰ within 1e-6", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 500; n++) {
    const comps = [];
    let e0 = 0;
    let eT = 0;
    const k = 1 + Math.floor(rnd() * 3);
    for (let c = 0; c < k; c++) {
      const factors = [];
      const f = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < f; i++) factors.push({ name: i === 0 ? "activity" : `f${c}_${i}`, x0: 0.01 + rnd() * 1000, xT: 0.01 + rnd() * 1000 });
      comps.push({ name: `c${c}`, factors });
      e0 += factors.reduce((a, x) => a * x.x0, 1);
      eT += factors.reduce((a, x) => a * x.xT, 1);
    }
    const r = l.lmdiAdditive(comps);
    const sum = Object.values(r.effects).reduce((a, b) => a + b, 0);
    near(sum, eT - e0, 1e-6 * Math.max(1, Math.abs(eT), Math.abs(e0)), `case ${n}`);
    assert.equal(r.substituted.length, 0);
  }
});

test("small values: a zero is replaced by 1e-9 and named; the identity holds for what was decomposed", () => {
  const r = l.lmdiAdditive([{ name: "scope1", factors: [{ name: "activity", x0: 100, xT: 120 }, { name: "intensity_s1", x0: 0, xT: 2 }] }]);
  assert.deepEqual(r.substituted, ["scope1.intensity_s1@0"]);
  assert.equal(r.components[0].factors[1].x0, l.SMALL);
  const sum = Object.values(r.effects).reduce((a, b) => a + b, 0);
  near(sum, 240 - 100 * l.SMALL, 1e-9, "Σ");
});

test("bridgeSteps: the artifact's 52,100 → 49,700 example by hand, in step order, closing exactly", () => {
  const u = G.unit_example;
  const y = (d, net, year) => ({ year, net, s1: d.s1, s2: d.s2, s3: d.s3, saved: 0, q: d.q, kwh: d.kwh, renewable_pct: null });
  const { steps, notes } = l.bridgeSteps(y(u.from, 52100, 2024), y(u.to, 49700, 2025), { unit: "t", outputIndex: false });
  assert.deepEqual(steps.map((s) => s.driver), u.expected.map((s) => s.driver));
  u.expected.forEach((e, i) => near(steps[i].value, e.value, 1e-6, e.driver));
  assert.equal(steps.reduce((a, s) => a + s.value, 0), 49700 - 52100);
  assert.deepEqual(notes, []);
  assert.equal(steps[0].label, "More output");
  assert.equal(steps[1].label, "Better process efficiency");
  assert.equal(steps[2].label, "Less electricity per t");
  assert.equal(steps[3].label, "Cleaner electricity");
  assert.ok(Math.abs(steps[0].inputs.ln_ratio - Math.log(1.06)) < 1e-12);
  for (const k of ["q_from", "q_to", "l_scope1", "l_scope2"]) assert.equal(typeof steps[0].inputs[k], "number", k);
});

const base = { year: 2024, net: 300, s1: 200, s2: 100, s3: 0, saved: 0, q: 1000, kwh: 125000, renewable_pct: null };

test("bridgeSteps: production missing → only Scope 3 and Other, with the note", () => {
  const { steps, notes } = l.bridgeSteps({ ...base, q: null }, { ...base, year: 2025, net: 330, s1: 210, s2: 100, s3: 20, q: null }, { unit: null, outputIndex: false });
  assert.deepEqual(steps.map((s) => [s.driver, s.value]), [["scope3", 20], ["other", 10]]);
  assert.ok(notes.includes(l.NO_PRODUCTION_NOTE));
});

test("bridgeSteps: a year without kWh folds Scope 2 into Other with a note; saved tCO₂e goes to Other", () => {
  const { steps, notes } = l.bridgeSteps(base, { ...base, year: 2025, net: 290, s2: 95, kwh: 0, saved: 5 }, { unit: "t", outputIndex: false });
  assert.deepEqual(steps.map((s) => s.driver), ["activity", "intensity_s1", "scope3", "other"]);
  near(steps.find((s) => s.driver === "other").value, -5 - 5, 1e-9, "other = ΔS2 − Δsaved");
  assert.ok(notes.some((n) => n.includes("no electricity kWh in 2025")));
  assert.ok(notes.some((n) => n.includes("no-scope savings")));
  assert.equal(steps.reduce((a, s) => a + s.value, 0), -10);
});

test("bridgeSteps: a zero Scope 1 year is substituted and flagged; Overview rounding is absorbed, a real gap throws", () => {
  const { steps, notes } = l.bridgeSteps({ ...base, s1: 0, net: 100 }, { ...base, year: 2025 }, { unit: "t", outputIndex: false });
  assert.ok(notes.some((n) => n.includes("1e-9")));
  near(steps.reduce((a, s) => a + s.value, 0), 200, 1e-9, "Σ");
  const r = l.bridgeSteps(base, { ...base, year: 2025, s1: 210, net: 310.001 }, { unit: "t", outputIndex: false });
  near(r.steps.reduce((a, s) => a + s.value, 0), 10.001, 1e-12, "rounding residue");
  assert.throws(() => l.bridgeSteps(base, { ...base, year: 2025, s1: 210, net: 350 }, { unit: "t", outputIndex: false }), /does not close/);
});

test("stepLabel: plain words by direction", () => {
  assert.equal(l.stepLabel("activity", -1, "t"), "Less output");
  assert.equal(l.stepLabel("intensity_s1", 2, "t"), "Worse process efficiency");
  assert.equal(l.stepLabel("energy_intensity_s2", 3, null), "More electricity per unit of output");
  assert.equal(l.stepLabel("grid_and_renewables_s2", 1, null), "More carbon-intensive electricity");
  assert.equal(l.stepLabel("other", 1, null), "Other");
});
