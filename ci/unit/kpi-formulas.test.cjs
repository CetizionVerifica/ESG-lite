// KPI-6 formulas: the parser (valid, invalid with positions), units, the
// dependency graph (unknown codes, cycles, dependants, order), the evaluator,
// the resolver (sites and periods rolled up, missing ≠ 0, statuses), every
// library formula, and the golden cases in ci/golden/kpi/formulas.json.
//   npm run build && node --test ci/unit/kpi-formulas.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseFormula, refsOf, formulaCodes, parseUnit, formatUnit, sameUnit, unitOf } = require(path.resolve("dist/kpi/formulas/parse.js"));
const { formulaProblems, definitionProblems, dependantsOf, evaluationOrder } = require(path.resolve("dist/kpi/formulas/graph.js"));
const { evaluate } = require(path.resolve("dist/kpi/formulas/evaluate.js"));
const { makeResolver } = require(path.resolve("dist/kpi/formulas/resolve.js"));
const { periodsFor } = require(path.resolve("dist/kpi/values/period.js"));

const GOLDEN = require(path.resolve("ci/golden/kpi/formulas.json"));
const LIBRARY = require(path.resolve("data/kpi/definitions.json"));

const problemOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.equal(err.code, "KPI_FORMULA_INVALID");
    return err.details;
  }
  assert.fail("expected KPI_FORMULA_INVALID");
};
const value = (formula, inputs) => evaluate(parseFormula(formula), (r) => ({ value: inputs[r.part ? `${r.code}.${r.part}` : r.code] ?? null, status: "approved" }));

test("parser: codes, numbers, precedence, brackets, unary minus, ×÷−, breakdown parts, sum() and avg()", () => {
  assert.equal(value("2 + 3 * 4", {}).value, 14);
  assert.equal(value("(2 + 3) * 4", {}).value, 20);
  assert.equal(value("10 - 4 - 3", {}).value, 3, "left to right");
  assert.equal(value("12 / 4 / 3", {}).value, 1);
  assert.equal(value("-A + 5", { A: 2 }).value, 3);
  assert.equal(value("A × 2 ÷ 4 − 1", { A: 6 }).value, 2);
  assert.equal(value("1.5e3 + .5", {}).value, 1500.5);
  const refs = refsOf(parseFormula("sum(WATER_WITHDRAWAL.groundwater) / avg(HOURS_WORKED) + WATER_WITHDRAWAL"));
  assert.deepEqual(refs.map((r) => [r.code, r.part, r.fn]), [["WATER_WITHDRAWAL", "groundwater", "sum"], ["HOURS_WORKED", null, "avg"], ["WATER_WITHDRAWAL", null, null]]);
  assert.deepEqual(formulaCodes("(GHG_SCOPE1 + GHG_SCOPE2_LB) / REVENUE + GHG_SCOPE1"), ["GHG_SCOPE1", "GHG_SCOPE2_LB", "REVENUE"]);
  assert.deepEqual(formulaCodes("nope("), []);
});

test("parser: invalid formulas answer KPI_FORMULA_INVALID with the position", () => {
  const cases = [
    ["", 0],
    ["   ", 0],
    ["A +", 3],
    ["(A + B", 6],
    ["A + B)", 5],
    ["A; DROP", 1],
    ["eval(A)", 0],
    ["A.", 2],
    ["A.Ground", 2],
    ["sum(2)", 4],
    ["sum A", 4],
    ["A B", 2],
    ["A + * B", 4],
  ];
  for (const [src, pos] of cases) {
    const d = problemOf(() => parseFormula(src));
    assert.equal(d.position, pos, `${JSON.stringify(src)}: ${d.problems[0]}`);
    assert.ok(d.problems[0].length > 3);
  }
  problemOf(() => parseFormula("A".repeat(501)));
});

test("units: × and ÷ combine, + and − need the same unit, dimensionless words cancel", () => {
  const units = { GHG_SCOPE1: "tCO2e", GHG_SCOPE2_LB: "tCO2e", REVENUE: "INR crore", ENERGY_TOTAL: "GJ", ENERGY_RENEWABLE: "GJ", EMPLOYEES_TOTAL: "count", HOURS: "hours" };
  const of = (f) => unitOf(parseFormula(f), (c) => units[c] ?? null);
  assert.equal(formatUnit(of("(GHG_SCOPE1 + GHG_SCOPE2_LB) / REVENUE")), "tCO2e per INR crore");
  assert.ok(sameUnit(of("(GHG_SCOPE1 + GHG_SCOPE2_LB) / REVENUE"), parseUnit("tCO2e per INR crore")));
  assert.ok(sameUnit(of("ENERGY_RENEWABLE / ENERGY_TOTAL * 100"), parseUnit("%")), "a share is a plain number, like %");
  assert.ok(sameUnit(of("HOURS / EMPLOYEES_TOTAL"), parseUnit("hours per employee")));
  assert.ok(sameUnit(parseUnit("kgCO2e"), parseUnit("kgco2e")), "spellings through the unit registry");
  assert.ok(!sameUnit(parseUnit("tCO2e"), parseUnit("kgCO2e")), "a scale is a different unit");
  assert.equal(formatUnit(of("GHG_SCOPE1 * GHG_SCOPE1 / REVENUE")), "tCO2e^2 per INR crore");
  assert.equal(formatUnit(parseUnit("per million hours")), "per million hours");
  assert.equal(formatUnit({}), "");
  const mixed = problemOf(() => of("GHG_SCOPE1 + ENERGY_TOTAL"));
  assert.equal(mixed.position, 11);
  assert.match(mixed.problems[0], /mixes tCO2e and GJ/);
  problemOf(() => of("GHG_SCOPE1 - 5"));
});

test("every library formula parses, names known KPIs, gives its KPI's unit and loops nowhere", () => {
  const defs = LIBRARY.map((d) => ({ code: d.code, source: d.source, formula: d.formula, canonical_unit: d.canonical_unit }));
  assert.deepEqual(formulaProblems(defs), []);
  assert.ok(defs.filter((d) => d.source === "formula").length >= 6);
});

test("graph: unknown codes, unit mismatches, cycles; a save reports only what it brings", () => {
  const base = [
    { code: "A", source: "manual", formula: null, canonical_unit: "GJ" },
    { code: "B", source: "formula", formula: "A * 2", canonical_unit: "GJ" },
    { code: "C", source: "formula", formula: "B / A", canonical_unit: "ratio" },
  ];
  assert.deepEqual(formulaProblems(base), []);
  assert.deepEqual(formulaProblems([...base, { code: "D", source: "formula", formula: "A + X", canonical_unit: "GJ" }]).map((p) => p.problem), ["Unknown KPI X."]);
  assert.match(formulaProblems([...base, { code: "D", source: "formula", formula: "A", canonical_unit: "kWh" }])[0].problem, /gives GJ, not kWh/);
  const loop = definitionProblems({ code: "A", source: "formula", formula: "C * 1", canonical_unit: "ratio" }, base);
  assert.ok(loop.some((p) => /loops back/.test(p.problem)), JSON.stringify(loop));
  // Changing A's unit would break B: reported; an unrelated KPI that was already broken isn't.
  const broken = { code: "OLD", source: "formula", formula: "NOPE", canonical_unit: null };
  const unit = definitionProblems({ code: "A", source: "manual", formula: null, canonical_unit: "kWh" }, [...base, broken]);
  assert.ok(unit.some((p) => p.code === "B"), JSON.stringify(unit));
  assert.ok(!unit.some((p) => p.code === "OLD"));
  assert.deepEqual(definitionProblems({ code: "E", source: "manual", formula: null, canonical_unit: "GJ" }, [...base, broken]), []);
});

test("graph: dependants and evaluation order across the library", () => {
  const defs = LIBRARY.map((d) => ({ code: d.code, source: d.source, formula: d.formula, canonical_unit: d.canonical_unit }));
  assert.deepEqual([...dependantsOf(defs, ["WATER_WITHDRAWAL"])].sort(), ["WATER_CONSUMPTION", "WATER_INTENSITY_REVENUE"]);
  assert.deepEqual([...dependantsOf(defs, ["REVENUE"])].sort(), ["ENERGY_INTENSITY_REVENUE", "GHG_INTENSITY_REVENUE", "WASTE_INTENSITY_REVENUE", "WATER_INTENSITY_REVENUE"]);
  const order = evaluationOrder(defs);
  assert.ok(order.indexOf("WATER_CONSUMPTION") < order.indexOf("WATER_INTENSITY_REVENUE"));
  assert.deepEqual(evaluationOrder(defs, ["WATER_INTENSITY_REVENUE"]), ["WATER_INTENSITY_REVENUE"]);
  const cyclic = [
    { code: "X", source: "formula", formula: "Y", canonical_unit: null },
    { code: "Y", source: "formula", formula: "X", canonical_unit: null },
    { code: "Z", source: "formula", formula: "1", canonical_unit: null },
  ];
  assert.deepEqual(evaluationOrder(cyclic), ["Z"], "a cycle is never evaluated");
});

test("evaluate: missing inputs are never 0; division by zero; waiting for unapproved inputs; inputs listed", () => {
  const ast = parseFormula("(GHG_SCOPE1 + GHG_SCOPE2_LB) / REVENUE");
  const r = evaluate(ast, (ref) => ({ GHG_SCOPE1: { value: 1200, status: "approved" }, GHG_SCOPE2_LB: { value: 800, status: "pending" }, REVENUE: { value: 250, status: "approved" } })[ref.code]);
  assert.equal(r.value, 8);
  assert.deepEqual(r.waiting_for, ["GHG_SCOPE2_LB"]);
  assert.deepEqual(r.inputs.map((i) => [i.code, i.value, i.status]), [["GHG_SCOPE1", 1200, "approved"], ["GHG_SCOPE2_LB", 800, "pending"], ["REVENUE", 250, "approved"]]);
  const none = evaluate(ast, (ref) => (ref.code === "REVENUE" ? null : { value: 1, status: "approved" }));
  assert.deepEqual([none.value, none.reason, none.missing], [null, "missing_inputs", ["REVENUE"]]);
  assert.deepEqual(value("A / (B - B)", { A: 1, B: 3 }).reason, "division_by_zero");
  assert.equal(value("0.1 + 0.2", {}).value, 0.3, "binary noise rounded");
  assert.deepEqual(value("A.female / A", { A: 10 }).missing, ["A.female"]);
});

test("golden cases (ci/golden/kpi/formulas.json): units and values worked by hand", () => {
  assert.equal(GOLDEN.cases.length, 6);
  for (const c of GOLDEN.cases) {
    const ast = parseFormula(c.formula);
    assert.ok(sameUnit(unitOf(ast, (code) => GOLDEN.units[code] ?? null), parseUnit(c.unit)), `${c.name}: unit`);
    const r = evaluate(ast, (ref) => {
      const input = c.inputs[ref.code];
      if (input === undefined) return null;
      if (typeof input === "number") return ref.part ? null : { value: input, status: "approved" };
      return { value: ref.part ? input.parts?.[ref.part] ?? null : input.value, status: "approved" };
    });
    assert.equal(r.value, c.expected.value, c.name);
    assert.equal(r.reason, c.expected.reason, c.name);
    assert.deepEqual(r.missing, c.expected.missing, c.name);
  }
});

test("resolver: site values, company roll-up over sites and periods, sum() and avg(), partial and missing", () => {
  const defs = new Map(
    [
      { id: 1, code: "WATER_WITHDRAWAL", level: "site", aggregation: "sum", frequency: "monthly", canonical_unit: "kL" },
      { id: 2, code: "REVENUE", level: "company", aggregation: "none", frequency: "annual", canonical_unit: "INR crore" },
      { id: 3, code: "LTIFR", level: "site", aggregation: "weighted_average", frequency: "annual", canonical_unit: "per million hours" },
    ].map((d) => [d.code, { ...d, source: "manual", formula: null, name: d.code, selected: true }]),
  );
  const months = periodsFor("monthly", "CY", 2026);
  const v = (id, kpi, site, p, value, status = "approved", breakdown = null) => ({ id, kpi_definition_id: kpi, site_id: site, period_start: p.start, period_end: p.end, frequency: p.frequency, value, breakdown, status });
  const year = periodsFor("annual", "CY", 2026)[0];
  const values = [
    v(1, 1, 1, months[0], 100, "approved", { groundwater: 60, surface: 40 }),
    v(2, 1, 1, months[1], 50, "pending"),
    v(3, 1, 2, months[0], 30),
    v(4, 2, null, year, 250),
    v(5, 3, 1, year, 2),
    v(6, 3, 2, year, 4),
    // Another frequency's value of the same KPI is ignored (no double count).
    { ...v(7, 1, 1, periodsFor("quarterly", "CY", 2026)[0], 999), frequency: "quarterly" },
  ];
  const sites = [1, 2, 3];
  const site1Year = makeResolver(defs, values, sites, 1, year);
  assert.deepEqual(site1Year({ code: "WATER_WITHDRAWAL", part: null, fn: null }), { value: 150, status: "pending", unit: "kL", partial: true });
  assert.equal(site1Year({ code: "WATER_WITHDRAWAL", part: "groundwater", fn: null }).value, 60);
  assert.equal(site1Year({ code: "REVENUE", part: null, fn: null }).value, 250, "a site-level formula reads the company value");
  const company = makeResolver(defs, values, sites, null, year);
  const w = company({ code: "WATER_WITHDRAWAL", part: null, fn: null });
  assert.deepEqual([w.value, w.status, w.partial], [180, "pending", true]);
  assert.equal(company({ code: "WATER_WITHDRAWAL", part: null, fn: "avg" }).value, 90);
  assert.equal(company({ code: "LTIFR", part: null, fn: null }).value, 3, "weighted average without weights: plain average");
  assert.equal(company({ code: "LTIFR", part: null, fn: "sum" }).value, 6);
  assert.deepEqual(makeResolver(defs, values, sites, 3, year)({ code: "WATER_WITHDRAWAL", part: null, fn: null }), { value: null }, "nothing at site 3: missing");
  assert.equal(company({ code: "NOPE", part: null, fn: null }), null);
  const jan = makeResolver(defs, values, sites, 1, months[0]);
  assert.deepEqual(jan({ code: "WATER_WITHDRAWAL", part: null, fn: null }), { value: 100, status: "approved", unit: "kL", partial: false });
  assert.deepEqual(jan({ code: "REVENUE", part: null, fn: null }), { value: null }, "an annual input never feeds a monthly period");
});
