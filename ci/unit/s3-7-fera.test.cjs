// S3-7 engine unit tests: the Category 3 sub-activity of each FERA twin, the
// T&D-loss twin, FACTOR_TYPE_MISMATCH and WTT_ALREADY_IN_FACTOR. No
// database. The Cat 3 golden cases (ex-3.x in ci/golden/scope3/cases.json)
// check the sums; this file checks the same Example 3.1 figures (guidance
// L2577-2660) through the FERA twins themselves. Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { FactorIndex } = require(path.resolve("dist/services/emissionWrite/resolve.js"));
const { feraTwinFor } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const { feraSubFor, tdLossTwinFor, feraFactorTypeWarning, wttDoubleCountWarning, ghgCategoryOfContext } = require(path.resolve("dist/services/emissionWrite/methods/fera.js"));

let nextId = 1;
const factor = (name, value, unit, factor_type, extra = {}) => ({
  emission_factor_id: nextId++,
  emission_category_name: name,
  global_category_name: name,
  year: 2024,
  factor_value: String(value),
  denominator_unit: unit,
  source: "CI",
  factor_type,
  includes_wtt: false,
  ...extra,
});

const ctx = (scope, feraFactors, over = {}) => ({
  site_id: 1,
  category_id: 2,
  category_name: "Purchased Electricity",
  scope,
  assigned: true,
  hasForm: false,
  spec: null,
  selectColumns: new Set(),
  factors: new FactorIndex([]),
  fera: { category_id: 5, factors: new FactorIndex(feraFactors) },
  ...over,
});

// Example 3.1: country, kWh bought, upstream factor, combustion factor, T&D loss rate.
const EX31 = [
  ["Australia", 500000, 0.12, 0.8, 0.1],
  ["Canada", 600000, 0.1, 0.4, 0.13],
  ["India", 400000, 0.15, 0.8, 0.15],
  ["United States", 5500000, 0.1, 0.5, 0.1],
  ["Turkey", 200000, 0.05, 0.4, 0.12],
];
const HEAT = ["Canada heat", 50000, 0.05, 0.15, 0.05];

// Upload rule of docs/emission-factor-sources.md: td_loss = life-cycle grid factor × loss rate, per kWh consumed.
const feraFactorsFor = (rows) =>
  rows.flatMap(([name, , upstream, combustion, loss]) => [
    factor(name, upstream, "kwh", "wtt"),
    factor(`${name} T&D losses`, Number((combustion * loss).toFixed(8)), "kwh", "td_loss", { global_category_name: name }),
  ]);

const kg = (twin) => Number(twin.activityValue) * Number(twin.factor.factor_value);

test("ex-3.x upstream electricity and T&D losses: Example 3.1 gives 742,500 and 404,175 kgCO2e", () => {
  const rows = [...EX31, HEAT];
  const c = ctx("Scope 2", feraFactorsFor(rows));
  let upstream = 0;
  let td = 0;
  for (const [name, kwh] of rows) {
    const data = { activity_value: String(kwh) };
    const up = feraTwinFor(c, name, data, "kwh", 2024);
    const loss = tdLossTwinFor(c, name, data, "kwh", 2024);
    assert.equal(up.scope3_sub, "3b_upstream_electricity", name);
    assert.equal(loss.scope3_sub, "3c_td_losses", name);
    assert.equal(up.factor.factor_type, "wtt", `${name}: the upstream twin never takes the td_loss factor`);
    assert.equal(up.total, Math.round(kg(up) / 10) / 100, `${name}: tCO2e at 2 dp`);
    upstream += kg(up);
    td += kg(loss);
  }
  // Guidance: 740,000 (electricity) + 2,500 (heating) upstream; 404,175 T&D losses; 1,146,675 in all.
  assert.equal(Math.round(upstream), 742500);
  assert.equal(Math.round(td), 404175);
  assert.equal(Math.round(upstream + td), 1146675);
});

test("ex-3.x upstream fuels: a Scope 1 fuel's twin is 3a, and gets no T&D twin", () => {
  const c = ctx("Scope 1", [factor("Diesel", 610, "litre", "wtt"), factor("Diesel T&D losses", 1, "litre", "td_loss", { global_category_name: "Diesel" })], { category_name: "Stationary Combustion" });
  const twin = feraTwinFor(c, "Diesel", { activity_value: "1000" }, "litre", 2024);
  assert.deepEqual([twin.scope3_sub, twin.total], ["3a_upstream_fuels", 610]);
  assert.equal(tdLossTwinFor(c, "Diesel", { activity_value: "1000" }, "litre", 2024), null, "T&D losses apply to Scope 2 rows only");
});

test("no td_loss factor, or a spec category: no T&D twin", () => {
  const c = ctx("Scope 2", [factor("Grid", 0.1, "kwh", "wtt")]);
  assert.equal(tdLossTwinFor(c, "Grid", { activity_value: "10" }, "kwh", 2024), null);
  const spec = ctx("Scope 2", feraFactorsFor([EX31[0]]), { spec: { mode: "per_unit", methods: {} } });
  assert.equal(tdLossTwinFor(spec, "Australia", { activity_value: "10" }, "kwh", 2024), null);
  assert.equal(tdLossTwinFor(c, "Grid", { activity_value: "10" }, "kwh", 2023), null, "the year must match, as for the upstream twin");
});

test("a td_loss factor alone never becomes the upstream twin", () => {
  const c = ctx("Scope 2", [factor("Grid T&D losses", 0.08, "kwh", "td_loss", { global_category_name: "Grid" })]);
  assert.equal(feraTwinFor(c, "Grid", { activity_value: "10" }, "kwh", 2024), null);
  assert.equal(tdLossTwinFor(c, "Grid", { activity_value: "1000" }, "kwh", 2024).total, 0.08);
});

test("the sub-activity follows the parent's scope", () => {
  assert.equal(feraSubFor("Scope 2"), "3b_upstream_electricity");
  assert.equal(feraSubFor("scope2"), "3b_upstream_electricity");
  assert.equal(feraSubFor("Scope 1"), "3a_upstream_fuels");
  assert.equal(feraSubFor(null), "3a_upstream_fuels");
});

test("FACTOR_TYPE_MISMATCH on a FERA factor typed other than wtt or td_loss; untyped factors pass", () => {
  const twin = (factor_type) => ({ category_id: 5, factor: factor("X", 1, "kwh", factor_type), activityValue: 1, total: 0, scope3_sub: "3a_upstream_fuels" });
  assert.equal(feraFactorTypeWarning(twin("combustion")).code, "FACTOR_TYPE_MISMATCH");
  assert.equal(feraFactorTypeWarning(twin("wtt")), null);
  assert.equal(feraFactorTypeWarning(twin("td_loss")), null);
  assert.equal(feraFactorTypeWarning(twin(null)), null);
  assert.equal(feraFactorTypeWarning(null), null);
});

test("WTT_ALREADY_IN_FACTOR only for Cat 4/9 rows on a life-cycle factor that sums in WTT", () => {
  const freight = (name) => ctx("Scope 3", [], { category_name: name });
  const summed = factor("HGV", 0.11, "tonne.km", "life_cycle", { includes_wtt: true });
  assert.equal(ghgCategoryOfContext(freight("Upstream Transportation and Distribution")), 4);
  assert.equal(ghgCategoryOfContext(freight("Downstream transportation and distribution")), 9);
  assert.equal(wttDoubleCountWarning(freight("Upstream Transportation and Distribution"), summed).code, "WTT_ALREADY_IN_FACTOR");
  assert.equal(wttDoubleCountWarning(freight("Downstream transportation and distribution"), summed).code, "WTT_ALREADY_IN_FACTOR");
  assert.equal(wttDoubleCountWarning(freight("Business Travel"), summed), null, "Cat 6 is not flagged");
  assert.equal(wttDoubleCountWarning(freight("Upstream Transportation and Distribution"), { ...summed, includes_wtt: false }), null);
  assert.equal(wttDoubleCountWarning(freight("Upstream Transportation and Distribution"), { ...summed, factor_type: "eeio_spend" }), null);
  assert.equal(wttDoubleCountWarning(ctx("Scope 1", [], { category_name: "Upstream transport fuel" }), summed), null, "only Scope 3 categories are read by name");
  assert.equal(wttDoubleCountWarning(ctx("Scope 3", [], { category_name: "Anything", ghg_category: 9 }), summed).code, "WTT_ALREADY_IN_FACTOR", "S3-1's ghg_category wins");
});
