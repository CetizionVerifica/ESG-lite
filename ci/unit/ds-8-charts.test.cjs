// DS-8 charts and tables (pure renderer + contracts):
//   - every GHG chart kind is registered and draws its fixture (goldens in
//     ci/golden/ds/render/ghg-snapshots.json, per element and per mode);
//   - labelling: the total from the server's display, only the biggest parts labelled;
//   - kind validity per binding, and each kind's default binding is valid for it;
//   - the base-year bridge, squarified treemap and monthly stacks add up;
//   - typed data: "Unlinked data" badge in the editor sheet only, reserved labels, UNLINKED_DATA list;
//   - tables: column widths, merged cells (static only), columns picked from a bound table;
//   - contracts accept the new chart options and table layout.
//   npm run build && node --test ci/unit/ds-8-charts.test.cjs
//   UPDATE_SNAPSHOT=1 node --test ci/unit/ds-8-charts.test.cjs   # after an intended change
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const C = require(path.resolve("dist/studio/contracts/index.js"));
const G = require(path.resolve("ci/golden/ds/render/ghg-charts.cjs"));

const built = G.build(R);
const el = (id) => built.elements[id];
const count = (s, re) => (s.match(re) || []).length;

test("every GHG chart kind is registered and draws a chart from DS-2-shaped data", () => {
  for (const k of R.GHG_CHART_KINDS) assert.ok(R.chartRenderer(k), k);
  assert.deepEqual([...R.GHG_CHART_KINDS].sort(), C.CHART_KINDS.filter((k) => !R.RS_CHART_KINDS.includes(k)).sort());
  for (const [id, html] of Object.entries(built.elements)) {
    if (id === "g.custom") continue;
    assert.doesNotMatch(html, /data-chart-unsupported|No data|Not reported/, id);
    const kind = /data-chart-kind="([^"]+)"/.exec(html)[1];
    assert.match(html, new RegExp(`data-ghg-chart="${kind}"`), id);
    assert.match(html, /<svg [^>]*role="img"/, id);
  }
  const d = G.doc();
  const kinds = new Set(d.pages[0].elements.map((e) => e.props.kind));
  for (const k of R.GHG_CHART_KINDS) assert.ok(kinds.has(k), `fixture lacks ${k}`);
  assert.ok(C.ReportDocSchema.safeParse(d).success, "the GHG fixture is a valid ReportDoc");
});

test("goldens: each GHG chart's HTML and the page in every mode match ghg-snapshots.json", () => {
  if (process.env.UPDATE_SNAPSHOT) {
    fs.writeFileSync(G.SNAPSHOT, JSON.stringify(built, null, 2) + "\n");
    fs.writeFileSync(G.FIXTURE, JSON.stringify(G.fixtureJson(R), null, 2) + "\n");
  }
  const want = JSON.parse(fs.readFileSync(G.SNAPSHOT, "utf8"));
  assert.equal(want.renderHash, R.RENDER_HASH, "snapshot was written by another RENDER_HASH: run sync, then UPDATE_SNAPSHOT=1");
  for (const id of Object.keys(want.elements)) assert.equal(built.elements[id], want.elements[id], `element ${id}`);
  assert.deepEqual(Object.keys(built.elements).sort(), Object.keys(want.elements).sort());
  assert.deepEqual(built.modes, want.modes);
  assert.deepEqual(JSON.parse(fs.readFileSync(G.FIXTURE, "utf8")), JSON.parse(JSON.stringify(G.fixtureJson(R))), "ghg-fixture.json is current");
});

test("labelling: totals come from display; only the three biggest parts carry a value", () => {
  const cats = el("g.category_bars");
  assert.match(cats, />Total 3,270 tCO₂e</);
  // 9 bars, 3 value labels (1,290, 620, 410: tCO₂e, so 3 decimals, #209), sorted largest first, "Other" last.
  assert.equal(count(cats, /data-part="/g), 9);
  for (const n of ["1,290.000", "620.000", "410.000"]) assert.match(cats, new RegExp(`>${n}<`));
  for (const n of ["300", "210", "180"]) assert.doesNotMatch(cats, new RegExp(`>${n}(\\.000)?<`));
  const parts = [...cats.matchAll(/data-part="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(parts[0], "1 · Purchased goods and services");
  assert.equal(parts[parts.length - 1], "Other");
  // The prior year sits under each bar in the theme's prior grey.
  const prior = el("g.category_prior");
  assert.equal(count(prior, /data-prior="2024"/g), 6);
  assert.match(prior, /fill="#B8C0CC" data-prior/);
  // scope_split: shares add to 100 %, the Scope 2 basis note is on unless switched off.
  const split = el("g.scope_split");
  const shares = [...split.matchAll(/>(\d+(?:\.\d)?)%</g)].map((m) => Number(m[1]));
  assert.equal(shares.length, 3);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 100) <= 1.5, String(shares));
  assert.match(split, new RegExp(R.SCOPE2_BASIS_NOTE.replace(/[.']/g, (c) => (c === "'" ? "(?:'|&#39;)" : "\\."))));
  assert.match(split, /fill="#1F6FEB"[^>]*data-part="Scope 1"/, "scope colours by default");
  assert.doesNotMatch(el("g.scope_donut"), /location-based/);
  assert.match(el("g.scope_donut"), /data-variant="donut"/);
  // The donut uses the current year (the last series), not a sum of years.
  assert.match(el("g.scope_donut"), />12,480</);
  // site_bars in brand colours.
  assert.match(el("g.site_bars"), /data-part="Manama plant"/);
  assert.doesNotMatch(el("g.site_bars"), /#8B5CF6/);
  // Gas figures are tonnes of each gas, said under the chart.
  assert.match(el("g.gas_split"), /Tonnes of each gas, not CO₂e\./);
  assert.equal(count(el("g.gas_split"), /data-year="2024"/g), 3);
  // #209 review: so their labels follow the series' unit ("t", each gas), not the binding's tCO₂e.
  for (const n of ["8,350", "19.8", "2.9"]) assert.match(el("g.gas_split"), new RegExp(`>${n}<`));
  assert.doesNotMatch(el("g.gas_split"), />[\d,]+\.\d{3}</);
});

test("monthly_stack: months stacked by scope, only the peak month labelled", () => {
  const m = el("g.monthly_stack");
  assert.match(m, /data-stacks="3" data-keys="12"/);
  assert.equal(count(m, /data-key="2025-/g), 36);
  // Peak: January 310+520+300 = 1,130 (tCO₂e: 3 decimals, #209).
  assert.match(m, />1,130\.000</);
  assert.equal(count(m, /font-weight="700"/g), 2, "the total line and the peak only");
  for (const mon of ["Jan", "Jul", "Dec"]) assert.match(m, new RegExp(`>${mon}<`));
  const q = el("g.monthly_plain");
  assert.match(q, /data-stacks="1" data-keys="4"/);
  // Without stacks it draws the current year's months as single bars.
  const noStacks = R.chartRenderer("monthly_stack")({ value: { display: "1", value: 1, unit: null, series: [{ label: "2025", values: [{ key: "2025-01", value: 1 }, { key: "2025-02", value: 2 }] }] }, w: 200, h: 120, theme: R.buildTheme({}), options: {}, label: "x" });
  assert.match(noStacks, /data-stacks="1" data-keys="2"/);
});

test("base-year bridge: base → Δ by scope → current; the compare and by-year forms", () => {
  const steps = R.bridgeSteps({ display: "", value: 12480, unit: null, series: [{ label: "2022", values: [{ key: "Scope 1", value: 3900 }, { key: "Scope 2", value: 6600 }, { key: "Scope 3", value: 3400 }] }, { label: "2025", values: [{ key: "Scope 1", value: 3410 }, { key: "Scope 2", value: 5800 }, { key: "Scope 3", value: 3270 }] }] });
  assert.deepEqual(steps.map((s) => s.key), ["2022", "Scope 1", "Scope 2", "Scope 3", "2025"]);
  assert.deepEqual(steps.map((s) => s.kind), ["abs", "down", "down", "down", "abs"]);
  assert.equal(steps[3].to, steps[4].to, "the drivers land on the current total");
  assert.equal(steps[0].to, 13900);
  const w = el("g.base_year_waterfall");
  assert.match(w, />−490\.000</);
  assert.match(w, />13,900\.000</);
  assert.match(w, /data-steps="5"/);
  const c = el("g.bridge_compare");
  assert.match(c, /data-steps="3"/);
  assert.match(c, /data-key="2022"/);
  assert.match(c, />−1,420\.000</);
  const y = R.bridgeSteps({ display: "", value: null, unit: null, series: [{ label: "Total", values: [{ key: "2024", value: 10 }, { key: "2025", value: 12 }] }] });
  assert.deepEqual(y.map((s) => [s.key, s.from, s.to]), [["2024", 0, 10], ["Change", 10, 12], ["2025", 0, 12]]);
  assert.equal(R.bridgeSteps({ display: "", value: null, unit: null, series: [] }), null);
});

test("treemap: squarified tiles fill the box in proportion, without overlap", () => {
  const ps = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ key: `k${i}`, value: v }));
  const tiles = R.squarify(ps, 600, 400);
  assert.equal(tiles.length, 7);
  const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
  assert.ok(Math.abs(area - 240000) < 1e-6);
  for (const t of tiles) {
    assert.ok(Math.abs(t.w * t.h - (t.value / 24) * 240000) < 1e-6, t.key);
    assert.ok(t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= 600 + 1e-6 && t.y + t.h <= 400 + 1e-6, t.key);
  }
  for (let i = 0; i < tiles.length; i++)
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i];
      const b = tiles[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(ox <= 1e-6 || oy <= 1e-6, `${a.key} overlaps ${b.key}`);
    }
  const worst = Math.max(...tiles.map((t) => Math.max(t.w / t.h, t.h / t.w)));
  assert.ok(worst < 4, `aspect ${worst}`);
  assert.deepEqual(R.squarify([{ key: "a", value: 0 }], 10, 10), []);
  const tm = el("g.treemap");
  assert.match(tm, /data-tiles="9"/);
  assert.match(tm, />1,290\.000 · 39%</);
  assert.doesNotMatch(el("g.treemap_brand"), /· \d+%/, "showValues off hides the values");
});

test("kind validity per binding", () => {
  const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
  const ok = (kind, b) => R.chartKindValidity(kind, b).ok;
  const cases = [
    ["scope_split", ghg("total", { breakdown: "scope" }), true],
    ["scope_split", ghg("scope3", { breakdown: "scope3_category" }), false],
    ["category_bars", ghg("scope3", { breakdown: "scope3_category" }), true],
    ["category_bars", ghg("scope3_category", { breakdown: "scope3_category" }), true],
    ["category_bars", ghg("total", { breakdown: "site" }), false],
    ["treemap", ghg("scope3", { breakdown: "scope3_category" }), true],
    ["treemap", ghg("scope1", { breakdown: "source_category" }), true],
    ["treemap", ghg("total", { breakdown: "month" }), false],
    ["gas_split", ghg("scope1", { breakdown: "gas" }), true],
    ["gas_split", ghg("total"), false],
    ["site_bars", ghg("scope2_location", { breakdown: "site" }), true],
    ["site_bars", ghg("intensity_output", { breakdown: "site" }), false],
    ["monthly_stack", ghg("total", { breakdown: "month" }), true],
    ["monthly_stack", ghg("scope2_location", { breakdown: "quarter" }), true],
    ["monthly_stack", ghg("total", { breakdown: "site" }), false],
    ["base_year_waterfall", ghg("total", { breakdown: "scope", years: [2022, 2025] }), true],
    ["base_year_waterfall", ghg("total", { breakdown: "scope" }), false],
    ["base_year_waterfall", ghg("total", { years: { last: 2 }, compare: "base" }), true],
    ["base_year_waterfall", ghg("scope1", { years: { last: 3 } }), false],
    ["intensity_line", ghg("intensity_revenue", { years: { last: 5 } }), true],
    ["intensity_line", ghg("intensity_revenue"), false],
    ["intensity_line", ghg("total", { years: { last: 5 } }), false],
    ["bar", ghg("total", { years: { last: 5 } }), true],
    ["bar", ghg("total"), false],
    ["donut", ghg("total", { breakdown: "scope" }), true],
    ["sparkline", ghg("total", { years: { last: 4 } }), true],
    ["sparkline", ghg("total", { breakdown: "scope" }), false],
    ["target_bars", { source: "kpi", kpis: ["A"], years: { last: 1 }, sites: "all", compare: "target" }, true],
    ["target_bars", ghg("total"), false],
    ["line", { source: "kpi", kpis: ["A"], years: { last: 3 }, sites: "all" }, true],
    ["dot_grid", { source: "kpi", kpis: ["A"], years: { last: 1 }, sites: "all" }, true],
    ["sankey", ghg("total", { breakdown: "scope" }), false],
    ["bar", { source: "custom", columns: ["a", "b"], rows: [["x", 1]] }, true],
    ["bar", { source: "custom", columns: ["a"], rows: [["x"]] }, false],
    ["treemap", { source: "custom", columns: ["a", "b"], rows: [["x", 1]] }, false],
    ["sankey", { source: "custom", columns: ["a", "b"], rows: [["x", 1]] }, false],
    ["bar", { source: "input", key: "responsible_person" }, false],
  ];
  for (const [kind, b, want] of cases) assert.equal(ok(kind, b), want, `${kind} × ${JSON.stringify(b)}`);
  const r = R.chartKindValidity("category_bars", ghg("total", { breakdown: "site" }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Scope 3 by category/);
  assert.equal(R.chartKindValidity("bar", null).ok, false);
  assert.deepEqual(R.validChartKinds(ghg("scope3", { breakdown: "scope3_category", top: 8 })), ["category_bars", "treemap", "bar", "stacked_bar", "line", "donut", "share_bar"]);
  for (const k of R.ALL_CHART_KINDS) assert.ok(C.CHART_KINDS.includes(k), k);
  assert.equal(R.yearCount({ years: [2022, 2025, 2025] }), 2);
});

test("defaults: each GHG kind starts with a valid binding (category_bars → Scope 3, this year, top 8)", () => {
  for (const k of R.GHG_CHART_KINDS) {
    const d = R.defaultGhgChart(k, { year: 2025, baseYear: 2022 });
    assert.ok(R.chartKindValidity(k, d.binding).ok, k);
    assert.ok(C.BindingSchema.safeParse(d.binding).success, `${k}: ${JSON.stringify(d.binding)}`);
    assert.ok(d.title.length > 3, k);
  }
  assert.deepEqual(R.defaultGhgChart("category_bars", { year: 2025 }).binding, { source: "ghg", metric: "scope3", breakdown: "scope3_category", years: { last: 1 }, sites: "all", top: 8 });
  assert.deepEqual(R.defaultGhgChart("base_year_waterfall", { year: 2025, baseYear: 2022 }).binding.years, [2022, 2025]);
  assert.deepEqual(R.defaultGhgChart("base_year_waterfall", { year: 2025 }).binding.years, [2024, 2025]);
  assert.deepEqual(R.defaultGhgChart("base_year_waterfall", { year: 2025, baseYear: 2025 }).binding.years, [2024, 2025]);
});

test("typed data: the Unlinked data badge shows in the editor sheet only, and takes no room", () => {
  const custom = el("g.custom");
  assert.match(custom, /data-source="custom"[^>]*data-unlinked="true"/);
  assert.match(custom, /<span class="ds-unlinked" aria-hidden="true">Unlinked data<\/span>/);
  const d = G.doc();
  const data = G.data(R.renderData);
  const sheetCss = R.renderDocument(d, data, { mode: "sheet" }).css;
  assert.match(sheetCss, /\.ds-unlinked\{display:none;position:absolute;/);
  assert.match(sheetCss, /\.ds-doc--sheet \.ds-unlinked\{display:inline-block;\}/);
  assert.match(sheetCss, /@media print\{\.ds-doc--sheet \.ds-unlinked\{display:none;\}\}/);
  for (const mode of ["paged", "print", "present"]) {
    const r = R.renderDocument(d, data, { mode });
    assert.doesNotMatch(r.css, /\.ds-unlinked\{display:inline-block/, mode);
    assert.match(r.css, /\.ds-unlinked\{display:none;/, mode);
  }
  // Same plot height with or without the badge: the badge is absolutely placed.
  const withBadge = R.renderSheet(d.pages[0], d, data, { mode: "sheet" }).html;
  const plot = /data-el-id="g\.custom"[\s\S]*?viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(withBadge);
  assert.deepEqual([Number(plot[1]), Number(plot[2])], [55 * 4, 30 * 4]);
  // UNLINKED_DATA lists every typed element.
  assert.deepEqual(R.unlinkedElements(d), [{ pageId: "p-ghg", elementId: "g.custom", type: "chart" }]);
  assert.ok(C.CHECK_IDS.includes("UNLINKED_DATA"));
});

test("typed data: GHG and KPI metric names can't be series labels", () => {
  for (const l of ["Scope 1", "scope 3 emissions", "Total emissions", "Total", "tCO2e", "Saved tCO₂e", "CO2", "N₂O", "Biogenic CO₂", "Intensity per revenue", "Base year", "ENV-GHG-S12", "GHG_SCOPE1_2x"].slice(0, 12))
    assert.ok(R.reservedLabel(l), l);
  for (const l of ["Initiative", "Saved", "LED retrofit", "Budget 2026", "", "Scopes of work"]) assert.ok(!R.reservedLabel(l), l);
  assert.ok(R.reservedLabel("Water withdrawal", ["water withdrawal"]), "a company KPI name");
  assert.equal(R.CUSTOM_MAX_ROWS, 200);
  assert.equal(R.CUSTOM_MAX_COLS, 20);
});

test("tables: column widths, merged cells on static tables, columns picked from a bound table", () => {
  const d = G.doc();
  const theme = { look: "classic" };
  const page = {
    id: "p-t", kind: "freeform", name: "Tables", background: {},
    elements: [
      { id: "t.static", type: "table", frame: { x: 10, y: 10, w: 100, h: 40, rotation: 0 }, z: 0, source: "user", props: { style: "lined", columns: ["Site", "Scope 1", "Scope 2"], rows: [["Manama", 1, 2], ["Sitra", 3, 4], ["Total", 4, 6]], totalRow: true, colWidths: [50, 25, 25], merges: [{ r: 0, c: 1, rs: 2, cs: 1 }] } },
      { id: "t.bound", type: "table", frame: { x: 10, y: 60, w: 100, h: 40, rotation: 0 }, z: 1, source: "user", props: { style: "zebra", binding: G.B.scopes3y, columns: ["Scope 2"], colWidths: [60, 40] } },
    ],
  };
  const doc = { ...d, design: { ...d.design, theme }, pages: [page] };
  const html = R.renderSheet(page, doc, G.data(R.renderData), { mode: "sheet" }).html;
  const st = html.slice(html.indexOf('data-el-id="t.static"'), html.indexOf('data-el-id="t.bound"'));
  assert.match(st, /class="ds-table ds-table--lined ds-table--fixed"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"><\/colgroup>/);
  assert.match(st, /<td class="num ds-merged" rowspan="2">1<\/td>/);
  assert.equal(count(st, /<td/g), 8, "the merged-away cell is gone");
  assert.match(st, /<tr class="ds-total">/);
  const bd = html.slice(html.indexOf('data-el-id="t.bound"'));
  // Rows are the years, columns the breakdown (scopes); only Scope 2 is picked.
  assert.match(bd, /<th><\/th><th class="num">Scope 2<\/th><\/tr>/);
  assert.match(bd, /<tr><td>2023<\/td><td class="num">6,100\.000<\/td><\/tr>/, "series cells in the value's unit: tCO₂e at 3 decimals (#209)");
  assert.doesNotMatch(bd, /Scope 3/);
  assert.deepEqual(R.pickColumns({ columns: ["", "a", "b"], rows: [["x", 1, 2]] }, ["b"]), { columns: ["", "b"], rows: [["x", 2]] });
  assert.deepEqual(R.pickColumns({ columns: ["", "a"], rows: [["x", 1]] }, ["zz"]), { columns: ["", "a"], rows: [["x", 1]] }, "unknown names keep the table");
  // Contracts: the layout is valid on a static table; a bound table can't merge.
  const T = (props) => C.ElementSchema.safeParse({ id: "t", type: "table", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, z: 0, source: "user", props });
  assert.ok(T(page.elements[0].props).success);
  assert.ok(T(page.elements[1].props).success);
  assert.ok(!T({ ...page.elements[1].props, merges: [{ r: 0, c: 0, rs: 2, cs: 1 }] }).success);
  assert.ok(!T({ ...page.elements[0].props, colWidths: [0] }).success);
});

test("contracts: the chart options DS-8 adds", () => {
  const ch = (options) => C.ElementSchema.safeParse({ id: "c", type: "chart", frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, z: 0, source: "user", props: { binding: G.B.scopes, kind: "scope_split", options } });
  assert.ok(ch({ colors: "brand", showLegend: false, variant: "donut", basisNote: false, greyPrior: true, showValues: true }).success);
  assert.ok(!ch({ colors: "rainbow" }).success);
  assert.ok(!ch({ variant: "pie" }).success);
});
