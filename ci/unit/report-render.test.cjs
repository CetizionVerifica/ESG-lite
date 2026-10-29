// Branded GHG PDF: chart options stay legible in print and tables only bold a
// row that is really a total.
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { buildChartOption } = require(path.resolve("dist/reporting/charts.js"));
const { renderBlocks } = require(path.resolve("dist/reporting/blocks.js"));

const theme = {
  id: "t", name: "Midal Cables", page: { size: "A4", margin: "18mm" },
  colors: { primary: "#0B2E5C", accent: "#2F6FB0", ink: "#101828", muted: "#475467", surface: "#F5F7FA", border: "#E4E9F0", onPrimary: "#FFFFFF", coverBgFrom: "#061933", coverBgTo: "#0B2E5C" },
  chartPalette: ["#2F6FB0", "#0B2E5C"], fonts: { heading: "Inter", body: "Inter" }, footer: "",
};

// Every fontSize anywhere in an option tree.
function fontSizes(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => fontSizes(x, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) k === "fontSize" ? out.push(v) : fontSizes(v, out);
  return out;
}

test("no chart text is smaller than 12px", () => {
  const blocks = [
    { type: "chart", chartType: "pie", unit: "tCO₂e", categories: ["Scope 1", "Scope 2"], series: [{ name: "tCO₂e", data: [8576, 38481] }] },
    { type: "chart", chartType: "bar", unit: "tCO₂e", categories: ["A", "B", "C"], series: [{ name: "S1", data: [1, 2, 3] }, { name: "S2", data: [3, 2, 1] }] },
    { type: "chart", chartType: "bar", horizontal: true, showShare: true, unit: "tCO₂e", categories: ["A", "B"], series: [{ name: "tCO₂e", data: [75, 25] }] },
    { type: "chart", chartType: "line", categories: ["Jan", "Feb"], series: [{ name: "x", data: [1, 2] }] },
  ];
  for (const b of blocks) {
    const sizes = fontSizes(buildChartOption(b, theme));
    assert.ok(sizes.length > 0);
    assert.ok(sizes.every((s) => s >= 12), `${b.chartType}: ${sizes}`);
  }
});

test("donut legend carries value and share, centre shows the unrounded total", () => {
  const o = buildChartOption({ type: "chart", chartType: "pie", unit: "tCO₂e", total: 49662, categories: ["Scope 1", "Scope 2", "Scope 3"], series: [{ name: "tCO₂e", data: [8576, 38481, 2606] }] }, theme);
  assert.equal(o.title.text, "49,662.000"); // #209: tCO₂e to 3 dp
  assert.equal(o.series[0].data[1].name, "Scope 2  ·  38,481.000 (77.5%)");
  assert.equal(o.series[0].data[1].label.formatter, "77.5%");
});

test("horizontal bars label each bar with value, unit and share of the total", () => {
  const o = buildChartOption({ type: "chart", chartType: "bar", horizontal: true, showShare: true, unit: "tCO₂e", total: 200, categories: ["A", "B"], series: [{ name: "tCO₂e", data: [150, 50] }] }, theme);
  assert.equal(o.yAxis.type, "category");
  assert.equal(o.yAxis.inverse, true);
  assert.equal(o.series[0].data[0].label.formatter, "150.000 tCO₂e  ·  75.0%");
});

test("only tables flagged with totalRow style their last row as a total", () => {
  const rows = [["A", "1"], ["B", "2"]];
  const plain = renderBlocks([{ type: "table", columns: ["x", "y"], rows }], theme).html;
  const totals = renderBlocks([{ type: "table", columns: ["x", "y"], rows, totalRow: true }], theme).html;
  assert.ok(!plain.includes("total-row"));
  assert.equal((totals.match(/class="total-row"/g) || []).length, 1);
});

test("a flowing sub-section heading is kept with the block after it", () => {
  const html = renderBlocks([
    { type: "section", title: "Scope 1", flow: true },
    { type: "table", columns: ["x"], rows: [["a"]] },
  ], theme).html;
  assert.match(html, /<div class="lrow--keep"><section class="section-head[^"]*section-head--flow"/);
});

test("SVG charts label every bar with value, unit and share, at print-legible sizes", () => {
  const { hbarSvg, shareBarSvg, stackedBarsSvg } = require(path.resolve("dist/reporting/svgcharts.js"));
  const h = hbarSvg([{ label: "Purchased Electricity", value: 38481 }, { label: "Stationary Combustion", value: 8576 }], { color: "#0B2E5C", unit: "tCO₂e", total: 49662, showShare: true });
  assert.match(h, />38,481\.000 tCO₂e  ·  77\.5%</);
  const s = shareBarSvg([{ label: "Scope 1", value: 25, color: "#000000" }, { label: "Scope 2", value: 75, color: "#2F6FB0" }], "tCO₂e");
  assert.match(s, />75\.000  ·  75\.0%</);
  assert.match(s, /100% = 100\.000 tCO₂e/);
  const st = stackedBarsSvg([{ name: "Scope 1", color: "#0B2E5C" }, { name: "Scope 2", color: "#2F6FB0" }], [{ label: "Site A", values: [10, 30] }, { label: "Site B", values: [5, 5] }], { total: 50 });
  assert.match(st, />40\.000  ·  80\.0%</);
  for (const svg of [h, s, st]) {
    const sizes = [...svg.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    assert.ok(sizes.every((n) => n >= 25), `${sizes}`); // 25 = 2.5 mm ≈ 7 pt at print scale
  }
});

test("long bar labels wrap to two lines instead of overflowing", () => {
  const { hbarSvg } = require(path.resolve("dist/reporting/svgcharts.js"));
  const h = hbarSvg([{ label: "Upstream Transportation and Distribution of purchased goods", value: 1 }], { color: "#000000" });
  assert.equal((h.match(/text-anchor="end"/g) || []).length, 2);
});

test("ruled tables render status cells as fixed-colour pills", () => {
  const html = renderBlocks([{ type: "table", title: "Site reporting status", columns: ["Site", "Status"], rows: [["A", { text: "✓ Reported", pill: "ok" }], ["B", { text: "! Not entered", pill: "warn" }]] }], theme).html;
  assert.match(html, /<span class="pill pill-ok">✓ Reported<\/span>/);
  assert.match(html, /<span class="pill pill-warn">! Not entered<\/span>/);
});

test("group bar shares use the given denominator, not the sum of the rows", () => {
  const html = renderBlocks([{ type: "groupBars", name: "Scope 1", color: "#0B2E5C", total: "200", rows: [{ label: "Diesel", value: 50 }, { label: "LPG", value: 50 }], shareOf: 200 }], theme).html;
  assert.match(html, />50\.000  ·  25\.0%</);
  assert.doesNotMatch(html, /50\.0%/);
});

test("running header text cannot close the stylesheet or the title", () => {
  const { renderDocument } = require(path.resolve("dist/reporting/render.js"));
  const evil = "Acme</style><script>x()</script>";
  const html = renderDocument({ client: "c", slug: "s", docTitle: evil, runningLeft: evil, runningFooter: evil, blocks: [] }, theme);
  const head = html.slice(0, html.indexOf("<body>"));
  assert.equal((head.match(/<\/style>/g) || []).length, 1);
  assert.doesNotMatch(head, /<script>x\(\)/);
});
