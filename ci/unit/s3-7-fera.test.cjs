// S3-7 engine unit tests: the Category 3 sub-activity of each FERA twin, the
// T&D-loss twin, FACTOR_TYPE_MISMATCH, WTT_ALREADY_IN_FACTOR and D6a (WTT
// in the row of a Category 4, 6, 7 or 9 entry). No
// database. The Cat 3 golden cases (ex-3.x in ci/golden/scope3/cases.json)
// check the sums; this file checks the same Example 3.1 figures (guidance
// L2577-2660) through the FERA twins themselves. Runs against dist/:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { FactorIndex } = require(path.resolve("dist/services/emissionWrite/resolve.js"));
const { feraTwinFor } = require(path.resolve("dist/services/emissionWrite/compute.js"));
const { feraSubFor, tdLossTwinFor, feraFactorTypeWarning, wttDoubleCountWarning, ghgCategoryOfContext, wttInRow, wttPartFor, withWtt } = require(path.resolve("dist/services/emissionWrite/methods/fera.js"));

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

test("WTT_ALREADY_IN_FACTOR for Cat 4, 6, 7 and 9 rows on a life-cycle factor that sums in WTT (D6a: no WTT is added)", () => {
  const freight = (name) => ctx("Scope 3", [], { category_name: name });
  const summed = factor("HGV", 0.11, "tonne.km", "life_cycle", { includes_wtt: true });
  assert.equal(ghgCategoryOfContext(freight("Upstream Transportation and Distribution")), 4);
  assert.equal(ghgCategoryOfContext(freight("Downstream transportation and distribution")), 9);
  for (const name of ["Upstream Transportation and Distribution", "Downstream transportation and distribution", "Business Travel", "Employee Commuting"]) {
    const w = wttDoubleCountWarning(freight(name), summed);
    assert.equal(w.code, "WTT_ALREADY_IN_FACTOR", name);
    assert.match(w.message, /so no WTT was added/);
  }
  assert.equal(wttDoubleCountWarning(freight("Upstream Transportation and Distribution"), { ...summed, includes_wtt: false }), null);
  assert.equal(wttDoubleCountWarning(freight("Upstream Transportation and Distribution"), { ...summed, factor_type: "eeio_spend" }), null);
  assert.equal(wttDoubleCountWarning(freight("Upstream leased assets"), summed), null, "Cat 8 is not a transport category");
  assert.equal(wttDoubleCountWarning(ctx("Scope 1", [], { category_name: "Upstream transport fuel" }), summed), null, "only Scope 3 categories are read by name");
  assert.equal(wttDoubleCountWarning(ctx("Scope 3", [], { category_name: "Anything", ghg_category: 9 }), summed).code, "WTT_ALREADY_IN_FACTOR", "S3-1's ghg_category wins");
});

// D6a, GHG Protocol Scope 3 Technical Guidance pp. 14 and 51: Scope 3 transport and travel use
// life-cycle factors (combustion + WTT), so the WTT part goes in the row, not in Category 3.
test("D6a: WTT goes in the row for Categories 4, 6, 7 and 9 only", () => {
  const named = (category_name, scope = "Scope 3", extra = {}) => wttInRow(ctx(scope, [], { category_name, ...extra }));
  assert.equal(named("Upstream Transportation and Distribution"), true);
  assert.equal(named("Business Travel"), true);
  assert.equal(named("Employee Commuting"), true);
  assert.equal(named("Downstream transportation and distribution"), true);
  assert.equal(named("Purchased Goods and Services"), false);
  assert.equal(named("Upstream leased assets"), false);
  assert.equal(named("FERA", "Scope 3", { ghg_category: 3 }), false, "Category 3 itself");
  assert.equal(named("Mobile Combustion", "Scope 1"), false, "a company's own fuel keeps its Category 3 twin");
  assert.equal(named("Anything", "Scope 3", { ghg_category: 6 }), true, "S3-1's ghg_category wins");
});

test("D6a: a DESNZ flight of 1,000 passenger.km: 0.22928 + 0.0335 WTT = 262.78 kg, 0.26 t", () => {
  const name = "Flights - Domestic, to/from UK, Average passenger, With RF [passenger.km]";
  const c = ctx("Scope 3", [factor(name, 0.0335, "passenger.km", "wtt")], { category_name: "Business Travel" });
  const part = wttPartFor(c, name, { quantity: 1000 }, "passenger.km", 2024);
  assert.equal(part.total_kgco2e, "33.5000");
  assert.equal(part.factor.factor_type, "wtt");
  const row = withWtt({ total: 0.23, total_kgco2e: "229.2800", activityValue: 1000 }, part);
  assert.deepEqual([row.total, row.total_kgco2e, row.activityValue], [0.26, "262.7800", 1000]);
  assert.equal(wttPartFor(c, name, { quantity: 1000 }, "passenger.km", 2023), null, "the twin's rule: the target year's factor only");
  assert.equal(wttPartFor(c, "Hotel stay - UK [Room per night]", { quantity: 3 }, "Room per night", 2024), null, "no WTT factor of that name");
});

test("D6a: kg are summed before the tonnes are rounded", () => {
  // 4.9960 + 0.0045 kg = 5.0005 kg → 0.01 t (each part alone would round to 0.00 t and 0.00 t).
  assert.deepEqual(withWtt({ total: 0, total_kgco2e: "4.9960" }, { total_kgco2e: "0.0045", factor: {} }), { total: 0.01, total_kgco2e: "5.0005" });
});
