// #209 follow-up · tCO₂e figures the Design Studio draws show exactly 3 decimals.
//   - render/format.ts: isTonnesCo2e folds every spelling of tonnes of CO₂e (and no other unit);
//     formatNumber(v, "auto", unit) prints TONNES_DP decimals for it, a picked format still wins,
//     axis ticks keep `auto`; TONNES_DP is emissionWrite's;
//   - charts: value labels and legend values of a tCO₂e binding, never of a per-unit intensity,
//     an energy figure or custom data;
//   - tables: series cells of a tCO₂e binding; source-formatted, custom and static tables keep
//     `auto`; flow (data_tables) rows by their own unit;
//   - layout helpers that keep a longer label inside the chart;
//   - DS-2 sources/format.ts: the KPI canonical "tCO2e" counts as tonnes too.
//   npm run build && node --test ci/unit/ds-209-tonnes.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const RF = require(path.resolve("dist/reporting/studio/render/format.js"));
const SVG = require(path.resolve("dist/reporting/studio/render/charts/svg.js"));
const FLOW = require(path.resolve("dist/reporting/studio/render/flow/index.js"));
const TABLE = require(path.resolve("dist/reporting/studio/render/elements/table.js"));
const SRC = require(path.resolve("dist/studio/sources/format.js"));
const { TONNES_DP } = require(path.resolve("dist/services/emissionWrite/round.js"));
const { normaliseUnit, KPI_ALIASES } = require(path.resolve("dist/kpi/values/units.js"));

const TONNES = ["tCO₂e", "tCO2e", "TCO2E", "tco2e", "t CO2e", "t CO₂e", "tonnes CO₂e", "tonne CO2e", "Tonnes CO2e", "metric tonnes CO2e", "tCO2-e", "t-CO2e", "tCO2eq", "tCO₂eq"];
const NOT_TONNES = [null, undefined, "", "kgCO2e", "kg CO₂e", "ktCO2e", "MtCO2e", "t CO₂", "tCO2", "t", "tonnes", "kWh", "GJ", "kL", "%", "tCO₂e per employee", "tCO2e per INR crore", "tCO₂e/t", "tCO₂e per unit of revenue", "CO2e"];

test("isTonnesCo2e: every spelling of tonnes of CO₂e, and nothing else", () => {
  for (const u of TONNES) assert.equal(RF.isTonnesCo2e(u), true, u);
  for (const u of NOT_TONNES) assert.equal(RF.isTonnesCo2e(u), false, String(u));
  // Every spelling the KPI units registry reads as tonnes of CO₂e is tonnes here too.
  const kpiSpellings = Object.entries(KPI_ALIASES).filter(([, to]) => to === "tco2e").map(([from]) => from);
  assert.ok(kpiSpellings.length >= 3, "KPI aliases of tco2e");
  for (const u of [...kpiSpellings, "tCO2e"]) {
    assert.equal(normaliseUnit(u), "tco2e", u);
    assert.equal(RF.isTonnesCo2e(u), true, u);
  }
});

test("formatNumber: a tCO₂e figure on auto has exactly 3 decimals; other units keep auto", () => {
  assert.equal(RF.TONNES_DP, TONNES_DP, "the renderer's decimals are emissionWrite's");
  assert.equal(TONNES_DP, 3);
  const cases = [
    [1234.567, "1,235", "1,234.567"],
    [12.345, "12.3", "12.345"],
    [0.0456, "0.05", "0.046"],
    [-1420, "−1,420", "−1,420.000"],
    [13900, "13,900", "13,900.000"],
    [0, "0", "0.000"],
    [2.9, "2.9", "2.900"],
  ];
  for (const [v, auto, tonnes] of cases) {
    assert.equal(RF.formatNumber(v), auto, `${v} without a unit`);
    assert.equal(RF.formatNumber(v, "auto", "kWh"), auto, `${v} kWh`);
    assert.equal(RF.formatNumber(v, "auto", "tCO₂e per employee"), auto, `${v} intensity`);
    for (const u of ["tCO₂e", "tCO2e", "t CO2e"]) assert.equal(RF.formatNumber(v, "auto", u), tonnes, `${v} ${u}`);
  }
  // A format someone picked wins over the unit.
  assert.equal(RF.formatNumber(1234.567, "int", "tCO₂e"), "1,235");
  assert.equal(RF.formatNumber(1234.567, "1dp", "tCO₂e"), "1,234.6");
  assert.equal(RF.formatNumber(1234.567, "compact", "tCO₂e"), "1.2k");
  assert.equal(RF.formatNumber(null, "auto", "tCO₂e"), "–");
  assert.equal(RF.formatNumber(Number.NaN, "auto", "tCO₂e"), "–");
});


// One sheet: a chart and a table per unit, plus custom, static and source-formatted tables.
const ghg = (metric) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all" });
const B = { t: ghg("total"), kpi: ghg("scope1"), i: ghg("intensity_revenue"), e: ghg("scope2_location"), src: ghg("scope3"), multi: ghg("total_by_scope") };
const custom = { source: "custom", columns: ["Initiative", "Saved"], rows: [["LED retrofit", 1234.567], ["Solar PPA", 12.345]] };
const ser = (label, pairs) => ({ label, values: pairs.map(([key, value]) => ({ key, value })) });
const two = [ser("2025", [["Site A", 1234.567], ["Site B", 12.345]])];
const value = (unit, extra = {}) => ({ display: "1,246.912", value: 1246.912, unit, source: "ghg", approvedAt: "2026-04-12T09:30:00.000Z", series: two, ...extra });
let z = 0;
const el = (id, type, frame, props) => ({ id, type, frame: { rotation: 0, ...frame }, z: z++, source: "user", props });
const doc = {
  schemaVersion: 2, kind: "ghg", purpose: "report", format: "a4",
  meta: { title: "#209", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], language: "en" },
  design: { templateId: "ghg-inventory", templateVersion: 1, theme: { look: "classic" } },
  pages: [{
    id: "p", kind: "freeform", name: "209", background: {},
    elements: [
      el("c.tonnes", "chart", { x: 10, y: 10, w: 90, h: 50 }, { binding: B.t, kind: "bar", options: {} }),
      el("c.kpi", "chart", { x: 110, y: 10, w: 90, h: 50 }, { binding: B.kpi, kind: "bar", options: { horizontal: true } }),
      el("c.intensity", "chart", { x: 10, y: 70, w: 90, h: 50 }, { binding: B.i, kind: "bar", options: {} }),
      el("c.energy", "chart", { x: 110, y: 70, w: 90, h: 50 }, { binding: B.e, kind: "bar", options: {} }),
      el("c.custom", "chart", { x: 10, y: 130, w: 90, h: 40 }, { binding: custom, kind: "bar", options: {} }),
      el("c.scopes", "chart", { x: 110, y: 130, w: 90, h: 40 }, { binding: B.multi, kind: "scope_split", options: {} }),
      el("t.tonnes", "table", { x: 10, y: 180, w: 90, h: 25 }, { binding: B.t, style: "lined", totalRow: false }),
      el("t.energy", "table", { x: 110, y: 180, w: 90, h: 25 }, { binding: B.e, style: "lined", totalRow: false }),
      el("t.source", "table", { x: 10, y: 210, w: 90, h: 25 }, { binding: B.src, style: "lined", totalRow: false }),
      el("t.custom", "table", { x: 110, y: 210, w: 90, h: 25 }, { binding: custom, style: "lined", totalRow: false }),
      el("t.own", "table", { x: 10, y: 240, w: 90, h: 25 }, { columns: ["Site", "tCO₂e"], rows: [["Manama", 1234.567], ["Sitra", 12.345]], style: "minimal", totalRow: false }),
    ],
  }],
  assets: [],
};
const pairs = [
  [B.t, value("tCO₂e")],
  [B.kpi, value("tCO2e")],
  [B.i, value("tCO₂e per unit of revenue")],
  [B.e, value("kWh")],
  // The source's own table arrives formatted; a number in it keeps auto.
  [B.src, value("tCO₂e", { series: undefined, table: { columns: ["Category", "2025"], rows: [["1 · Purchased goods", 1234.567], ["4 · Upstream", 12.345]] } })],
  [B.multi, value("tCO₂e", { series: [ser("2025", [["Scope 1", 3410], ["Scope 2", 5800], ["Scope 3", 3270.25]])] })],
];
const html = R.renderSheet(doc.pages[0], doc, R.renderData(pairs.map((p) => p[0]), [], { values: pairs.map((p) => p[1]) }), { mode: "sheet" }).html;
const part = (id) => {
  const at = html.indexOf(`data-el-id="${id}"`);
  assert.ok(at >= 0, `${id} is drawn`);
  const next = html.indexOf('data-el-id="', at + 12);
  return html.slice(at, next < 0 ? html.length : next);
};
const texts = (id) => [...part(id).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const cells = (id) => [...part(id).matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);

test("chart value labels: 3 decimals for a tCO₂e binding (either spelling), auto for anything else", () => {
  for (const id of ["c.tonnes", "c.kpi"]) {
    assert.ok(texts(id).includes("1,234.567"), `${id}: ${texts(id).join(" | ")}`);
    assert.ok(texts(id).includes("12.345"), id);
  }
  for (const id of ["c.intensity", "c.energy", "c.custom"]) {
    assert.ok(texts(id).includes("1,235"), `${id}: ${texts(id).join(" | ")}`);
    assert.ok(texts(id).includes("12.3"), id);
    assert.ok(!texts(id).some((t) => /\d\.\d{3}\b/.test(t)), `${id} has no 3-decimal label`);
  }
});

test("axis ticks keep auto: they are scale marks, not figures", () => {
  assert.deepEqual([0, 500, 1000, 12.5, 20000].map(RF.tickLabel), ["0", "500", "1,000", "12.5", "20k"]);
  const t = texts("c.tonnes");
  assert.deepEqual(t.filter((x) => /\.\d{3}$/.test(x)), ["1,234.567", "12.345"], "only the value labels have 3 decimals");
  assert.ok(t.filter((x) => /^[\d,]+$/.test(x)).length >= 2, `ticks: ${t.join(" | ")}`);
});

test("legend values of a tCO₂e chart have 3 decimals; the headline is the server's display", () => {
  const t = texts("c.scopes");
  for (const s of ["Scope 1 3,410.000", "Scope 2 5,800.000", "Scope 3 3,270.250"]) assert.ok(t.includes(s), `${s} in ${t.join(" | ")}`);
  assert.ok(t.some((x) => x.includes("1,246.912")), `the server's display: ${t.join(" | ")}`);
});

test("table cells: a bound tCO₂e series has 3 decimals; source-formatted, custom and static tables keep auto", () => {
  assert.deepEqual(cells("t.tonnes").slice(-2), ["1,234.567", "12.345"]);
  assert.deepEqual(cells("t.energy").slice(-2), ["1,235", "12.3"]);
  const nums = (id) => cells(id).filter((c) => /^[\d,.]+$/.test(c));
  assert.deepEqual(nums("t.source"), ["1,235", "12.3"]);
  assert.deepEqual(nums("t.custom"), ["1,235", "12.3"]);
  assert.deepEqual(nums("t.own"), ["1,235", "12.3"]);
  // tableFromValue carries the unit of series cells only.
  assert.equal(TABLE.tableFromValue({ unit: "tCO₂e", series: two }).unit, "tCO₂e");
  assert.equal(TABLE.tableFromValue({ unit: "tCO₂e", table: { columns: ["a"], rows: [] } }).unit, null);
  assert.match(TABLE.tableHtml(["", "x"], [["a", 1234.567]], "lined", false, {}, "tCO2e"), />1,234\.567</);
  assert.match(TABLE.tableHtml(["", "x"], [["a", 1234.567]], "lined", false), />1,235</);
});

test("flow (data_tables) rows print in their own unit", () => {
  const out = FLOW.flowTableHtml({
    columns: ["Line", "2025", "2024"],
    rows: [
      { cells: ["Scope 1", 1234.567, null], unit: "tCO₂e" },
      { cells: ["Scope 2", 12.345, 0], unit: "tCO2e" },
      { cells: ["Energy", 1234.567, 12.345], unit: "kWh" },
      { cells: ["Other", 1234.567, 12.345] },
    ],
  });
  const tds = [...out.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(tds, ["Scope 1", "1,234.567", "–", "Scope 2", "12.345", "0.000", "Energy", "1,235", "12.3", "Other", "1,235", "12.3"]);
});

test("layout: a longer label stays inside the chart; one that fits stays where it was", () => {
  const S = SVG.SMALL;
  assert.ok(SVG.labelWidth("1,234.567") > SVG.labelWidth("1,235"));
  assert.equal(SVG.labelWidth("1,234.567"), (7 * 0.6 + 2 * 0.3) * S);
  // insideX: centred labels near an edge move in; a centred one does not move; wider than the chart → centre.
  const w = 100;
  const half = SVG.labelWidth("1,234.567") / 2;
  assert.equal(SVG.insideX(50, "1,234.567", w), 50);
  assert.equal(SVG.insideX(2, "1,234.567", w), half);
  assert.equal(SVG.insideX(99, "1,234.567", w), w - half);
  assert.equal(SVG.insideX(3, "1,234,567,890.000", 10), 5);
  // fitBarEnds: the plot keeps its width when every end label fits, narrows just enough when one
  // would be cut, never below 60 %.
  assert.equal(SVG.fitBarEnds(60, 20, 100, [{ t: 1, label: "12" }]), 60);
  const fit = SVG.fitBarEnds(90, 20, 140, [{ t: 1, label: "1,234.567" }, { t: 0.5, label: "12.345" }]);
  assert.ok(fit < 90 && fit >= 54, String(fit));
  assert.ok(Math.abs(20 + fit + S * 0.4 + SVG.labelWidth("1,234.567") - 140) < 1e-9, "the longest bar's label ends at the chart's edge");
  assert.equal(SVG.fitBarEnds(70, 20, 30, [{ t: 1, label: "1,234.567" }]), 42, "never below 60 %");
  assert.equal(SVG.fitBarEnds(70, 20, 100, [{ t: 0, label: "1,234.567" }]), 70, "a zero bar does not narrow the plot");
});

test("DS-2 sources/format.ts: the KPI canonical tCO2e is tonnes too; a picked format wins", () => {
  for (const u of ["tCO₂e", "tCO2e", "t CO2e", "tonnes CO2e"]) {
    assert.equal(SRC.formatNumber(1234.567, "auto", u), "1,234.567", u);
    assert.equal(SRC.formatNumber(15, "auto", u), "15.000", u);
    assert.equal(SRC.formatChangeAbs(20, "auto", u), "+20.000", u);
  }
  assert.equal(SRC.formatNumber(1500, "auto", "kL"), "1,500");
  assert.equal(SRC.formatNumber(41.6, "auto", "tCO₂e per unit of revenue"), "41.6");
  assert.equal(SRC.formatNumber(1234.567, "int", "tCO2e"), "1,235");
  assert.equal(SRC.formatNumber(1234.567, "2dp", "tCO2e"), "1,234.57");
});
