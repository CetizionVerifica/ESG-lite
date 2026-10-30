// #209 review · chart labels at 3 decimals never collide, never leave the chart, and nothing reported is dropped to make room.
//   - textWidth / labelWidth / labelBox (render/charts/metrics.ts, svg.ts) are never smaller than the eight studio faces
//     measured in Chromium (ci/fixtures/studio/font-advances.json), regular and bold, for every character;
//   - the fixtures send the displays the server sends (sources/format.ts: a tCO₂e figure with 3 decimals);
//   - the DS-1 fixture (ci/golden/ds/render/fixture.cjs) and the DS-8 GHG chart fixture (ghg-charts.cjs), rendered on every
//     page format: no value label meets another value label, a tick label or any other muted text, or a bar; none leaves
//     the plot or the chart; the GHG total lines fit the chart's width; a donut's centre stays inside its hole;
//   - fitLabelRow: as drawn; a font step smaller (down to 80 %); staggered; only then left out; clear of obstacles;
//   - treemap: no value line wider than its tile (value · share, two lines, value alone, none);
//   - scope_split: the shares, every legend figure and the whole Scope 2 basis note are drawn on every format, and the
//     legend and the note stay apart and inside the chart.
//   npm run build && node --test ci/unit/ds-209-layout.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const SVG = require(path.resolve("dist/reporting/studio/render/charts/svg.js"));
const RF = require(path.resolve("dist/reporting/studio/render/format.js"));
const MET = require(path.resolve("dist/reporting/studio/render/charts/metrics.js"));
const SRC = require(path.resolve("dist/studio/sources/format.js"));
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
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// Glyph boxes (em) of any text, letters too: the faces' tallest and deepest (font-advances.json textAscent/textDescent), rounded up.
const TEXT_ASCENT = 0.8;
const TEXT_DESCENT = 0.26;

/** The texts and rects of an SVG body with their <g transform="translate(…)"> offsets applied. */
function parseSvg(body) {
  const texts = [];
  const rects = [];
  const stack = [[0, 0]];
  for (const m of body.matchAll(/<g\b([^>]*)>|<\/g>|<text([^>]*)>([^<]*)<\/text>|<rect([^>]*)\/>/g)) {
    const [dx, dy] = stack[stack.length - 1];
    if (m[0].startsWith("</g")) stack.pop();
    else if (m[0].startsWith("<g")) {
      const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(attr(m[1], "transform") ?? "");
      stack.push(t ? [dx + num(t[1]), dy + num(t[2])] : [dx, dy]);
    } else if (m[2] !== undefined) {
      texts.push({ s: unesc(m[3]), x: num(attr(m[2], "x")) + dx, y: num(attr(m[2], "y")) + dy, size: num(attr(m[2], "font-size")), anchor: attr(m[2], "text-anchor") ?? "start", bold: attr(m[2], "font-weight") === "700", baseline: attr(m[2], "dominant-baseline"), fill: attr(m[2], "fill") });
    } else {
      rects.push({ x: num(attr(m[4], "x")) + dx, y: num(attr(m[4], "y")) + dy, w: num(attr(m[4], "width")), h: num(attr(m[4], "height")), fill: attr(m[4], "fill"), part: attr(m[4], "data-part") });
    }
  }
  return { texts, rects };
}

/** Every chart SVG of a rendered page: element id, kind, viewBox size, its texts and rects. */
function charts(html) {
  const out = [];
  const re = /<div class="ds-el [^"]*" data-el-id="([^"]+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(html))) starts.push({ id: m[1], at: m.index });
  starts.forEach((s, i) => {
    const frag = html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : html.length);
    for (const svg of frag.matchAll(/<svg [^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"[^>]*>(.*?)<\/svg>/gs)) {
      const kind = /data-ghg-chart="([^"]+)"/.exec(svg[3])?.[1] ?? /data-chart-kind="([^"]+)"/.exec(frag)?.[1] ?? "?";
      out.push({ id: s.id, kind, w: num(svg[1]), h: num(svg[2]), body: svg[3], ...parseSvg(svg[3]) });
    }
  });
  return out;
}

const isNumeric = (s) => VALUE.test(s) || /^[−-]?\d[\d,.]*[kKMB]?$/.test(s);
/** A text's box: value labels and ticks by labelBox (their glyphs), any other text with the letters' deeper box. */
const boxOf = (t) => {
  const b = SVG.labelBox(t.x, t.y, t.s, t.size, { anchor: t.anchor, bold: t.bold, baseline: t.baseline });
  if (isNumeric(t.s)) return b;
  const mid = t.baseline === "middle" || t.baseline === "central";
  return { ...b, y0: mid ? t.y - t.size * 0.55 : t.y - TEXT_ASCENT * t.size, y1: mid ? t.y + t.size * 0.55 : t.y + TEXT_DESCENT * t.size };
};
const rectBox = (r) => ({ x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h });
const where = (b) => [b.x0, b.x1, b.y0, b.y1].map((v) => v.toFixed(2)).join(",");

function renders() {
  const out = [];
  for (const format of PAGE_FORMATS) {
    const d1 = F.fixtureDoc(format);
    out.push({ name: `DS-1 ${format}`, format, muted: R.buildTheme(d1.design.theme).colors.muted, html: R.renderDocument(d1, F.fixtureData(R.renderData), { mode: "sheet", assets: F.assets }).html });
    const d8 = G.doc(format);
    out.push({ name: `DS-8 ${format}`, format, muted: R.buildTheme(d8.design.theme).colors.muted, html: R.renderDocument(d8, G.data(R.renderData), { mode: "sheet" }).html });
    // The scope_split donut with its basis note on (the fixture's donut has it off).
    const dn = G.doc(format);
    dn.pages = [{ ...dn.pages[0], elements: dn.pages[0].elements.filter((e) => e.id === "g.scope_donut").map((e) => ({ ...e, props: { ...e.props, options: { variant: "donut" } } })) }];
    out.push({ name: `DS-8 donut with note ${format}`, format, muted: R.buildTheme(dn.design.theme).colors.muted, html: R.renderDocument(dn, G.data(R.renderData), { mode: "sheet" }).html });
  }
  return out;
}
const RENDERS = renders();
const ALL = RENDERS.flatMap((r) => charts(r.html).map((c) => ({ r, c })));

test("textWidth, labelWidth and labelBox are never smaller than any studio face, regular or bold", () => {
  const faces = Object.entries(METRICS.faces);
  assert.equal(faces.length, 16, "8 faces × regular and bold");
  const samples = new Set(["12,480.000", "−1,420.000", "+900.000", "1,290.000 · 39%", "100%", "0.000", "999,999,999.999", "8,350", "19.8", "5.5%"]);
  const texts = new Set(["Total emissions 12,480.000 tCO₂e", "Scope 2: location-based. Market-based isn't recorded.", "tCO₂e per unit of revenue", "Target 2030", "Baseline"]);
  for (const { c } of ALL) for (const t of c.texts) (VALUE.test(t.s) ? samples : texts).add(t.s);
  assert.ok(samples.size > 60, String(samples.size));
  assert.ok(texts.size > 100, String(texts.size));
  for (const [face, m] of faces) {
    const bold = face.endsWith("@700");
    assert.ok(m.ascent <= SVG.LABEL_ASCENT && m.descent <= SVG.LABEL_DESCENT, `${face} value glyph box ${m.ascent}/${m.descent}`);
    assert.ok(m.textAscent <= TEXT_ASCENT && m.textDescent <= TEXT_DESCENT, `${face} text glyph box ${m.textAscent}/${m.textDescent}`);
    for (const s of [...samples, ...texts]) {
      const measured = [...s].reduce((a, ch) => a + m.advance[ch], 0);
      assert.ok(Number.isFinite(measured), `${face} lacks a character of ${s}`);
      assert.ok(MET.textWidth(s, 1, bold) >= measured + 0.05, `${face}: "${s}" ${measured.toFixed(3)} em vs estimate ${MET.textWidth(s, 1, bold).toFixed(3)}`);
      assert.equal(SVG.labelWidth(s, 1, bold), MET.textWidth(s, 1, bold));
    }
    // Every measured character is in the table (a character outside it takes the widest advance).
    for (const [ch, adv] of Object.entries(m.advance)) assert.ok(MET.textWidth(ch, 1, bold) - MET.TEXT_MARGIN_EM >= adv - 1e-9, `${face} "${ch}"`);
  }
});

test("the fixtures send the displays the server sends: a tCO₂e figure with 3 decimals (sources/format.ts)", () => {
  const capture = (bindings, tokens, res, extra) => ({ res, extra });
  const d1 = F.fixtureData(capture);
  const d8 = G.data(capture);
  let n = 0;
  for (const v of [...d1.res.values, ...d1.res.tokens, ...d8.res.values]) {
    if (typeof v.value !== "number" || !RF.isTonnesCo2e(v.unit)) continue;
    // The KPI target value stands for a progress measure: the progress element prints its share.
    if (typeof v.progress === "number") {
      assert.equal(v.display, `${Math.round(v.progress * 100)}%`);
      continue;
    }
    assert.equal(v.display, SRC.formatNumber(v.value, "auto", v.unit), `${v.value} ${v.unit}`);
    assert.match(v.display, /\.\d{3}$/);
    n++;
  }
  assert.ok(n >= 17, String(n));
  for (const row of d1.extra.scope3["f-s3"].filter((x) => x.display)) assert.equal(row.display, SRC.formatNumber(row.n * 100, "auto", "tCO₂e"));
});

test("DS-1 and DS-8 fixtures on every format: no value label meets another, a tick label (or any muted text) or a bar, or leaves the plot", () => {
  let labels = 0;
  const kinds = new Set();
  for (const { r, c } of ALL) {
    kinds.add(c.kind);
    // Value labels in ink (white shares sit inside their own segment; treemap lines inside their tile: tested below).
    const vals = c.texts.filter((t) => VALUE.test(t.s) && t.fill !== r.muted && !/^#FFFFFF$/i.test(t.fill) && c.kind !== "treemap");
    const muted = c.texts.filter((t) => t.fill === r.muted);
    const bars = c.rects.filter((x) => x.w > 0.5 && x.h > 0.5 && !(x.w >= c.w * 0.95 && x.h >= c.h * 0.95));
    const boxes = vals.map((t) => ({ t, b: boxOf(t) }));
    for (const { t, b } of boxes) {
      labels++;
      const at = `${r.name} ${c.id} (${c.kind}) "${t.s}" box ${where(b)} in ${c.w}×${c.h}`;
      assert.ok(b.x0 >= -EPS && b.x1 <= c.w + EPS && b.y0 >= -EPS && b.y1 <= c.h + EPS, `leaves the chart: ${at}`);
      for (const m of muted) assert.ok(!SVG.boxesMeet(b, boxOf(m)), `${at} meets the muted text "${m.s}" ${where(boxOf(m))}`);
      for (const bar of bars) assert.ok(!SVG.boxesMeet(b, rectBox(bar)), `${at} meets a bar ${where(rectBox(bar))} (${bar.part ?? bar.fill})`);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        assert.ok(!SVG.boxesMeet(boxes[i].b, boxes[j].b), `${r.name} ${c.id} (${c.kind}): "${boxes[i].t.s}" @${boxes[i].t.x},${boxes[i].t.y} meets "${boxes[j].t.s}" @${boxes[j].t.x},${boxes[j].t.y}`);
    // Centred labels over vertical bars stay inside the plot, right of the value axis (its gridlines start at the axis).
    const axis = /<line x1="([\d.]+)" x2="[\d.]+" y1="([\d.]+)" y2="\2"/.exec(c.body);
    if (axis && ["bar", "stacked_bar", "waterfall", "target_bars", "gas_split", "monthly_stack", "base_year_waterfall", "intensity_line"].includes(c.kind))
      for (const { t, b } of boxes) if (t.anchor === "middle") assert.ok(b.x0 >= num(axis[1]) - EPS, `${r.name} ${c.id}: "${t.s}" starts at ${b.x0.toFixed(2)}, left of the plot at ${axis[1]}`);
  }
  assert.ok(labels > 400, `labels checked: ${labels}`);
  for (const k of ["bar", "stacked_bar", "waterfall", "target_bars", "donut", "category_bars", "site_bars", "gas_split", "monthly_stack", "base_year_waterfall", "intensity_line", "treemap", "scope_split"]) assert.ok(kinds.has(k), `fixture lacks ${k}: ${[...kinds].join(", ")}`);
});

test("GHG total lines fit the chart's width, and a donut's figure fits its hole or sits under the donut", () => {
  let heads = 0;
  let centres = 0;
  for (const { r, c } of ALL) {
    for (const t of c.texts.filter((x) => x.bold && /^Total /.test(x.s))) {
      heads++;
      const b = boxOf(t);
      assert.ok(b.x0 >= -EPS && b.x1 <= c.w + EPS && b.y0 >= -EPS, `${r.name} ${c.id}: "${t.s}" ${where(b)} in ${c.w}×${c.h}`);
    }
    const d = /<path d="(M[^"]+)" fill="[^"]+" fill-rule="evenodd"/.exec(c.body)?.[1];
    if (!d) continue;
    const m = /^M([-\d.]+) ([-\d.]+)A([\d.]+) /.exec(d);
    const radii = [...c.body.matchAll(/A([\d.]+) [\d.]+ 0 /g)].map((x) => num(x[1]));
    const r0 = num(m[3]);
    const inner = Math.min(...radii);
    const one = /ZM/.test(d);
    const [cx, cy] = one ? [num(m[1]) - r0, num(m[2])] : [num(m[1]), num(m[2]) + r0];
    const display = "12,480.000";
    const fig = c.texts.find((t) => t.s === display || t.s.startsWith(`${display} `));
    assert.ok(fig, `${r.name} ${c.id}: the total ${display} is drawn`);
    const fb = boxOf(fig);
    assert.ok(fb.x0 >= -EPS && fb.x1 <= c.w + EPS && fb.y0 >= -EPS && fb.y1 <= c.h + EPS, `${r.name} ${c.id}: the total ${where(fb)} leaves the chart`);
    for (const t of c.texts) {
      if (Math.hypot(t.x - cx, t.y - cy) > inner) continue;
      centres++;
      const b = boxOf(t);
      const far = Math.max(...[[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      assert.ok(far <= inner + EPS, `${r.name} ${c.id}: "${t.s}" reaches ${far.toFixed(2)} from the centre, past the hole (${inner})`);
    }
    // Under the donut: below the ring and its share labels.
    if (fig && Math.hypot(fig.x - cx, fig.y - cy) > inner) assert.ok(fb.y0 >= cy + r0 - EPS, `${r.name} ${c.id}: the total sits under the donut`);
  }
  assert.ok(heads >= 70, String(heads));
  assert.ok(centres >= 20, String(centres));
  // The real displays need it: on A5 the DS-1 donut's figure steps down to fit, on social_191 it goes under the donut.
  const donut = (format) => ALL.find(({ r, c }) => r.name === `DS-1 ${format}` && c.id === "p-summary.donut").c;
  const a5 = donut("a5").texts.find((t) => t.s === "12,480.000");
  assert.ok(a5 && a5.size < SVG.FONT * 1.4 - EPS && a5.size >= SVG.SMALL - EPS, String(a5?.size));
  assert.ok(donut("social_191").texts.some((t) => t.s === "12,480.000 tCO₂e"), "social_191: under the donut, with its unit");
});

test("the DS-8 bridge keeps every 3-decimal step label: a size smaller on A4, staggered too on A5, never an overlap", () => {
  const vals = (format) => {
    const d = G.doc(format);
    const muted = R.buildTheme(d.design.theme).colors.muted;
    const c = charts(R.renderDocument(d, G.data(R.renderData), { mode: "sheet" }).html).find((x) => x.id === "g.base_year_waterfall");
    return c.texts.filter((t) => VALUE.test(t.s) && t.fill !== muted);
  };
  const a4 = vals("a4");
  assert.deepEqual(a4.map((t) => t.s), ["13,900.000", "−490.000", "−800.000", "−130.000", "12,480.000"], "every step keeps its label");
  // Too wide for their bands at 6.5 pt: one size for the row, smaller, before anything staggers.
  assert.ok(a4.every((t) => t.size < SVG.SMALL - EPS && t.size >= SVG.SMALL * 0.8 - EPS && t.size === a4[0].size), a4.map((t) => t.size).join(", "));
  assert.equal(a4[0].y, a4[1].y, "not staggered: base and Scope 1 on one baseline");
  const a5 = vals("a5");
  assert.equal(a5.length, 5, "every step keeps its label on A5");
  assert.ok(a5.some((t, i) => i && Math.abs(t.y - a5[i - 1].y) > SVG.SMALL * 0.5), `staggered on A5: ${a5.map((t) => t.y).join(", ")}`);
});

test("fitLabelRow: as drawn; a font step smaller; staggered; then left out; clear of obstacles and inside x0..w", () => {
  const S = SVG.SMALL;
  const wide = SVG.labelWidth("12,480.000");
  const row = (xs, y = 100, extra = {}) => (ex) => ({ labels: xs.map((x) => ({ x, y: y + ex, text: "12,480.000" })), ...extra });
  // Far apart: as drawn.
  const a = SVG.fitLabelRow(row([60, 200]), 300, 200);
  assert.deepEqual([a.extraTop, a.size, a.labels], [0, S, [{ x: 60, y: 100 }, { x: 200, y: 100 }]]);
  // Neighbours a little closer than a label is wide: a font step smaller first, on one baseline.
  const b = SVG.fitLabelRow(row([40, 40 + wide * 0.97]), 300, 200);
  assert.equal(b.extraTop, 0);
  assert.ok(b.size < S && b.size >= S * 0.8, String(b.size));
  assert.ok(b.labels.every((l) => l.y === 100));
  // Too close for the smallest step: staggered (a line reserved at the top), every label kept.
  const xs = [40, 40 + wide * 0.6, 40 + wide * 1.2, 40 + wide * 1.8];
  const c = SVG.fitLabelRow(row(xs), 300, 200);
  assert.ok(c.extraTop > 0, String(c.extraTop));
  assert.ok(c.labels.every(Boolean));
  assert.deepEqual(c.labels.map((l) => l.y < 100 + c.extraTop), [false, true, false, true]);
  // No room above to stagger either: the bold label is kept, the other left out; never an overlap.
  const d = SVG.fitLabelRow(() => ({ labels: [{ x: 50, y: 12, text: "12,480.000" }, { x: 52, y: 12, text: "13,900.000", bold: true }] }), 300, 40);
  assert.equal(d.size, S * 0.8);
  assert.deepEqual(d.labels.map(Boolean), [false, true]);
  // A label wider than the plot is left out rather than cut.
  assert.deepEqual(SVG.fitLabelRow(() => ({ labels: [{ x: 10, y: 20, text: "1,234,567,890.000" }] }), 50, 40).labels, [null]);
  // Inside the plot x0..w, bold-aware at both edges: never over the axis's tick labels.
  const e = SVG.fitLabelRow(() => ({ labels: [{ x: 31, y: 100, text: "12,480.000", bold: true }, { x: 299, y: 100, text: "12,480.000", bold: true }] }), 300, 200, { x0: 30 });
  const half = SVG.labelWidth("12,480.000", S, true) / 2;
  assert.ok(Math.abs(e.labels[0].x - half - 30) < 1e-9 && Math.abs(e.labels[1].x + half - 300) < 1e-9, JSON.stringify(e.labels));
  // An obstacle (a tick label, another bar) is kept clear like a label: a smaller step that clears it, else a stagger.
  const tick = SVG.labelBox(28, 100, "15k", S, { anchor: "end", baseline: "middle" });
  const bar = { x0: 60, x1: 90, y0: 98, y1: 150 };
  const f = SVG.fitLabelRow(row([60], 100, { obstacles: [tick, bar] }), 300, 200);
  assert.ok(f.labels[0], "kept");
  assert.ok(!SVG.boxesMeet(SVG.labelBox(f.labels[0].x, f.labels[0].y, "12,480.000", f.size, { anchor: "middle" }), bar), "clear of the bar");
  // Its own bar (owner) is no obstacle.
  const g = SVG.fitLabelRow(() => ({ labels: [{ x: 75, y: 96, text: "12,480.000" }], obstacles: [{ ...bar, owner: 0 }] }), 300, 200);
  assert.deepEqual([g.size, g.labels], [S, [{ x: 75, y: 96 }]]);
});

test("treemap: no value line is wider than its tile", () => {
  let lines = 0;
  for (const { r, c } of ALL.filter((x) => x.c.kind === "treemap")) {
    const tiles = c.rects.filter((x) => x.part);
    for (const t of c.texts.filter((x) => VALUE.test(x.s))) {
      const tile = tiles.find((x) => t.x >= x.x && t.x <= x.x + x.w && t.y >= x.y && t.y <= x.y + x.h);
      assert.ok(tile, `${r.name} ${c.id}: "${t.s}" sits in a tile`);
      const b = boxOf(t);
      lines++;
      assert.ok(b.x1 <= tile.x + tile.w + EPS && b.y1 <= tile.y + tile.h + EPS, `${r.name} ${c.id}: "${t.s}" (to ${b.x1.toFixed(2)}) is wider than tile ${tile.part} (to ${(tile.x + tile.w).toFixed(2)})`);
    }
  }
  assert.ok(lines > 40, String(lines));
  // The cases, on one tile each: one line; two lines; two lines a size smaller (#209 review: the text steps down before
  // anything is left out); the value alone; no value line. Each line with its size (in SMALLs).
  const tm = (w, h) => {
    const svg = R.chartRenderer("treemap")({ value: { display: "", value: 1290, unit: "tCO₂e", series: [{ label: "2025", values: [{ key: "A", value: 1290 }] }] }, w, h, theme: R.buildTheme({}), options: {}, label: "t" });
    return [...svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].slice(1).map((m) => `${m[2]} @${(Number(m[1]) / SVG.SMALL).toFixed(2)}`);
  };
  const S = SVG.SMALL;
  const room = (s) => SVG.labelWidth(s) + S + 1;
  assert.deepEqual(tm(room("1,290.000 · 100%"), S * 4), ["1,290.000 · 100% @1.00"]);
  assert.deepEqual(tm(room("1,290.000"), S * 5.2), ["1,290.000 @1.00", "100% @1.00"]);
  assert.deepEqual(tm(room("1,290.00"), S * 5.2), ["1,290.000 @0.90", "100% @0.90"]);
  assert.deepEqual(tm(room("1,290.000"), S * 4), ["1,290.000 @1.00"]);
  assert.deepEqual(tm(room("1,290"), S * 5.2), []);
});

test("horizontal bars in thin bands: totals step down a size, clear of each other and of the next band's bar; names thin out last", () => {
  const theme = R.buildTheme({});
  const years = ["2019", "2020", "2021", "2022", "2023", "2024", "2025"];
  const vals = [[16017.039, 21004.1, 9811.5], [7542.434, 14100.2, 19830.8], [41449.42, 3204.6, 6335.9], [50989.917, 2210.5, 1180.1], [24638.461, 9020.4, 12001.3], [19602.492, 17044.2, 3100.7], [14737.011, 7100.3, 2210.9]];
  const draw = (w, h, n) => {
    const keys = years.slice(0, n);
    const series = ["Scope 1", "Scope 2", "Scope 3"].map((label, si) => ({ label, values: keys.map((key, ki) => ({ key, value: vals[ki][si] })) }));
    const svg = R.chartRenderer("stacked_bar")({ value: { display: "", value: 1, unit: "tCO₂e", series }, w, h, theme, options: { horizontal: true }, label: "h" });
    const body = /<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1];
    const { texts, rects } = parseSvg(body);
    const totals = keys.map((_, ki) => RF.formatNumber(vals[ki].reduce((a, b) => a + b, 0), "auto", "tCO₂e"));
    const shown = texts.filter((t) => totals.includes(t.s));
    const names = texts.filter((t) => keys.includes(t.s));
    const bars = rects.filter((r) => r.w > 0.5 && r.h > 0.5 && r.y < h - SVG.SMALL * 2);
    for (const t of shown) {
      const b = boxOf(t);
      for (const r of bars) if (!(t.y >= r.y && t.y <= r.y + r.h && b.x0 >= r.x + r.w - EPS)) assert.ok(!SVG.boxesMeet(b, rectBox(r)), `${w}×${h}: "${t.s}" ${where(b)} meets a bar ${where(rectBox(r))}`);
    }
    for (const set of [shown, names])
      for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) assert.ok(!SVG.boxesMeet(boxOf(set[i]), boxOf(set[j])), `${w}×${h}: "${set[i].s}" meets "${set[j].s}"`);
    return { shown: shown.map((t) => t.s), size: shown[0]?.size, names: names.map((t) => t.s), nameSize: names[0]?.size, totals };
  };
  const S = SVG.SMALL;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  // Room enough: every total and name at the chart's size.
  const roomy = draw(372, 200, 6);
  assert.deepEqual([roomy.shown, roomy.size, roomy.names.length, roomy.nameSize], [roomy.totals, r3(S), 6, r3(S)]);
  // A band a little thinner than a label: every total and name kept, a size or three smaller, each after any longer bar its box would reach.
  const thin = draw(278, 100, 7);
  assert.deepEqual([thin.shown.slice().sort(), thin.names.length], [thin.totals.slice().sort(), 7]);
  assert.ok(thin.size < r3(S) && thin.size >= r3(S * 0.8) && thin.nameSize === thin.size, `${thin.size} ${thin.nameSize}`);
  // Too thin for the smallest size: a total that would meet its neighbour moves along after it while the chart has room
  // (6 of 7 here), else is left out with the latest year's kept; names go to every other band, ending on the latest.
  const shifted = draw(420, 92, 7);
  assert.ok(shifted.shown.length === 6 && shifted.shown.includes(shifted.totals[6]), JSON.stringify(shifted.shown));
  const tiny = draw(372, 71, 6);
  assert.ok(tiny.shown.includes(tiny.totals[5]) && tiny.shown.length < 6, JSON.stringify(tiny.shown));
  assert.equal(tiny.size, r3(S * 0.8));
  assert.deepEqual(tiny.names, ["2020", "2022", "2024"]);
});

test("scope_split keeps its shares, every legend figure and the whole basis note on every format, apart and inside the chart", () => {
  let n = 0;
  for (const { r, c } of ALL.filter((x) => x.c.kind === "scope_split")) {
    const donut = /data-variant="donut"/.test(c.body);
    const withNote = !(r.name.startsWith("DS-8 ") && c.id === "g.scope_donut" && !r.name.includes("with note"));
    const at = `${r.name} ${c.id}`;
    // The three shares (every part is over 8 %), a 3-decimal figure for each part in the legend, the note in full.
    const shares = c.texts.filter((t) => /^\d+%$/.test(t.s));
    assert.equal(shares.length, 3, `${at}: shares ${shares.map((t) => t.s)}`);
    const legend = c.texts.filter((t) => /^(Scope \d|20\d\d) [\d,]+\.\d{3}$/.test(t.s));
    assert.equal(legend.length, 3, `${at}: legend ${c.texts.map((t) => t.s).join(" | ")}`);
    const noteLines = c.texts.filter((t) => t.fill === r.muted && !legend.includes(t) && /[a-z]/.test(t.s) && !/^tCO₂e$/.test(t.s));
    if (withNote) assert.equal(noteLines.map((t) => t.s).join(" "), R.SCOPE2_BASIS_NOTE, `${at}: the note`);
    else assert.equal(noteLines.length, 0, `${at}: no note (basisNote off)`);
    // Legend, note, shares and the total line: inside the chart, none meeting another.
    const rows = c.texts.map((t) => ({ t, b: boxOf(t) }));
    for (const { t, b } of rows) {
      n++;
      assert.ok(b.x0 >= -EPS && b.x1 <= c.w + EPS && b.y0 >= -EPS && b.y1 <= c.h + EPS, `${at}: "${t.s}" ${where(b)} leaves the ${c.w}×${c.h} chart`);
    }
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) assert.ok(!SVG.boxesMeet(rows[i].b, rows[j].b), `${at}: "${rows[i].t.s}" meets "${rows[j].t.s}"`);
    if (!donut) {
      // The bar is tall enough for its share labels; the shares sit inside their segments; the legend and note under the bar.
      const bar = c.rects.filter((x) => x.part);
      assert.ok(bar[0].h >= SVG.SMALL * 1.1 - EPS, `${at}: bar ${bar[0].h}`);
      for (const s of shares) {
        const seg = bar.find((x) => s.x >= x.x && s.x <= x.x + x.w);
        const b = boxOf(s);
        assert.ok(b.x0 >= seg.x - EPS && b.x1 <= seg.x + seg.w + EPS && b.y0 >= seg.y - EPS && b.y1 <= seg.y + seg.h + EPS, `${at}: share ${s.s} outside its segment`);
      }
      for (const t of [...legend, ...noteLines]) assert.ok(boxOf(t).y0 >= bar[0].y + bar[0].h - EPS, `${at}: "${t.s}" over the bar`);
    }
  }
  assert.ok(n > 150, String(n));
  // Smaller and smaller frames: the text steps down to 5.2 pt first; only then, in order, the note's second sentence goes,
  // the note, the legend's figures, the legend. The total line (on two lines in a narrow frame) and the shares always stay;
  // nothing overlaps or leaves.
  const v = { display: "12,480.000", value: 12480, unit: "tCO₂e", series: [{ label: "2025", values: [{ key: "Scope 1", value: 3410 }, { key: "Scope 2", value: 5800 }, { key: "Scope 3", value: 3270 }] }] };
  const run = (w, h) => parseSvg(R.chartRenderer("scope_split")({ value: v, w, h, theme: R.buildTheme({}), options: {}, label: "s" })).texts;
  const content = (w, h) => {
    const t = run(w, h).map((x) => x.s);
    const note = t.filter((s) => /location-based|Market-based/.test(s)).join(" ");
    return [note === R.SCOPE2_BASIS_NOTE ? "note" : note === R.SCOPE2_BASIS_NOTE.split(" Market")[0] ? "short note" : note ? note : "no note", t.includes("Scope 2 5,800.000") ? "figures" : t.includes("Scope 2") ? "names" : "no legend", t.filter((s) => /^(Total|12,480\.000|tCO₂e)/.test(s)).join(" ") === "Total 12,480.000 tCO₂e" && ["27%", "46%", "26%"].every((s) => t.includes(s)) ? "total+shares" : "?"];
  };
  assert.deepEqual(content(200, 100), ["note", "figures", "total+shares"]);
  assert.ok(run(200, 62).some((t) => t.s === R.SCOPE2_BASIS_NOTE && t.size < SVG.SMALL), "200×62: the whole note, on one line a step smaller");
  assert.deepEqual(content(200, 62), ["note", "figures", "total+shares"]);
  assert.deepEqual(content(100, 80), ["short note", "figures", "total+shares"]);
  assert.deepEqual(content(100, 70), ["no note", "figures", "total+shares"]);
  assert.deepEqual(content(100, 60), ["no note", "names", "total+shares"]);
  assert.deepEqual(content(100, 40), ["no note", "no legend", "total+shares"]);
  // Too short even for the bar and its share labels: the total, with a sliver of a bar.
  assert.equal(run(100, 36).map((t) => t.s).join(" "), "Total 12,480.000 tCO₂e");
  for (const [w, h] of [[200, 100], [200, 62], [100, 80], [100, 70], [100, 60], [100, 40], [100, 36], [400, 34]]) {
    const rows = run(w, h).map((t) => ({ t, b: boxOf(t) }));
    for (const { t, b } of rows) assert.ok(b.y0 >= -EPS && b.y1 <= h + EPS && b.x1 <= w + EPS, `${w}×${h}: "${t.s}" ${where(b)}`);
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) assert.ok(!SVG.boxesMeet(rows[i].b, rows[j].b), `${w}×${h}: "${rows[i].t.s}" meets "${rows[j].t.s}"`);
  }
});
