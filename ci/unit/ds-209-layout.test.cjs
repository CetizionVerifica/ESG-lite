// #209 review · chart labels at 3 decimals never collide and never leave the chart.
//   - labelWidth / labelBox (render/charts/svg.ts) are never smaller than the eight studio
//     faces measured in Chromium (ci/fixtures/studio/font-advances.json), regular and bold;
//   - the DS-1 fixture (ci/golden/ds/render/fixture.cjs) and the DS-8 GHG chart fixture
//     (ghg-charts.cjs), rendered on every page format: no two value labels of a chart have
//     boxes that meet, and none crosses the chart's SVG bounds;
//   - fitLabelRow: as drawn when nothing meets, staggered, a size smaller, then left out;
//   - treemap: no value line wider than its tile (value · share, two lines, value alone, none);
//   - scope_split: the legend and the Scope 2 basis note stay apart and inside the chart.
//   npm run build && node --test ci/unit/ds-209-layout.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const SVG = require(path.resolve("dist/reporting/studio/render/charts/svg.js"));
const { PAGE_FORMATS } = require(path.resolve("dist/studio/contracts/index.js"));
const F = require(path.resolve("ci/golden/ds/render/fixture.cjs"));
const G = require(path.resolve("ci/golden/ds/render/ghg-charts.cjs"));
const METRICS = require(path.resolve("ci/fixtures/studio/font-advances.json"));

// A value label: a figure, a signed change, a share, or a treemap "value · share" line.
const VALUE = /^[+−]?\d[\d,]*(\.\d+)?%?( · \d[\d,]*(\.\d+)?%)?$/;
const num = (s) => Number(s);
// Coordinates and font sizes are printed with 3 decimals: 0.01 viewBox units (0.0025 mm) of slack.
const EPS = 0.01;
const attr = (a, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(a)?.[1];

/** Every chart SVG of a rendered page: element id, viewBox size, and its text runs. */
function charts(html) {
  const out = [];
  const re = /<div class="ds-el [^"]*" data-el-id="([^"]+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(html))) starts.push({ id: m[1], at: m.index });
  starts.forEach((s, i) => {
    const frag = html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : html.length);
    for (const svg of frag.matchAll(/<svg [^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"[^>]*>(.*?)<\/svg>/gs)) {
      const texts = [...svg[3].matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((t) => ({
        s: t[2],
        x: num(attr(t[1], "x")),
        y: num(attr(t[1], "y")),
        size: num(attr(t[1], "font-size")),
        anchor: attr(t[1], "text-anchor") ?? "start",
        bold: attr(t[1], "font-weight") === "700",
        baseline: attr(t[1], "dominant-baseline"),
        fill: attr(t[1], "fill"),
      }));
      const rects = [...svg[3].matchAll(/<rect([^>]*)\/>/g)].map((r) => ({ x: num(attr(r[1], "x")), y: num(attr(r[1], "y")), w: num(attr(r[1], "width")), h: num(attr(r[1], "height")), part: attr(r[1], "data-part"), at: r.index }));
      const kind = /data-ghg-chart="([^"]+)"/.exec(svg[3])?.[1] ?? /data-chart-kind="([^"]+)"/.exec(frag)?.[1] ?? "?";
      out.push({ id: s.id, kind, w: num(svg[1]), h: num(svg[2]), body: svg[3], texts, rects });
    }
  });
  return out;
}

const boxOf = (t) => SVG.labelBox(t.x, t.y, t.s, t.size, { anchor: t.anchor, bold: t.bold, baseline: t.baseline });

function renders() {
  const out = [];
  for (const format of PAGE_FORMATS) {
    const d1 = F.fixtureDoc(format);
    out.push({ name: `DS-1 ${format}`, muted: R.buildTheme(d1.design.theme).colors.muted, html: R.renderDocument(d1, F.fixtureData(R.renderData), { mode: "sheet", assets: F.assets }).html });
    const d8 = G.doc(format);
    out.push({ name: `DS-8 ${format}`, muted: R.buildTheme(d8.design.theme).colors.muted, html: R.renderDocument(d8, G.data(R.renderData), { mode: "sheet" }).html });
  }
  return out;
}
const RENDERS = renders();

test("labelWidth and labelBox are never smaller than any studio face, regular or bold", () => {
  const faces = Object.entries(METRICS.faces);
  assert.equal(faces.length, 16, "8 faces × regular and bold");
  const samples = new Set(["12,480.000", "−1,420.000", "+900.000", "1,290.000 · 39%", "100%", "0.000", "999,999,999.999", "8,350", "19.8", "5.5%"]);
  for (const r of RENDERS) for (const c of charts(r.html)) for (const t of c.texts) if (VALUE.test(t.s)) samples.add(t.s);
  assert.ok(samples.size > 60, String(samples.size));
  for (const [face, m] of faces) {
    const bold = face.endsWith("@700");
    assert.ok(m.ascent <= SVG.LABEL_ASCENT && m.descent <= SVG.LABEL_DESCENT, `${face} glyph box ${m.ascent}/${m.descent}`);
    for (const s of samples) {
      const measured = [...s].reduce((a, ch) => a + m.advance[ch], 0);
      assert.ok(Number.isFinite(measured), `${face} lacks a character of ${s}`);
      assert.ok(SVG.labelWidth(s, 1, bold) >= measured + 0.05, `${face}: "${s}" ${measured.toFixed(3)} em vs estimate ${SVG.labelWidth(s, 1, bold).toFixed(3)}`);
    }
  }
});

test("DS-1 and DS-8 fixtures on every format: value labels never meet and never leave the chart", () => {
  let labels = 0;
  let kinds = new Set();
  for (const r of RENDERS) {
    for (const c of charts(r.html)) {
      const vals = c.texts.filter((t) => VALUE.test(t.s) && t.fill !== r.muted && t.anchor !== "end");
      kinds.add(c.kind);
      const boxes = vals.map((t) => ({ t, b: boxOf(t) }));
      for (const { t, b } of boxes) {
        labels++;
        const where = `${r.name} ${c.id} (${c.kind}) "${t.s}" box ${[b.x0, b.x1, b.y0, b.y1].map((v) => v.toFixed(2)).join(",")} in ${c.w}×${c.h}`;
        // EPS: coordinates are printed with 3 decimals.
        assert.ok(b.x0 >= -EPS && b.x1 <= c.w + EPS && b.y0 >= -EPS && b.y1 <= c.h + EPS, `leaves the chart: ${where}`);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          assert.ok(!SVG.boxesMeet(boxes[i].b, boxes[j].b), `${r.name} ${c.id} (${c.kind}): "${boxes[i].t.s}" @${boxes[i].t.x},${boxes[i].t.y} meets "${boxes[j].t.s}" @${boxes[j].t.x},${boxes[j].t.y}`);
    }
  }
  assert.ok(labels > 500, `labels checked: ${labels}`);
  for (const k of ["bar", "stacked_bar", "waterfall", "target_bars", "donut", "category_bars", "site_bars", "gas_split", "monthly_stack", "base_year_waterfall", "intensity_line", "treemap", "scope_split"]) assert.ok(kinds.has(k), `fixture lacks ${k}: ${[...kinds].join(", ")}`);
});

test("the DS-8 bridge staggers 3-decimal labels on a narrow chart instead of overlapping them", () => {
  const d = G.doc("a4");
  const muted = R.buildTheme(d.design.theme).colors.muted;
  const c = charts(R.renderDocument(d, G.data(R.renderData), { mode: "sheet" }).html).find((x) => x.id === "g.base_year_waterfall");
  const vals = c.texts.filter((t) => VALUE.test(t.s) && t.fill !== muted && t.anchor !== "end");
  assert.deepEqual(vals.map((t) => t.s), ["13,900.000", "−490.000", "−800.000", "−130.000", "12,480.000"], "every step keeps its label");
  assert.ok(vals.every((t) => Math.abs(t.size - SVG.SMALL) < 1e-3), "at full size");
  // Neighbours sit on different lines: a label would meet its neighbour on one baseline.
  assert.ok(vals[1].y < vals[0].y - SVG.SMALL * 0.9 && vals[3].y < vals[2].y - SVG.SMALL * 0.9, vals.map((t) => t.y).join(", "));
});

test("fitLabelRow: as drawn when nothing meets; stagger, a smaller size, then leave out", () => {
  const row = (xs, text = "12,480.000", y = 100) => () => xs.map((x) => ({ x, y, text }));
  const S = SVG.SMALL;
  const wide = SVG.labelWidth("12,480.000");
  // Far apart: as drawn.
  const a = SVG.fitLabelRow(row([60, 200]), 300, 200);
  assert.deepEqual([a.extraTop, a.size, a.labels], [0, S, [{ x: 60, y: 100 }, { x: 200, y: 100 }]]);
  // Neighbours a little closer than a label is wide: alternate labels go up, a line is reserved at the top.
  const xs = [40, 40 + wide * 0.8, 40 + wide * 1.6, 40 + wide * 2.4];
  const b = SVG.fitLabelRow((extra) => xs.map((x) => ({ x, y: 100 + extra, text: "12,480.000" })), 300, 200);
  assert.ok(b.extraTop > S, String(b.extraTop));
  assert.equal(b.size, S);
  assert.deepEqual(b.labels.map((l) => l.y < 100 + b.extraTop), [false, true, false, true]);
  // No room above to stagger: one size smaller.
  const c = SVG.fitLabelRow(() => [{ x: 50, y: 12, text: "12,480.000" }, { x: 50 + wide * 0.9, y: 12, text: "12,480.000" }], 300, 40);
  assert.equal(c.size, S * 0.85);
  assert.ok(c.labels.every(Boolean));
  // Still too close at the smaller size: the bold label is kept, the other left out; never an overlap.
  const d = SVG.fitLabelRow(() => [{ x: 50, y: 12, text: "12,480.000" }, { x: 52, y: 12, text: "13,900.000", bold: true }], 300, 40);
  assert.deepEqual(d.labels.map(Boolean), [false, true]);
  // A label wider than the chart is left out rather than cut.
  const e = SVG.fitLabelRow(() => [{ x: 10, y: 20, text: "1,234,567,890.000" }], 50, 40);
  assert.deepEqual(e.labels, [null]);
  // Every placed label stays inside the chart, bold-aware at the edge.
  const f = SVG.fitLabelRow(() => [{ x: 299, y: 100, text: "12,480.000", bold: true }], 300, 200);
  assert.ok(Math.abs(f.labels[0].x + SVG.labelWidth("12,480.000", S, true) / 2 - 300) < 1e-9);
});

test("treemap: no value line is wider than its tile", () => {
  let lines = 0;
  for (const r of RENDERS) {
    for (const c of charts(r.html).filter((x) => x.kind === "treemap")) {
      const tiles = c.rects.filter((x) => x.part);
      for (const t of c.texts.filter((x) => VALUE.test(x.s))) {
        const tile = tiles.find((x) => t.x >= x.x && t.x <= x.x + x.w && t.y >= x.y && t.y <= x.y + x.h);
        assert.ok(tile, `${r.name} ${c.id}: "${t.s}" sits in a tile`);
        const b = boxOf(t);
        lines++;
        assert.ok(b.x1 <= tile.x + tile.w + EPS && b.y1 <= tile.y + tile.h + EPS, `${r.name} ${c.id}: "${t.s}" (to ${b.x1.toFixed(2)}) is wider than tile ${tile.part} (to ${(tile.x + tile.w).toFixed(2)})`);
      }
    }
  }
  assert.ok(lines > 40, String(lines));
  // The four cases, on one tile each: one line, two lines, the value alone, no value line.
  const tm = (w, h) => {
    const svg = R.chartRenderer("treemap")({ value: { display: "", value: 1290, unit: "tCO₂e", series: [{ label: "2025", values: [{ key: "A", value: 1290 }] }] }, w, h, theme: R.buildTheme({}), options: {}, label: "t" });
    return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).slice(1);
  };
  const S = SVG.SMALL;
  const room = (s) => SVG.labelWidth(s) + S + 1;
  assert.deepEqual(tm(room("1,290.000 · 100%"), S * 4), ["1,290.000 · 100%"]);
  assert.deepEqual(tm(room("1,290.000"), S * 5.2), ["1,290.000", "100%"]);
  assert.deepEqual(tm(room("1,290.000"), S * 4), ["1,290.000"]);
  assert.deepEqual(tm(room("1,290.00"), S * 5.2), []);
});

test("scope_split: the legend and the basis note never meet and stay inside the chart, on every format", () => {
  let n = 0;
  for (const r of RENDERS) {
    for (const c of charts(r.html).filter((x) => x.kind === "scope_split")) {
      // Legend lines and the note, in the muted ink, as alphabetic-baseline text: their vertical extent.
      const rows = c.texts.filter((t) => t.fill === r.muted).map((t) => ({ t, y0: t.y - SVG.LABEL_ASCENT * t.size, y1: t.y + SVG.LABEL_DESCENT * t.size }));
      const note = rows.find((x) => x.t.s.startsWith("Scope 2: location-based"));
      for (const x of rows) {
        n++;
        assert.ok(x.y0 >= -EPS && x.y1 <= c.h + EPS, `${r.name} ${c.id}: "${x.t.s}" leaves the chart (${x.y0.toFixed(2)}..${x.y1.toFixed(2)} of ${c.h})`);
        assert.ok(x.t.s.length * x.t.size * 0.55 <= c.w + x.t.size * 3, `${r.name} ${c.id}: "${x.t.s}" is far wider than the chart`);
      }
      if (note) for (const x of rows) if (x !== note) assert.ok(x.y1 <= note.y0 || x.y0 >= note.y1, `${r.name} ${c.id}: "${x.t.s}" meets the basis note`);
      // The bar variant's legend sits under the bar, the note under the legend.
      const bar = c.rects.filter((x) => x.part);
      if (/data-variant="bar"/.test(c.body) && bar.length) for (const x of rows) assert.ok(x.y0 >= bar[0].y + bar[0].h - EPS, `${r.name} ${c.id}: "${x.t.s}" over the bar`);
    }
  }
  assert.ok(n > 20, String(n));
  // A short frame: the bar gives up height, then the note goes, and the legend still fits.
  const v = { display: "12,480.000", value: 12480, unit: "tCO₂e", series: [{ label: "2025", values: [{ key: "Scope 1", value: 3410 }, { key: "Scope 2", value: 5800 }, { key: "Scope 3", value: 3270 }] }] };
  for (const [w, h] of [[200, 70], [200, 52], [400, 40]]) {
    const svg = R.chartRenderer("scope_split")({ value: v, w, h, theme: R.buildTheme({}), options: {}, label: "s" });
    const ys = [...svg.matchAll(/<text[^>]*y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => [Number(m[1]), Number(m[2]), m[3]]);
    for (const [y, size, s] of ys) assert.ok(y + SVG.LABEL_DESCENT * size <= h + EPS, `${w}×${h}: "${s}" at ${y}`);
  }
});
