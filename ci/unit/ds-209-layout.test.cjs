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

/**
 * A text's box: its ink (#209 round 4: SVG.inkBox, the glyphs it holds, alphabetic or middle baseline, never smaller than
 * any of the eight faces measured in Chromium, checked by the first test) across its measured width (labelWidth).
 */
const boxOf = (t) => SVG.inkBox(t.x, t.y, t.s, t.size, { anchor: t.anchor, bold: t.bold, baseline: t.baseline });
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
    // #209 round 4: the ink box (inkExtent) reaches at least as far above and below y as every glyph of the text in this
    // face, on the alphabetic baseline and on the middle one (moved down by the face's middleShift).
    assert.ok(m.middleShift > 0.2 && m.middleShift < 0.3, `${face} middleShift ${m.middleShift}`);
    for (const s of [...samples, ...texts, ...Object.keys(m.advance)]) {
      const chars = [...s].filter((ch) => ch in m.top);
      if (!chars.length) continue;
      const top = Math.max(...chars.map((ch) => m.top[ch]));
      const bottom = Math.max(...chars.map((ch) => m.bottom[ch]));
      const a = MET.inkExtent(s, "alphabetic");
      const mid = MET.inkExtent(s, "middle");
      assert.ok(a.up >= top - 1e-9 && a.down >= bottom - 1e-9, `${face} "${s}" ink ${top}/${bottom} vs ${a.up}/${a.down}`);
      assert.ok(mid.up >= top - m.middleShift - 1e-9 && mid.down >= bottom + m.middleShift - 1e-9, `${face} "${s}" middle ink ${(top - m.middleShift).toFixed(3)}/${(bottom + m.middleShift).toFixed(3)} vs ${mid.up}/${mid.down}`);
    }
  }
  // Every character the charts print is measured (top and bottom) in every face.
  for (const [face, m] of faces) for (const ch of Object.keys(m.advance)) assert.ok(Number.isFinite(m.top[ch]) && Number.isFinite(m.bottom[ch]), `${face} "${ch}" ink`);
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
  // anything is left out); the share alone; no value line. Each line with its size (in SMALLs).
  const tm = (w, h) => {
    const svg = R.chartRenderer("treemap")({ value: { display: "", value: 1290, unit: "tCO₂e", series: [{ label: "2025", values: [{ key: "A", value: 1290 }] }] }, w, h, theme: R.buildTheme({}), options: {}, label: "t" });
    return [...svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].slice(1).map((m) => `${m[2]} @${(Number(m[1]) / SVG.SMALL).toFixed(2)}`);
  };
  const S = SVG.SMALL;
  const room = (s) => SVG.labelWidth(s) + S + 1;
  assert.deepEqual(tm(room("1,290.000 · 100%"), S * 4), ["1,290.000 · 100% @1.00"]);
  assert.deepEqual(tm(room("1,290.000"), S * 5.2), ["1,290.000 @1.00", "100% @1.00"]);
  assert.deepEqual(tm(room("1,290.00"), S * 5.2), ["1,290.000 @0.90", "100% @0.90"]);
  // #209 round 4: two lines need their ink and some air (about 4.3 em), not 5.1 em: a 4-em tile keeps the share a step down.
  assert.deepEqual(tm(room("1,290.000"), S * 4), ["1,290.000 @0.90", "100% @0.90"]);
  // Room for one line only: the share (a tile with room for a value line prints at least its share).
  assert.deepEqual(tm(room("1,290.000"), S * 3.3), ["100% @1.00"]);
  assert.deepEqual(tm(room("1,290"), S * 5.2), ["100% @1.00"]);
  // Too narrow even for the share: the name alone.
  assert.deepEqual(tm(SVG.labelWidth("100%", S * 0.8) + S * 0.8 - 1, S * 5.2), []);
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
  // #209 round 4: fits are decided on the glyphs' ink, so a band that holds a total's figures (0.95 em with the comma) keeps
  // it at full size.
  const fits = draw(278, 100, 7);
  assert.deepEqual([fits.shown.slice().sort(), fits.size, fits.names.length, fits.nameSize], [fits.totals.slice().sort(), r3(S), 7, r3(S)]);
  // A band a little thinner than a label: every total and name kept, totals a size or more smaller, each after any longer
  // bar its ink would reach; the year names (0.8 em of ink) still fit at full size.
  const thin = draw(278, 90, 7);
  assert.deepEqual([thin.shown.slice().sort(), thin.names.length], [thin.totals.slice().sort(), 7]);
  assert.ok(thin.size < r3(S) && thin.size >= r3(S * 0.8) && thin.nameSize >= thin.size, `${thin.size} ${thin.nameSize}`);
  // Too thin for the smallest size: a total that would meet its neighbour moves along after it while the chart has room
  // (6 of 7 here), else is left out with the latest year's kept; names go to every other band, ending on the latest.
  const shifted = draw(420, 80, 7);
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
  // #209 round 4: the total line is one smaller line (never cut) before the note or the legend gives anything up.
  assert.deepEqual(content(100, 70), ["short note", "figures", "total+shares"]);
  assert.ok(run(100, 70).some((t) => t.s === "Total 12,480.000 tCO₂e" && t.size < SVG.FONT * 0.85), "100×70: the total on one smaller line");
  assert.deepEqual(content(100, 60), ["no note", "figures", "total+shares"]);
  assert.deepEqual(content(100, 50), ["no note", "names", "total+shares"]);
  assert.deepEqual(content(100, 40), ["short note", "no legend", "total+shares"]);
  assert.deepEqual(content(100, 36), ["no note", "no legend", "total+shares"]);
  // Too short even for the bar and its share labels: the total (one line), with a sliver of a bar.
  assert.equal(run(100, 26).map((t) => t.s).join(" "), "Total 12,480.000 tCO₂e");
  for (const [w, h] of [[200, 100], [200, 62], [100, 80], [100, 70], [100, 60], [100, 50], [100, 40], [100, 36], [100, 26], [400, 34]]) {
    const rows = run(w, h).map((t) => ({ t, b: boxOf(t) }));
    for (const { t, b } of rows) assert.ok(b.y0 >= -EPS && b.y1 <= h + EPS && b.x1 <= w + EPS, `${w}×${h}: "${t.s}" ${where(b)}`);
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) assert.ok(!SVG.boxesMeet(rows[i].b, rows[j].b), `${w}×${h}: "${rows[i].t.s}" meets "${rows[j].t.s}"`);
  }
});

// ---- #209 round 4 ------------------------------------------------------------------------------------------------------

/** A DS-8 fixture chart element alone on an A4 page, its frame resized to w × h mm; `display` replaces the 12,480.000 total. */
function alone(id, wmm, hmm, display) {
  const d = G.doc("a4");
  for (const p of d.pages) p.elements = p.elements.filter((e) => e.id === id).map((e) => ({ ...e, frame: { ...e.frame, x: 5, y: 5, w: wmm, h: hmm } }));
  d.pages = d.pages.filter((p) => p.elements.length);
  const data = G.data((bs, ts, payload) => R.renderData(bs, ts, display ? { ...payload, values: payload.values.map((v) => (v.display === "12,480.000" ? { ...v, display } : v)) } : payload));
  return charts(R.renderDocument(d, data, { mode: "sheet" }).html)[0];
}
/** Horizontal gridlines of a vertical value axis (y top to bottom, in tick order: the first is the axis's minimum). */
const gridYs = (c) => [...c.body.matchAll(/<line x1="([\d.-]+)" x2="([\d.-]+)" y1="([\d.-]+)" y2="\3"/g)].map((m) => num(m[3]));

test("round 4: a total line never takes the plot's room: the plot stays upright and at least PLOT_FLOOR tall, every part keeps a visible mark", () => {
  const ids = ["g.gas_split", "g.monthly_stack", "g.monthly_plain", "g.category_bars", "g.category_prior", "g.site_bars", "g.treemap"];
  let frames = 0;
  let multi = 0;
  for (const display of [null, "1,234,567.890"])
    for (const id of ids)
      for (let wmm = 25; wmm <= 120; wmm += 2.5)
        for (let hmm = 15; hmm <= 60; hmm += 2.5) {
          const c = alone(id, wmm, hmm, display);
          const at = `${id} ${wmm}×${hmm} mm${display ? ` (${display})` : ""}`;
          frames++;
          const parts = c.rects.filter((r) => r.part !== undefined);
          // Every part draws a mark of positive size (the fixture's parts are all positive).
          assert.ok(parts.length > 0, `${at}: no marks`);
          assert.ok(parts.every((r) => r.w > 0 && r.h > 0), `${at}: a mark of zero size ${parts.filter((r) => !(r.w > 0 && r.h > 0)).map((r) => `${r.part} ${r.w}×${r.h}`).join(", ")}`);
          const head = c.texts.filter((t) => t.bold && t.x === 0 && (/^Total/.test(t.s) || /\d,\d{3}\.\d{3}|tCO₂e/.test(t.s)));
          const headBottom = head.length ? Math.max(...head.map((t) => t.y + t.size * 0.6)) : 0;
          const ys = gridYs(c);
          if (ys.length > 1 && !["category_bars", "site_bars", "treemap"].includes(c.kind)) {
            // A vertical value axis: gridlines from the minimum (bottom) up, never upside down, never shorter than the floor.
            for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1], `${at}: the value axis runs downwards (${ys.join(", ")})`);
            const ph = ys[0] - ys[ys.length - 1];
            assert.ok(ph >= SVG.PLOT_FLOOR - EPS, `${at}: plot ${ph.toFixed(2)} under the floor`);
            // A total line of more than one line only while the plot keeps the room its tick labels need.
            if (head.length > 1) {
              multi++;
              assert.ok(ph >= Math.max(SVG.SMALL * 2, (ys.length - 1) * SVG.SMALL * 0.9) - EPS, `${at}: a ${head.length}-line total leaves a plot of ${ph.toFixed(2)}`);
            }
          }
          if (["category_bars", "site_bars"].includes(c.kind)) {
            const band = parts.length > 1 ? parts[1].y - parts[0].y : null;
            if (head.length > 1 && band !== null) {
              multi++;
              assert.ok(band >= SVG.SMALL * 1.1 - EPS, `${at}: a ${head.length}-line total leaves bands of ${band.toFixed(2)}`);
            }
            assert.ok(parts.every((r) => r.y >= headBottom - EPS), `${at}: a bar under the total line`);
          }
        }
  assert.ok(frames > 5000, String(frames));
  assert.ok(multi > 100, `charts that wrap their total line: ${multi}`);
  // The reviewers' cases (production drew these plots): the biggest mark keeps a visible size.
  for (const [id, w, hh] of [["g.gas_split", 30, 22.5], ["g.monthly_stack", 27.5, 25], ["g.monthly_plain", 25, 15], ["g.category_bars", 25, 17.5], ["g.category_prior", 25, 15]]) {
    const marks = alone(id, w, hh).rects.filter((r) => r.part !== undefined);
    assert.ok(Math.max(...marks.map((r) => Math.min(r.w, r.h))) > 0.5, `${id} ${w}×${hh}: ${marks.map((r) => `${r.w}×${r.h}`).join(" ")}`);
  }
});

/**
 * Seeded random charts (#209 round 4), in the reviewers' fuzz style: tCO₂e data at 3 decimals in frames 120–420 × 70–220
 * viewBox units, plus small and narrow frames down to 40 × 40. `kinds` picks the chart kinds. A fixed LCG, so every run
 * draws the same charts.
 */
function randomCharts(seed, n, kinds) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const theme = R.buildTheme({});
  const val = () => Math.round((rnd() < 0.3 ? rnd() * 200000 : rnd() * 20000) * 1000) / 1000;
  const years = (k) => Array.from({ length: k }, (_, i) => String(2019 + i));
  const disp = (v) => RF.formatNumber(v, "auto", "tCO₂e");
  const unit = "tCO₂e";
  const CATS = ["1 · Purchased goods and services", "4 · Upstream transportation and distribution", "6 · Business travel", "7 · Employee commuting", "5 · Waste generated in operations", "3 · Fuel- and energy-related activities", "2 · Capital goods", "Other"];
  const SITES = ["Manama plant", "Sitra warehouse", "Head office", "Muharraq depot", "Riffa lab", "Hidd port"];
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = pick(kinds);
    const small = rnd() < 0.25;
    const w = Math.round(small ? 40 + rnd() * 120 : 120 + rnd() * 300);
    const h = Math.round(small ? 40 + rnd() * 80 : 70 + rnd() * 150);
    let value;
    let rk = kind;
    const options = {};
    const k = 2 + Math.floor(rnd() * 6);
    if (kind === "bar" || kind === "hbar" || kind === "target_bars" || kind === "waterfall") {
      value = { display: "", value: 1, unit, series: [{ label: "Total", values: years(k).map((key) => ({ key, value: val() })) }] };
      if (kind === "target_bars") value.target = { baseline: val(), value: val(), year: 2030 };
      if (kind === "hbar") (rk = "bar"), (options.horizontal = true);
    } else if (kind === "stacked_bar" || kind === "hstacked") {
      value = { display: "", value: 1, unit, series: ["Scope 1", "Scope 2", "Scope 3"].map((label) => ({ label, values: years(k).map((key) => ({ key, value: val() / 3 })) })) };
      if (kind === "hstacked") (rk = "stacked_bar"), (options.horizontal = true);
    } else if (kind === "gas_split") {
      value = { display: "12,480.000", value: 12480, unit, series: ["2024", "2025"].map((label) => ({ label, unit: "t", values: [{ key: "CO₂", value: val() }, { key: "CH₄", value: Math.round(rnd() * 5000) / 10 }, { key: "N₂O", value: Math.round(rnd() * 500) / 10 }] })) };
    } else if (kind === "monthly_stack" || kind === "monthly_plain") {
      const months = Array.from({ length: 12 }, (_, m) => `2025-${String(m + 1).padStart(2, "0")}`);
      value = { display: "12,480.000", value: 12480, unit, series: [{ label: "2025", values: months.map((key) => ({ key, value: val() })) }] };
      if (kind === "monthly_stack") value.stacks = ["Scope 1", "Scope 2", "Scope 3"].map((label) => ({ label, values: months.map((key) => ({ key, value: val() / 3 })) }));
      rk = "monthly_stack";
    } else if (kind === "base_year_waterfall") {
      const a = val() + 5000;
      const b = val() + 5000;
      value = { display: disp(b), value: b, unit, series: [{ label: "2022", values: [{ key: "Scope 1", value: a * 0.3 }, { key: "Scope 2", value: a * 0.4 }, { key: "Scope 3", value: a * 0.3 }] }, { label: "2025", values: [{ key: "Scope 1", value: b * 0.25 }, { key: "Scope 2", value: b * 0.45 }, { key: "Scope 3", value: b * 0.3 }] }] };
    } else if (kind === "bridge_compare") {
      const base = val() + 1000;
      const cur = val() + 1000;
      rk = "base_year_waterfall";
      value = { display: disp(cur), value: cur, unit, series: [{ label: "Total emissions", values: [{ key: "2024", value: val() + 1000 }, { key: "2025", value: cur }] }], compare: { against: "base", year: 2019, value: base } };
    } else if (kind === "intensity_line") {
      value = { display: "41.6", value: 41.6, unit: "tCO₂e per unit of revenue", series: [{ label: "Intensity", values: years(k).map((key) => ({ key, value: Math.round(rnd() * 100000) / 1000 })) }] };
    } else if (kind === "category_bars" || kind === "category_prior" || kind === "site_bars" || kind === "treemap") {
      const names = kind === "site_bars" ? SITES : CATS;
      const keys = names.slice(0, 2 + Math.floor(rnd() * (names.length - 2)));
      const cur = keys.map((key) => ({ key, value: val() / 10 }));
      const sum = cur.reduce((a, x) => a + x.value, 0);
      value = { display: disp(sum), value: sum, unit, series: [{ label: "2025", values: cur }] };
      if (kind === "category_prior") (rk = "category_bars"), value.series.unshift({ label: "2024", values: keys.map((key) => ({ key, value: val() / 10 })) });
    } else if (kind === "donut") {
      const parts = ["Scope 1", "Scope 2", "Scope 3", "Biogenic", "Other"].slice(0, 2 + Math.floor(rnd() * 4));
      value = { display: "", value: null, unit, series: parts.map((label) => ({ label, values: [{ key: "2025", value: rnd() < 0.2 ? val() / 40 : val() }] })) };
      const sum = value.series.reduce((a, x) => a + x.values[0].value, 0);
      value.display = disp(sum);
      value.value = sum;
    } else {
      const parts = ["Scope 1", "Scope 2", "Scope 3"].map((key) => ({ key, value: rnd() < 0.15 ? val() / 200 : val() }));
      const sum = parts.reduce((a, x) => a + x.value, 0);
      value = { display: disp(sum), value: sum, unit, series: [{ label: "2025", values: parts }] };
      rk = "scope_split";
      if (kind === "scope_donut") options.variant = "donut";
      if (rnd() < 0.3) options.basisNote = false;
    }
    const svg = R.chartRenderer(rk)({ value, w, h, theme, options, label: kind });
    const body = /<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1];
    out.push({ i, kind, w, h, value, options, svg, body, ...parseSvg(body) });
  }
  return out;
}

test("round 4: a kept-first label (latest total, waterfall start and end, bridge base and current) is never left out while a lower one is drawn", () => {
  // fitLabelRow: a bold label blocked by a tall neighbour more than two lines up rises above it rather than be left out,
  // and a lower label is left out first.
  const S = SVG.SMALL;
  const tall = { x0: 70, x1: 90, y0: 30, y1: 200, owner: 1 };
  const own = { x0: 40, x1: 60, y0: 150, y1: 200, owner: 0 };
  const row = () => ({ labels: [{ x: 50, y: 150 - S * 0.5, text: "12,480.000", bold: true }, { x: 80, y: 30 - S * 0.5, text: "93,000.000" }], obstacles: [own, tall] });
  const f = SVG.fitLabelRow(row, 120, 200);
  assert.ok(f.labels[0], "the bold label is drawn");
  const b = SVG.labelBox(f.labels[0].x, f.labels[0].y, "12,480.000", f.size, { anchor: "middle", bold: true });
  assert.ok(!SVG.boxesMeet(b, tall) && b.y0 >= 0, "clear of the tall bar, inside the chart");
  // Over random charts: the kept-first labels are drawn whenever any lower label of the row is (in a plot with the room its
  // axis needs; a frame too small for its plot may have no line above its bars for any label).
  const VAL = /^[+−]?\d[\d,]*(\.\d+)?$/;
  let rows = 0;
  for (const c of randomCharts(4209, 400, ["bar", "stacked_bar", "waterfall", "target_bars", "base_year_waterfall", "bridge_compare"])) {
    const ys = gridYs(c);
    if (ys.length < 2 || ys[0] - ys[ys.length - 1] < Math.max(SVG.SMALL * 2, (ys.length - 1) * SVG.SMALL * 0.9)) continue;
    const muted = R.buildTheme({}).colors.muted;
    const vals = c.texts.filter((t) => VAL.test(t.s) && t.fill !== muted);
    const pts = c.kind === "bar" || c.kind === "target_bars" || c.kind === "waterfall" ? c.value.series[0].values : null;
    let first;
    let all;
    if (c.kind === "bar" || c.kind === "stacked_bar") {
      const keys = c.value.series[0].values.map((p) => p.key);
      const tot = keys.map((key) => c.value.series.reduce((a, s) => a + Math.max(0, s.values.find((p) => p.key === key).value), 0));
      all = tot.map((v) => RF.formatNumber(v, "auto", "tCO₂e"));
      first = [all[all.length - 1]];
    } else if (c.kind === "target_bars") {
      all = pts.map((p) => RF.formatNumber(p.value, "auto", "tCO₂e"));
      first = [all[all.length - 1]];
    } else {
      const steps = c.kind === "waterfall" ? null : require(path.resolve("dist/reporting/studio/render/charts/ghg/trend.js")).bridgeSteps(c.value);
      const ends = c.kind === "waterfall" ? [pts[0].value, pts[pts.length - 1].value] : [steps[0].to, steps[steps.length - 1].to];
      first = ends.map((v) => RF.formatNumber(v, "auto", "tCO₂e"));
      all = vals.map((t) => t.s);
    }
    const drawn = vals.map((t) => t.s);
    const lower = drawn.filter((s) => !first.includes(s));
    if (!lower.length) continue;
    rows++;
    for (const s of first) assert.ok(drawn.includes(s), `#${c.i} ${c.kind} ${c.w}×${c.h}: kept-first "${s}" left out while ${lower.join(", ")} drawn`);
  }
  assert.ok(rows > 150, String(rows));
});

test("round 4: ranked and horizontal bars keep the labels and names production drew clear (decided on ink, not an em box plus air)", () => {
  const S = SVG.SMALL;
  const muted = R.buildTheme({}).colors.muted;
  const clear = (c, at) => {
    // Value labels: figures in ink after their bars (names sit before the axis, end-anchored).
    const vals = c.texts.filter((t) => VALUE.test(t.s) && t.fill !== muted && t.anchor !== "end");
    const bars = c.rects.filter((r) => r.part !== undefined || r.fill !== muted);
    for (const t of vals) {
      const b = boxOf(t);
      const own = bars.filter((r) => t.y >= r.y - EPS && t.y <= r.y + r.h + EPS && b.x0 >= r.x + r.w - EPS);
      for (const r of bars) if (!own.includes(r) && r.w > 0.5 && r.h > 0.5) assert.ok(!SVG.boxesMeet(b, rectBox(r)), `${at}: "${t.s}" ${where(b)} meets a bar ${where(rectBox(r))}`);
      for (const u of vals) if (u !== t) assert.ok(!SVG.boxesMeet(b, boxOf(u)), `${at}: "${t.s}" meets "${u.s}"`);
    }
    return vals.map((t) => t.s);
  };
  // The DS-8 category bars 3.5 mm shorter than the social_191 frame: production drew 1,290, 620 and 410 clear of every bar.
  assert.deepEqual(clear(alone("g.category_bars", 136.07, 30), "category_bars 136×30").sort(), ["1,290.000", "410.000", "620.000"]);
  assert.ok(clear(alone("g.category_prior", 136.07, 26), "category_prior 136×26").includes("620.000"));
  // Seven years in a band of about 8 units: every name at full size, every total right after its own bar.
  const vals = [14989.417, 1758.997, 16766.405, 12775.164, 29916.859, 96447.361, 16412.877];
  const keys = ["2019", "2020", "2021", "2022", "2023", "2024", "2025"];
  const svg = R.chartRenderer("bar")({ value: { display: "", value: 1, unit: "tCO₂e", series: [{ label: "Total", values: keys.map((key, i) => ({ key, value: vals[i] })) }] }, w: 334, h: 75, theme: R.buildTheme({}), options: { horizontal: true }, label: "h" });
  const c = { ...parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1]) };
  const names = c.texts.filter((t) => keys.includes(t.s));
  assert.deepEqual(names.map((t) => [t.s, t.size]), keys.map((k) => [k, Math.round(S * 1000) / 1000]), "every year named at full size");
  const totals = clear(c, "hbar 334×75");
  assert.equal(totals.length, 7, totals.join(", "));
  const bars = c.rects.filter((r) => r.w > 0.5 && r.h > 0.5 && r.y < 70);
  for (const t of c.texts.filter((x) => VALUE.test(x.s) && x.anchor === "start")) {
    const own = bars.find((r) => t.y >= r.y && t.y <= r.y + r.h);
    assert.ok(own && t.x - (own.x + own.w) <= S * 0.4 + EPS, `"${t.s}" sits ${(t.x - own.x - own.w).toFixed(1)} after its bar's end`);
  }
});

test("round 4: a treemap tile with room for one value line prints at least its share", () => {
  // The fixture tiles production printed "300 · 9.2%", "140 · 4.3%" and "180 · 5.5%" in: the 3-decimal value doesn't fit, the share does.
  const tm = (name, id = "g.treemap") => ALL.find(({ r, c }) => r.name === name && c.id === id).c.texts.map((t) => t.s);
  assert.ok(tm("DS-8 a5").includes("9.2%") && tm("DS-8 a5").includes("4.3%"), tm("DS-8 a5").join(" | "));
  assert.ok(tm("DS-8 social_191").includes("5.5%"), tm("DS-8 social_191").join(" | "));
  // Random treemaps: every named tile tall and wide enough for its share at the smallest step prints it.
  const S = SVG.SMALL * 0.8;
  let tiles = 0;
  for (const c of randomCharts(5209, 300, ["treemap"])) {
    const parts = c.value.series[0].values;
    const sum = parts.reduce((a, p) => a + p.value, 0);
    for (const r of c.rects.filter((x) => x.part)) {
      const inTile = c.texts.filter((t) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
      if (!inTile.some((t) => t.bold)) continue; // the tile is too small for its name: nothing printed, as production
      const v = parts.find((p) => p.key === r.part).value / sum;
      const share = `${RF.formatNumber(v * 100, v * 100 < 10 ? "1dp" : "int")}%`;
      if (r.h < S * (2.6 + 0.05 + 0.3) || SVG.labelWidth(share, S) > r.w - S) continue;
      tiles++;
      assert.ok(inTile.some((t) => t.s === share || t.s.endsWith(` · ${share}`)), `#${c.i} ${c.w}×${c.h} tile ${r.part} ${r.w.toFixed(1)}×${r.h.toFixed(1)}: ${inTile.map((t) => t.s).join(" | ")} (share ${share})`);
    }
  }
  assert.ok(tiles > 500, String(tiles));
});
