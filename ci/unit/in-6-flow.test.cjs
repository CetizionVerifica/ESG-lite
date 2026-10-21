// IN-6 · derive/flow.ts (pure): node ids and columns, tonnes links only above 0,
// GHG KPIs take their scope's tonnes, count-only KPIs appear only when they feed
// a disclosure, one count link per mapping row with its fit, categories for the
// KPI-off variant, and conservation through the scope column. Runs against the build.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { flowGraph, flowTotal } = require(path.resolve("dist/insights/derive/flow.js"));

const sites = [
  { site_id: 1, name: "A", scope_1: 100, scope_2: 50, scope_3: 0 },
  { site_id: 2, name: "B", scope_1: 40, scope_2: 0, scope_3: 10 },
];

test("sites and scopes always; tonnes links only above zero", () => {
  const f = flowGraph({ sites });
  assert.deepEqual(f.nodes.map((n) => [n.id, n.column, n.kind]), [
    ["site:1", 0, "site"], ["site:2", 0, "site"], ["scope:1", 1, "scope"], ["scope:2", 1, "scope"], ["scope:3", 1, "scope"],
  ]);
  assert.deepEqual(f.links.map((l) => `${l.source}>${l.target}=${l.value}`), ["site:1>scope:1=100", "site:1>scope:2=50", "site:2>scope:1=40", "site:2>scope:3=10"]);
  assert.ok(f.links.every((l) => l.measure === "tCO2e"));
  assert.deepEqual(flowGraph({ sites: [] }).links, []);
});

test("KPIs: GHG ones take tonnes from their scope; count-only ones show only when mapped; disclosures count 1 each", () => {
  const f = flowGraph({
    sites,
    kpis: [
      { code: "S1", name: "Scope 1", scope: 1, value: 140 },
      { code: "S2", name: "Scope 2", scope: 2, value: null },
      { code: "EN", name: "Energy", scope: null, value: null },
      { code: "UNMAPPED", name: "Nothing", scope: null, value: null },
    ],
    mappings: [
      { kpi: "S1", framework: "GRI", code: "305-1", title: "Direct", fit: "exact" },
      { kpi: "S1", framework: "BRSR", code: "P6-E7", title: "GHG", fit: "exact" },
      { kpi: "S2", framework: "BRSR", code: "P6-E7", title: "GHG", fit: "partial" },
      { kpi: "EN", framework: "GRI", code: "302-1", title: "Energy", fit: "derived" },
      { kpi: "GONE", framework: "GRI", code: "999", title: "Not shown", fit: "exact" },
    ],
  });
  assert.equal(flowTotal(f, "scope:1", "in"), 140);
  assert.equal(flowTotal(f, "scope:1", "out"), 140, "conserved");
  assert.ok(f.nodes.some((n) => n.id === "kpi:S2" && n.column === 2), "mapped KPI without a figure stays");
  assert.ok(!f.links.some((l) => l.target === "kpi:S2"));
  assert.ok(!f.nodes.some((n) => n.id === "kpi:UNMAPPED"));
  assert.ok(!f.nodes.some((n) => n.id === "disc:GRI:999"));
  const counts = f.links.filter((l) => l.measure === "count");
  assert.equal(counts.length, 4);
  assert.ok(counts.every((l) => l.value === 1));
  assert.equal(flowTotal(f, "disc:BRSR:P6-E7", "in", "count"), 2);
  assert.equal(counts.find((l) => l.source === "kpi:EN").fit, "derived");
  assert.equal(f.nodes.filter((n) => n.id === "disc:BRSR:P6-E7").length, 1, "a disclosure node once");
  assert.ok(f.nodes.filter((n) => n.kind === "disclosure").every((n) => n.column === 3));
});

test("KPI off: categories in column 2 from their scope, zero totals left out", () => {
  const f = flowGraph({
    sites,
    categories: [
      { category_id: 1, name: "Combustion", scope: 1, total: 140 },
      { category_id: 2, name: "Electricity", scope: 2, total: 50 },
      { category_id: 7, name: "Empty", scope: 3, total: 0 },
    ],
  });
  assert.deepEqual(f.nodes.filter((n) => n.column === 2).map((n) => [n.id, n.kind]), [["cat:1", "category"], ["cat:2", "category"]]);
  assert.equal(flowTotal(f, "scope:2", "out"), flowTotal(f, "scope:2", "in"));
  assert.ok(!f.nodes.some((n) => n.column === 3));
});
