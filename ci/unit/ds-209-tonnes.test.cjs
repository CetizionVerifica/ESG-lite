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

// #209 review: `display` (sources/format.ts, Intl) and the renderer's own labels and cells
// (render/format.ts) must print the same tCO₂e text. Intl rounds half away from zero on the
// number's shortest decimal form (String(v)); the renderer has to do the same, not
// Math.round on the float (33102.0885 × 1000 = 33102088.4999… would give .088).
test("rounding parity: the renderer prints every half-way tCO₂e value as sources/format.ts does", () => {
  let seed = 209;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const values = [33102.0885, 262682.8415, 1.0005, 0.0005, 9.9995, 999999.9995, 2.5e-4, 1e21, 1.2345678901234567e25, 1.5e-7, 5e-4, 4.9999e-4];
  for (const mag of [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e9, 1e12]) {
    for (let i = 0; i < 400; i++) {
      const int = rnd(mag);
      const dec = String(rnd(1000)).padStart(3, "0");
      values.push(Number(`${int}.${dec}5`), Number(`${int}.${dec}4999`), Number(`${int}.${dec}50001`), Number(`${int}.${dec}`));
    }
  }
  let mismatches = [];
  for (const v of values) {
    for (const x of [v, -v]) {
      for (const u of ["tCO₂e", "tCO2e"]) {
        const want = SRC.formatNumber(x, "auto", u);
        const got = RF.formatNumber(x, "auto", u);
        if (want !== got) mismatches.push(`${x} ${u}: sources ${want} renderer ${got}`);
      }
    }
  }
  assert.ok(values.length > 16000, String(values.length));
  assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} of ${values.length * 4} differ`);
  // The cases from the review, and exponent forms.
  assert.equal(RF.formatNumber(33102.0885, "auto", "tCO₂e"), "33,102.089");
  assert.equal(RF.formatNumber(262682.8415, "auto", "tCO₂e"), "262,682.842");
  assert.equal(RF.formatNumber(1e21, "auto", "tCO₂e"), "1,000,000,000,000,000,000,000.000");
  assert.equal(RF.formatNumber(1.5e-7, "auto", "tCO₂e"), "0.000");
  assert.equal(RF.formatNumber(-1.5e-7, "auto", "tCO₂e"), "0.000", "a value that rounds to zero has no sign");
  assert.equal(RF.formatNumber(-0.0005, "auto", "tCO₂e"), "−0.001");
  assert.equal(RF.formatNumber(999.9995, "auto", "tCO₂e"), "1,000.000", "a carry into the integer part");
  // The other formats round the same way (1.005 is 1.00499999999999989… as a float).
  assert.equal(RF.formatNumber(1.005, "2dp"), "1.01");
  assert.equal(RF.formatNumber(1.005, "2dp"), SRC.formatNumber(1.005, "2dp"));
  assert.equal(RF.formatNumber(0.5, "int"), "1");
  assert.equal(RF.formatNumber(2.5e21, "int"), "2,500,000,000,000,000,000,000");
});

// #209 review: each series carries its own unit. A KPI binding mixes KPIs in different canonical
// units (one series per KPI; value.unit is the first KPI's), and a GHG gas breakdown sends tonnes
// of each gas while value.unit is tCO₂e. Labels, legends, table cells and stacked totals print
// by the series' unit, falling back to value.unit only when the series has none.
const NUMS = require(path.resolve("dist/studio/checks/numbers.js"));
const sv = (label, unit, pairs) => ({ ...ser(label, pairs), ...(unit === undefined ? {} : { unit }) });
const ghgS = sv("GHG Scope 1 + 2", "tCO2e", [["2024", 3220], ["2025", 2980]]);
const waterS = sv("Water withdrawn", "kL", [["2024", 45500], ["2025", 41200]]);
const shareS = sv("Share of renewable energy", "%", [["2024", 26.5], ["2025", 38]]);
const chartOf = (kind, v, options = {}) => R.chartRenderer(kind)({ value: { display: "", source: "kpi", ...v }, w: 400, h: 220, theme: R.buildTheme({}), options, label: kind });
const svgTexts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const rowsOf = (h) => [...h.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1])).filter((r) => r.length);

test("per-series units: seriesUnit and sharedUnit", () => {
  assert.equal(RF.seriesUnit({ unit: "kL" }, "tCO2e"), "kL", "the series' own unit wins");
  assert.equal(RF.seriesUnit({}, "tCO2e"), "tCO2e", "absent: the bound value's unit");
  assert.equal(RF.seriesUnit({ unit: null }, "tCO2e"), null, "null: no unit");
  assert.equal(RF.seriesUnit(null, "kWh"), "kWh");
  assert.equal(RF.sharedUnit([ghgS, sv("Scope 3", "tCO₂e", [])], "kL"), "tCO2e", "tonnes in either spelling sum as tonnes");
  assert.equal(RF.sharedUnit([waterS, sv("b", "kL", [])], "tCO2e"), "kL");
  assert.equal(RF.sharedUnit([ghgS, waterS], "tCO2e"), null, "a sum across units has none");
  assert.equal(RF.sharedUnit([ghgS, sv("gas", "t", [])], "tCO2e"), null, "tonnes of a gas are not tonnes of CO₂e");
  assert.equal(RF.sharedUnit([sv("x", undefined, []), sv("y", undefined, [])], "tCO₂e"), "tCO₂e");
  assert.equal(RF.sharedUnit([], "tCO₂e"), "tCO₂e");
});

test("per-series units: a mixed KPI table formats each row in its own unit, whichever KPI is first", () => {
  for (const [series, unit] of [[[ghgS, waterS, shareS], "tCO2e"], [[waterS, ghgS, shareS], "kL"], [[shareS, waterS, ghgS], "%"]]) {
    const t = TABLE.tableFromValue({ display: "", value: 0, unit, series });
    assert.deepEqual(t.units, series.map((s) => s.unit));
    assert.equal(t.unit, null, "the rows share no unit");
    const rows = Object.fromEntries(rowsOf(TABLE.tableHtml(t.columns, t.rows, "lined", false, {}, t.units)).map((r) => [r[0], r.slice(1)]));
    assert.deepEqual(rows["GHG Scope 1 + 2"], ["3,220.000", "2,980.000"], `first: ${series[0].label}`);
    assert.deepEqual(rows["Water withdrawn"], ["45,500", "41,200"], `first: ${series[0].label}`);
    assert.deepEqual(rows["Share of renewable energy"], ["26.5", "38"], `first: ${series[0].label}`);
  }
  // Rendered through the table element too (bound value lookup, picked columns keep row units).
  const kb = { source: "kpi", kpis: ["WATER_WITHDRAWAL", "GHG_SCOPE1_2"], years: { last: 2 }, sites: "all" };
  const page = { id: "p", kind: "freeform", name: "x", background: {}, elements: [el("t.mixed", "table", { x: 10, y: 10, w: 120, h: 30 }, { binding: kb, style: "lined", totalRow: false, columns: ["2025"] })] };
  const out = R.renderSheet(page, { ...doc, kind: "sustainability", pages: [page] }, R.renderData([kb], [], { values: [{ display: "41,200", value: 41200, unit: "kL", source: "kpi", series: [waterS, ghgS] }] }), { mode: "sheet" }).html;
  assert.deepEqual(rowsOf(out), [["Water withdrawn", "41,200"], ["GHG Scope 1 + 2", "2,980.000"]]);
  // A series without its own unit still takes the bound value's (DS-1 single-KPI bindings).
  assert.deepEqual(TABLE.tableFromValue({ unit: "tCO₂e", series: two }).units, ["tCO₂e"]);
});

test("per-series units: chart labels follow the series; a stacked total only when every part is tonnes", () => {
  // One series in kL under a binding whose unit says tCO2e: the series wins.
  const one = svgTexts(chartOf("bar", { value: 41200, unit: "tCO2e", series: [waterS] }));
  assert.ok(one.includes("41,200") && one.includes("45,500"), one.join(" | "));
  assert.ok(!one.some((t) => /\.\d{3}$/.test(t)), one.join(" | "));
  // Stacked: tonnes + tonnes (two spellings) → 3 decimals; tonnes + kL → auto.
  const tonnes = svgTexts(chartOf("stacked_bar", { value: 0, unit: "kL", series: [ghgS, sv("Scope 3", "tCO₂e", [["2024", 100], ["2025", 120.5]])] }));
  assert.ok(tonnes.includes("3,320.000") && tonnes.includes("3,100.500"), tonnes.join(" | "));
  const mixed = svgTexts(chartOf("stacked_bar", { value: 0, unit: "tCO2e", series: [ghgS, waterS] }));
  assert.ok(mixed.includes("48,720") && mixed.includes("44,180"), mixed.join(" | "));
  assert.ok(!mixed.some((t) => /\.\d{3}$/.test(t)), mixed.join(" | "));
  // Waterfall and target bars read their (first) series' unit.
  const wf = svgTexts(chartOf("waterfall", { value: 0, unit: "tCO2e", series: [sv("Water", "kL", [["2024", 45500], ["Saved", -4300], ["2025", 41200]])] }));
  assert.ok(wf.includes("45,500") && wf.includes("−4,300") && wf.includes("41,200"), wf.join(" | "));
  const tb = svgTexts(chartOf("target_bars", { value: 41200, unit: "tCO2e", series: [waterS], target: { baseline: 50000, value: 30000, year: 2030 } }));
  assert.ok(tb.includes("41,200") && !tb.some((t) => /\.\d{3}$/.test(t)), tb.join(" | "));
  // And a tonnes series under a kL value prints 3 decimals.
  const t2 = svgTexts(chartOf("target_bars", { value: 2980, unit: "kL", series: [ghgS] }));
  assert.ok(t2.includes("2,980.000"), t2.join(" | "));
  // Donut fallback total (no display): the parts' shared unit.
  const dn = svgTexts(chartOf("donut", { value: null, unit: "tCO₂e", series: [sv("2025", "t", [["CO₂", 8350], ["CH₄", 19.8]])] }));
  assert.ok(dn.includes("8,370"), dn.join(" | "));
  const dt = svgTexts(chartOf("donut", { value: null, unit: "kL", series: [sv("2025", "tCO2e", [["Scope 1", 3410], ["Scope 2", 5800.25]])] }));
  assert.ok(dt.includes("9,210.250"), dt.join(" | "));
});

test("per-series units: a GHG gas breakdown is tonnes of each gas: labels, legend and table keep auto", () => {
  const gas = { value: 12480, unit: "tCO₂e", source: "ghg", display: "12,480.000", series: [sv("2024", "t", [["CO₂", 8600], ["CH₄", 21.4], ["N₂O", 3.1]]), sv("2025", "t", [["CO₂", 8350], ["CH₄", 19.8], ["N₂O", 2.9]])] };
  const g = svgTexts(chartOf("gas_split", gas));
  for (const s of ["8,350", "19.8", "2.9"]) assert.ok(g.includes(s), `${s} in ${g.join(" | ")}`);
  assert.ok(!g.some((t) => /^[\d,]+\.\d{3}$/.test(t)), g.join(" | "));
  assert.ok(g.includes("Total emissions 12,480.000 tCO₂e"), "the headline is the server's tCO₂e display");
  const t = TABLE.tableFromValue(gas);
  assert.deepEqual(rowsOf(TABLE.tableHtml(t.columns, t.rows, "lined", false, {}, t.units)), [["2024", "8,600", "21.4", "3.1"], ["2025", "8,350", "19.8", "2.9"]]);
  // Without the series unit (an older resolve) the binding's tCO₂e applies, as before.
  const old = svgTexts(chartOf("gas_split", { ...gas, series: gas.series.map(({ unit, ...s }) => s) }));
  assert.ok(old.includes("19.800"), old.join(" | "));
  // Ranked bars, treemap, scope legend and the intensity line read the current series' unit too.
  const cats = { value: 3270, unit: "tCO₂e", display: "3,270.000", series: [sv("2025", "kL", [["A", 1290], ["B", 620]])] };
  assert.ok(svgTexts(chartOf("category_bars", cats)).includes("1,290"));
  assert.ok(svgTexts(chartOf("scope_split", { ...cats, series: [sv("2025", "kL", [["Scope 1", 3410], ["Scope 2", 5800]])] })).includes("Scope 1 3,410"));
  assert.ok(svgTexts(chartOf("treemap", { ...cats, display: "" }, {})).some((x) => x.startsWith("1,290 ·")));
  assert.ok(svgTexts(chartOf("intensity_line", { value: 2, unit: "kL", series: [sv("x", "tCO2e", [["2024", 1], ["2025", 2]])] })).includes("2.000"));
  // The base-year bridge: the unit both years share.
  const br = svgTexts(chartOf("base_year_waterfall", { value: 2980, unit: "kL", series: [sv("2022", "tCO2e", [["Scope 1", 3900]]), sv("2025", "tCO2e", [["Scope 1", 2980]])] }));
  assert.ok(br.includes("3,900.000") && br.includes("−920.000"), br.join(" | "));
});

test("per-series units: number-check candidates take a series' own unit", () => {
  const binding = { source: "kpi", kpis: ["GHG_SCOPE1_2", "WATER_WITHDRAWAL"], years: { last: 2 }, sites: "all" };
  const r = { source: "kpi", display: "2,980.000", value: 2980, unit: "tCO2e", series: [ghgS, waterS] };
  const c = NUMS.numberCandidates({ doc: { meta: { frameworks: [] } }, ix: { bindings: [{ idx: 0, binding }], tokens: [] }, resolved: { values: [r], tokens: [] }, inputs: {} });
  const unitOf = (v) => c.filter((x) => x.value === v && x.ref?.kind === "binding" && x.unit !== "%").map((x) => x.unit);
  assert.deepEqual(unitOf(41200), ["kL"]);
  assert.deepEqual(unitOf(3220), ["tCO2e"]);
});

test("per-series units: a series' unit is not data, so stored data hashes stay valid", () => {
  const H = require(path.resolve("dist/studio/sources/hash.js"));
  const base = { source: "kpi", display: "2,980.000", value: 2980, unit: "tCO2e", series: [ser("GHG", [["2025", 2980]]), ser("Water", [["2025", 41200]])] };
  const withUnits = { ...base, series: [{ ...base.series[0], unit: "tCO2e" }, { ...base.series[1], unit: "kL" }] };
  const args = (v) => ({ year: 2025, yearType: "CY", siteIds: [1], values: [v], inputs: {} });
  assert.equal(H.dataHash(args(withUnits)), H.dataHash(args(base)));
  assert.equal(H.elementHash([withUnits]), H.elementHash([base]));
  assert.notEqual(H.dataHash(args({ ...withUnits, series: [withUnits.series[0]] })), H.dataHash(args(base)), "the series' values still count");
});
