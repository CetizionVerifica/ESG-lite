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
    // #209 round 5: except a figure wider than the first column's band, which sits over that column's middle as production
    // drew it, its ink over the axis gutter (clear of the tick labels: muted texts, above). Pressed inside the plot's edge it
    // was centred over the second column (DS-8 A4 monthly_stack: "1,130.000" over February, the reviewers' finding A).
    const axis = /<line x1="([\d.]+)" x2="[\d.]+" y1="([\d.]+)" y2="\2"/.exec(c.body);
    if (axis && ["bar", "stacked_bar", "waterfall", "target_bars", "gas_split", "monthly_stack", "base_year_waterfall", "intensity_line"].includes(c.kind))
      for (const { t, b } of boxes) {
        if (t.anchor !== "middle" || b.x0 >= num(axis[1]) - EPS) continue;
        const first = bars.filter((x) => x.x >= num(axis[1]) - EPS).reduce((a, x) => (x.x < a.x ? x : a), { x: Infinity });
        const band = Math.min(...bars.filter((x) => x.x > first.x + EPS).map((x) => x.x)) - first.x;
        assert.ok(Math.abs(t.x - (first.x + first.w / 2)) < EPS && b.x1 - b.x0 > band, `${r.name} ${c.id}: "${t.s}" starts at ${b.x0.toFixed(2)}, left of the plot at ${axis[1]}`);
      }
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
  // The real displays need it: on A5 and social_191 the DS-1 donut's figure steps down to fit its hole (#209 round 4: on
  // social_191 the ring keeps room only on the sides with a share label, so its hole now holds the figure); a ring too small
  // for the figure puts it under the donut, with its unit.
  const donut = (format) => ALL.find(({ r, c }) => r.name === `DS-1 ${format}` && c.id === "p-summary.donut").c;
  for (const format of ["a5", "social_191"]) {
    const fig = donut(format).texts.find((t) => t.s === "12,480.000");
    assert.ok(fig && fig.size < SVG.FONT * 1.4 - EPS && fig.size >= SVG.SMALL - EPS, `${format} ${fig?.size}`);
  }
  const theme = R.buildTheme({});
  const small = { display: "12,480.000", value: 12480, unit: "tCO₂e", series: ["Scope 1", "Scope 2", "Scope 3"].map((label, i) => ({ label, values: [{ key: "2025", value: [3410, 5800, 3270][i] }] })) };
  const under = parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(R.chartRenderer("donut")({ value: small, w: 300, h: 70, theme, options: {}, label: "donut" }))[1]);
  assert.ok(under.texts.some((t) => t.s === "12,480.000 tCO₂e"), "a 300 × 70 donut: the figure under the donut, with its unit");
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
  // #209 round 5: measured per face (textWidth: the widest face's own sum), both sentences fit 100 mm at the smallest step.
  assert.deepEqual(content(100, 80), ["note", "figures", "total+shares"]);
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
function randomCharts(seed, n, kinds, frame = null) {
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
    let w = Math.round(small ? 40 + rnd() * 120 : 120 + rnd() * 300);
    let h = Math.round(small ? 40 + rnd() * 80 : 70 + rnd() * 150);
    if (frame) ({ w, h } = frame(rnd));
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
  // #209 round 5: kept first means placed first, so a lower label never takes its room; it never means lifted onto a taller
  // neighbour (round 4 let it rise past the two-line limit, where it read as the neighbour's value). fitLabelRow: a bold label
  // blocked by a tall neighbour more than two lines up moves sideways, still over its own mark, and the lower label is left out
  // where they would meet.
  const S = SVG.SMALL;
  const tall = SVG.rectBox(70, 30, 20, 170, 1);
  const own = SVG.rectBox(40, 150, 20, 50, 0);
  const row = () => ({ labels: [{ x: 50, y: 150 - S * 0.5, text: "12,480.000", bold: true }, { x: 80, y: 30 - S * 0.5, text: "93,000.000" }], obstacles: [own, tall] });
  const f = SVG.fitLabelRow(row, 120, 200);
  assert.ok(f.labels[0], "the bold label is drawn");
  const b = SVG.labelBox(f.labels[0].x, f.labels[0].y, "12,480.000", f.size, { anchor: "middle", bold: true });
  assert.ok(!SVG.boxesMeet(b, tall) && b.y0 >= 0, "clear of the tall bar, inside the chart");
  assert.ok(b.x0 <= 50 && b.x1 >= 50 && b.y1 <= 150 + EPS, `over its own bar: ${where(b)}`);
  // Over random charts: a kept-first label is left out (while lower ones are drawn) only when no spot over its own column fits
  // it at the smallest step (keptFirstLeftOut, #209 round 5); every drawn label reads as its own column's.
  let rows = 0;
  for (const c of randomCharts(4209, 400, ["bar", "stacked_bar", "waterfall", "target_bars", "base_year_waterfall", "bridge_compare"])) {
    const ys = gridYs(c);
    if (ys.length < 2 || ys[0] - ys[ys.length - 1] < Math.max(SVG.SMALL * 2, (ys.length - 1) * SVG.SMALL * 0.9)) continue;
    const own = ownedLabels(c);
    if (own.cols.length !== own.want.length || !own.labels.some((l) => !own.want[l.k].first)) continue;
    rows++;
    assert.deepEqual(keptFirstLeftOut(c), [], `#${c.i} ${c.kind} ${c.w}×${c.h}`);
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
  // On social_191, production drew "440" right after its bar, its ink 0.27 units clear of the prior year's bar under it: the
  // label stays there (it doesn't jump past the longer prior bar).
  const cp = ALL.find(({ r, c }) => r.name === "DS-8 social_191" && c.id === "g.category_prior").c;
  const t440 = cp.texts.find((t) => t.s === "440.000");
  const own440 = cp.rects.find((r) => r.part === "Other");
  assert.ok(t440 && Math.abs(t440.x - (own440.x + own440.w) - S * 0.4) < EPS, `440.000 at ${t440?.x} after its bar's end ${own440.x + own440.w}`);
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

/** A donut's ring radius and centre, read from its first arc (as the donut test above). */
function ringOf(c) {
  const d = /<path d="(M[^"]+)" fill="[^"]+" fill-rule="evenodd"/.exec(c.body)?.[1];
  if (!d) return null;
  const m = /^M([-\d.]+) ([-\d.]+)A([-\d.]+) /.exec(d);
  const r = num(m[3]);
  const [cx, cy] = /ZM/.test(d) ? [num(m[1]) - r, num(m[2])] : [num(m[1]), num(m[2]) + r];
  return { r, cx, cy };
}

test("round 4: a plain donut keeps a ring and the share labels production drew clear; room only on the sides with a label", () => {
  // Production (ab0b6e3): r = min(w, h − 2 SMALL) / 2 − 1.6 FONT around the plot's middle, every part ≥ 4 % labelled at r + FONT,
  // the figure (FONT × 1.4, bold) and its unit in the middle, the legend along the foot (unchanged). A production label is clear
  // when its ink stays in the chart and meets no other production text; the new render draws each of those, and a ring
  // never under min(FONT, production's) where production's was positive.
  const S = SVG.SMALL;
  const F = SVG.FONT;
  const theme = R.buildTheme({});
  const muted = theme.colors.muted;
  const ink = (x, y, s, size, o) => SVG.inkBox(x, y, s, size, o);
  const pctOf = (x) => `${RF.formatNumber(x * 100, x * 100 < 10 ? "1dp" : "int")}%`;
  const cases = randomCharts(8209, 300, ["donut"]);
  const base = cases[0].value;
  for (let w = 50; w <= 150; w += 10) for (let h = 90; h <= 250; h += 20) cases.push({ ...cases[0], w, h, value: base, custom: true });
  let checked = 0;
  let kept = 0;
  let small = 0;
  for (const c0 of cases) {
    const c = c0.custom ? { ...c0, ...(() => { const svg = R.chartRenderer("donut")({ value: c0.value, w: c0.w, h: c0.h, theme, options: {}, label: "donut" }); const body = /<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1]; return { svg, body, ...parseSvg(body) }; })() } : c0;
    const at = `#${c.i}${c.custom ? " sweep" : ""} ${c.w}×${c.h}`;
    const ps = c.value.series.map((s) => s.values[0].value).filter((v) => v > 0);
    const sum = ps.reduce((a, v) => a + v, 0);
    const plotH = c.h - S * 2;
    const rp = Math.min(c.w, plotH) / 2 - F * 1.6;
    const got = ringOf(c);
    assert.ok(got && got.r > 0, `${at}: no ring`);
    if (rp <= 0) continue;
    // Never near zero where production's was positive: at least SMALL × 0.5, and at least FONT × 0.5 or production's.
    assert.ok(got.r >= Math.max(S * 0.5, Math.min(F * 0.5, rp)) - EPS, `${at}: ring ${got.r} (production's ${rp.toFixed(2)})`);
    if (got.r < Math.min(F, rp) - EPS) small++;
    // A production ring under SMALL × 0.5 (near zero) grows: its labels move out and may give way.
    if (rp < S * 0.5) continue;
    const legendTexts = c.texts.filter((t) => t.fill === muted && Math.abs(t.y - (c.h - S * 0.3)) < 0.01);
    const prod = [];
    let a0 = -Math.PI / 2;
    for (const v of ps) {
      const share = v / sum;
      const mid = a0 + share * Math.PI;
      a0 += share * Math.PI * 2;
      if (share < 0.04) continue;
      const anchor = Math.cos(mid) > 0.2 ? "start" : Math.cos(mid) < -0.2 ? "end" : "middle";
      const s = pctOf(share);
      prod.push({ s, b: ink(c.w / 2 + (rp + F) * Math.cos(mid), plotH / 2 + (rp + F) * Math.sin(mid), s, S, { anchor, baseline: "middle" }) });
    }
    const others = [ink(c.w / 2, plotH / 2, c.value.display, F * 1.4, { anchor: "middle", bold: true, baseline: "middle" }), ink(c.w / 2, plotH / 2 + F * 1.4, c.value.unit, S, { anchor: "middle", baseline: "middle" }), ...legendTexts.map(boxOf)];
    const clear = prod.filter((p) => p.b.x0 >= 0 && p.b.x1 <= c.w && p.b.y0 >= 0 && p.b.y1 <= c.h && !others.some((o) => SVG.boxesMeet(p.b, o)) && !prod.some((q) => q !== p && SVG.boxesMeet(p.b, q.b)));
    const drawn = c.texts.filter((t) => t.fill !== muted && /%$/.test(t.s)).map((t) => t.s);
    for (const p of clear) {
      checked++;
      const i = drawn.indexOf(p.s);
      assert.ok(i >= 0, `${at}: production's clear share ${p.s} is left out (drawn: ${drawn.join(", ")})`);
      drawn.splice(i, 1);
      kept++;
    }
  }
  assert.ok(checked > 300, String(checked));
  assert.equal(kept, checked);
  console.log("donut small rings", small, "of", cases.length);
  // A narrow donut with its labels on the right side only keeps no room on the left: the ring sits off the middle.
  const one = { display: "12,480.000", value: 12480, unit: "tCO₂e", series: [{ label: "A", values: [{ key: "2025", value: 30 }] }, { label: "B", values: [{ key: "2025", value: 70 }] }] };
  const svg = R.chartRenderer("donut")({ value: one, w: 300, h: 200, theme, options: {}, label: "donut" });
  const ring = ringOf({ body: /<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1] });
  assert.ok(ring.r > Math.min(300, 200 - S * 2) / 2 - F * 1.6, `the ring ${ring.r} is bigger than production's`);
});

test("round 4: a scope_split donut gives up the note and the legend's figures before the scope names, and keeps a ring", () => {
  // Over random frames, small and narrow too: the three scope names are always drawn (in the legend, with or without their
  // figures), the ring is never under FONT × 0.5 (production's: FONT), and nothing leaves the chart.
  let n = 0;
  let namesOnly = 0;
  for (const c of randomCharts(7209, 400, ["scope_donut"])) {
    const at = `#${c.i} ${c.w}×${c.h}${c.options.basisNote === false ? " (no note)" : ""}`;
    n++;
    for (const s of ["Scope 1", "Scope 2", "Scope 3"]) assert.ok(c.texts.some((t) => t.s === s || t.s.startsWith(`${s} `)), `${at}: ${s} is not drawn (${c.texts.map((t) => t.s).join(" | ")})`);
    if (c.texts.some((t) => t.s === "Scope 1")) namesOnly++;
    const ring = ringOf(c);
    assert.ok(ring && ring.r >= SVG.FONT * 0.5 - EPS, `${at}: ring ${ring?.r}`);
    for (const t of c.texts) {
      const b = boxOf(t);
      assert.ok(b.x0 >= -EPS && b.x1 <= c.w + EPS && b.y0 >= -EPS && b.y1 <= c.h + EPS, `${at}: "${t.s}" ${where(b)} leaves the chart`);
    }
  }
  assert.ok(n > 100 && namesOnly > 5, `${n} ${namesOnly}`);
});

/** The tick labels under a horizontal value axis: muted, centred, all on the axis line's baseline (the lowest such row). */
function hTicks(c) {
  const muted = R.buildTheme({}).colors.muted;
  const cand = c.texts.filter((t) => t.fill === muted && t.anchor === "middle" && /^[−-]?\d[\d,.]*(k|m|bn)?$/.test(t.s));
  if (!cand.length) return [];
  const y = Math.max(...cand.map((t) => t.y));
  return cand.filter((t) => Math.abs(t.y - y) < 0.01).sort((a, b) => a.x - b.x);
}

test("round 4: a horizontal value axis never prints tick labels over each other, and leaves one out only when it has no room", () => {
  // fitBarEnds narrows the plot for 3-decimal totals after the bar ends; the tick labels step down (to 80 %), the plot narrows
  // no further than keeps as many of them as production's width did (tickFloorX), and a label is left out only where, at the
  // size the others take, it would come within SMALL × 0.1 of a neighbour's ink. Every gridline stays.
  const mult = { k: 1e3, m: 1e6, bn: 1e9 };
  const valueOf = (s) => { const m = /^([−-]?)([\d,.]+)(k|m|bn)?$/.exec(s); return (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, "")) * (m[3] ? mult[m[3]] : 1); };
  let charts = 0;
  let thinned = 0;
  for (const c of randomCharts(6209, 500, ["hbar", "hstacked", "category_bars", "category_prior", "site_bars"])) {
    const ticks = hTicks(c);
    const xs = [...c.body.matchAll(/<line x1="([\d.-]+)" x2="\1" y1="([\d.-]+)" y2="([\d.-]+)"/g)].map((m) => num(m[1])).sort((a, b) => a - b);
    if (xs.length < 2 || ticks.length < 2) continue;
    charts++;
    const at = `#${c.i} ${c.kind} ${c.w}×${c.h}`;
    for (let i = 1; i < ticks.length; i++) {
      const a = boxOf(ticks[i - 1]);
      const b = boxOf(ticks[i]);
      assert.ok(!SVG.boxesMeet(a, b), `${at}: tick "${ticks[i - 1].s}" ${where(a)} meets "${ticks[i].s}" ${where(b)}`);
    }
    if (ticks.length === xs.length) continue;
    thinned++;
    // The left-out labels: their value from the drawn ones (evenly spaced ticks), at the drawn labels' size.
    const idx = ticks.map((t) => xs.findIndex((x) => Math.abs(x - t.x) < 0.01));
    assert.ok(idx.every((j) => j >= 0), `${at}: a tick label off its gridline`);
    const step = (valueOf(ticks[1].s) - valueOf(ticks[0].s)) / (idx[1] - idx[0]);
    xs.forEach((x, j) => {
      if (idx.includes(j)) return;
      const label = RF.tickLabel(valueOf(ticks[0].s) + (j - idx[0]) * step);
      const box = SVG.inkBox(x, ticks[0].y, label, ticks[0].size, { anchor: "middle" });
      const near = ticks.map(boxOf).some((b) => SVG.boxesMeet(b, box, SVG.SMALL * 0.1 - EPS));
      assert.ok(near, `${at}: tick "${label}" at ${x.toFixed(2)} is left out with room (${ticks.map((t) => t.s).join(" ")})`);
    });
  }
  assert.ok(charts > 300 && thinned > 0, `${charts} ${thinned}`);
});

test("round 4: before a row label is left out it moves sideways or rises within the plot's room (production's clear labels stay)", () => {
  // Two charts from the reviewers' fuzz (BE seed 11 #72, ext seed 5 #488): production drew every total clear at 6.5 pt; at
  // 3 decimals the row needs the smallest step, and a label that meets a neighbour moves sideways (still over its bar) or
  // rises a little in the room the plot has, rather than be left out.
  const theme = R.buildTheme({});
  const muted = theme.colors.muted;
  const yrs = ["2019", "2020", "2021", "2022", "2023", "2024", "2025"];
  const series = (label, vs) => ({ label, values: vs.map((value, i) => ({ key: yrs[i], value })) });
  const cases = [
    { kind: "bar", w: 200, h: 159, value: { display: "", value: 1, unit: "tCO₂e", series: [series("Total", [18005.321, 80700.761, 13855.5, 194909.912, 19382.415, 16648.078, 16046.615])] }, want: ["18,005.321"] },
    {
      kind: "stacked_bar",
      w: 246,
      h: 80,
      value: {
        display: "",
        value: 1,
        unit: "tCO₂e",
        series: [
          series("Scope 1", [2197.824, 3323.681, 23264.299, 6531.713, 38751.541, 3757.941, 4246.197]),
          series("Scope 2", [1177.12, 6232.76, 2513.246, 3002.665, 5091.561, 6245.348, 3457.434]),
          series("Scope 3", [2494.013, 19305.255, 65148.942, 65591.321, 49504.423, 2841.818, 2679.706]),
        ],
      },
      want: ["5,868.957", "28,861.696", "90,926.487", "75,125.699", "93,347.525", "12,845.107", "10,383.337"],
    },
  ];
  for (const c of cases) {
    const svg = R.chartRenderer(c.kind)({ value: c.value, w: c.w, h: c.h, theme, options: {}, label: c.kind });
    const p = parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1]);
    const vals = p.texts.filter((t) => t.fill !== muted && VALUE.test(t.s));
    for (const s of c.want) assert.ok(vals.some((t) => t.s === s), `${c.kind} ${c.w}×${c.h}: ${s} is left out (${vals.map((t) => t.s).join(" ")})`);
    const boxes = vals.map(boxOf);
    boxes.forEach((b, i) => {
      assert.ok(b.x0 >= -EPS && b.x1 <= c.w + EPS && b.y0 >= -EPS && b.y1 <= c.h + EPS, `${c.kind}: ${vals[i].s} leaves the chart`);
      boxes.forEach((q, j) => j > i && assert.ok(!SVG.boxesMeet(b, q), `${c.kind}: ${vals[i].s} meets ${vals[j].s}`));
      for (const t of p.texts.filter((x) => x.fill === muted)) assert.ok(!SVG.boxesMeet(b, boxOf(t)), `${c.kind}: ${vals[i].s} meets "${t.s}"`);
    });
  }
});

/** A vertical value axis's gridlines alone: the leading run of rising lines (a target's or baseline's lines come after). */
const axisYs = (c) => {
  const ys = gridYs(c);
  let n = 1;
  while (n < ys.length && ys[n] < ys[n - 1]) n++;
  return ys.slice(0, n);
};

/** Item 9 (round 4): the frames of the combined regression test: small, narrow, short and ordinary. */
const mixedFrames = (rnd) => {
  const r = rnd();
  if (r < 0.3) return { w: Math.round(40 + rnd() * 120), h: Math.round(40 + rnd() * 80) };
  if (r < 0.5) return { w: Math.round(40 + rnd() * 50), h: Math.round(100 + rnd() * 160) };
  if (r < 0.6) return { w: Math.round(160 + rnd() * 260), h: Math.round(40 + rnd() * 30) };
  return { w: Math.round(120 + rnd() * 300), h: Math.round(70 + rnd() * 150) };
};

test("round 4: seeded random charts over small, narrow and short frames keep plots, rings, kept-first labels, tick labels, scope names and tile shares", () => {
  const ALL_KINDS = ["bar", "hbar", "target_bars", "waterfall", "stacked_bar", "hstacked", "gas_split", "monthly_stack", "monthly_plain", "base_year_waterfall", "bridge_compare", "intensity_line", "category_bars", "category_prior", "site_bars", "treemap", "donut", "scope_split", "scope_donut"];
  const VERTICAL = new Set(["bar", "target_bars", "waterfall", "stacked_bar", "gas_split", "monthly_stack", "monthly_plain", "base_year_waterfall", "bridge_compare", "intensity_line"]);
  const HORIZONTAL = new Set(["hbar", "hstacked", "category_bars", "category_prior", "site_bars"]);
  const muted = R.buildTheme({}).colors.muted;
  const S8 = SVG.SMALL * 0.8;
  const seen = {};
  const checks = { plots: 0, rings: 0, rows: 0, axes: 0, scopeDonuts: 0, tiles: 0 };
  for (const c of randomCharts(9209, 1500, ALL_KINDS, mixedFrames)) {
    const at = `#${c.i} ${c.kind} ${c.w}×${c.h}`;
    seen[c.kind] = (seen[c.kind] ?? 0) + 1;
    // 1. Plots upright and of positive size (vertical axes: at least PLOT_FLOOR), rings of positive radius.
    if (VERTICAL.has(c.kind)) {
      const ys = axisYs(c);
      assert.ok(ys.length >= 2, `${at}: no value axis`);
      assert.ok(ys[0] - ys[ys.length - 1] >= SVG.PLOT_FLOOR - EPS, `${at}: plot ${ys[0] - ys[ys.length - 1]} (axis ${ys.join(",")})`);
      checks.plots++;
    }
    if (HORIZONTAL.has(c.kind)) {
      const lines = [...c.body.matchAll(/<line x1="([\d.-]+)" x2="\1" y1="([\d.-]+)" y2="([\d.-]+)"/g)].map((m) => ({ x: num(m[1]), h: num(m[3]) - num(m[2]) }));
      assert.ok(lines.length >= 2 && lines[lines.length - 1].x > lines[0].x && lines.every((l) => l.h > 0), `${at}: plot`);
      assert.ok(c.rects.some((r) => r.w > 0 && r.h > 0), `${at}: no bar of positive size`);
      checks.plots++;
    }
    if (c.kind === "donut" || c.kind === "scope_donut") {
      const ring = ringOf(c);
      assert.ok(ring && ring.r > 0.5, `${at}: ring ${ring?.r}`);
      checks.rings++;
    }
    // 2. A kept-first label (latest total, waterfall start and end, bridge base and current) is left out while a lower one is
    //    drawn only when no spot over its own column fits it (#209 round 5: keptFirstLeftOut; never lifted onto a neighbour).
    if (["bar", "stacked_bar", "waterfall", "target_bars", "base_year_waterfall", "bridge_compare"].includes(c.kind)) {
      const ys = axisYs(c);
      if (ys.length >= 2 && ys[0] - ys[ys.length - 1] >= Math.max(SVG.SMALL * 2, (ys.length - 1) * SVG.SMALL * 0.9)) {
        const own = ownedLabels(c);
        if (own.cols.length === own.want.length && own.labels.some((l) => !own.want[l.k].first)) {
          checks.rows++;
          assert.deepEqual(keptFirstLeftOut(c), [], at);
        }
      }
    }
    // 3. No two tick labels of a horizontal value axis meet.
    if (HORIZONTAL.has(c.kind)) {
      const ticks = hTicks(c);
      for (let i = 1; i < ticks.length; i++) assert.ok(!SVG.boxesMeet(boxOf(ticks[i - 1]), boxOf(ticks[i])), `${at}: tick "${ticks[i - 1].s}" meets "${ticks[i].s}"`);
      checks.axes++;
    }
    // 4. A scope donut always names its scopes.
    if (c.kind === "scope_donut") {
      for (const sc of ["Scope 1", "Scope 2", "Scope 3"]) assert.ok(c.texts.some((t) => t.s === sc || t.s.startsWith(`${sc} `)), `${at}: ${sc} is not drawn`);
      checks.scopeDonuts++;
    }
    // 5. A named treemap tile tall and wide enough for its share at the smallest step prints at least its share.
    if (c.kind === "treemap") {
      const parts = c.value.series[0].values;
      const sum = parts.reduce((a, p) => a + p.value, 0);
      for (const r of c.rects.filter((x) => x.part)) {
        const inTile = c.texts.filter((t) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
        if (!inTile.some((t) => t.bold)) continue;
        const v = parts.find((p) => p.key === r.part).value / sum;
        const share = `${RF.formatNumber(v * 100, v * 100 < 10 ? "1dp" : "int")}%`;
        if (r.h < S8 * (2.6 + 0.05 + 0.3) || SVG.labelWidth(share, S8) > r.w - S8) continue;
        checks.tiles++;
        assert.ok(inTile.some((t) => t.s === share || t.s.endsWith(` · ${share}`)), `${at} tile ${r.part} ${r.w.toFixed(1)}×${r.h.toFixed(1)}: ${inTile.map((t) => t.s).join(" | ")} (share ${share})`);
      }
    }
  }
  assert.equal(Object.keys(seen).length, ALL_KINDS.length, JSON.stringify(seen));
  for (const [k, n] of Object.entries(checks)) assert.ok(n > (k === "tiles" ? 200 : 40), `${k}: ${n}`);
});

test("round 4: a value label never sits on its own mark: in a plot too short for a line over it, it goes beside the mark", () => {
  // The reviewers' fuzz (BE seed 11 #26): a gas_split 349 × 76, its plot at PLOT_FLOOR under the total line (production's was
  // upside down, its columns of height 0). The biggest gas's label has no room over its column: it sits beside it, level
  // with its top, in the gap before the next gas, never on a column.
  const theme = R.buildTheme({});
  const value = {
    display: "12,480.000",
    value: 12480,
    unit: "tCO₂e",
    series: [
      { label: "2024", unit: "t", values: [{ key: "CO₂", value: 3104.994 }, { key: "CH₄", value: 60.2 }, { key: "N₂O", value: 12.9 }] },
      { label: "2025", unit: "t", values: [{ key: "CO₂", value: 169102.877 }, { key: "CH₄", value: 401.3 }, { key: "N₂O", value: 39.5 }] },
    ],
  };
  const svg = R.chartRenderer("gas_split")({ value, w: 349, h: 76, theme, options: {}, label: "gas_split" });
  const p = parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1]);
  const lab = p.texts.find((t) => t.s === "169,103");
  assert.ok(lab, p.texts.map((t) => t.s).join(" | "));
  const b = boxOf(lab);
  const cols = p.rects.filter((r) => r.part && r.w > 0 && r.h > 0);
  assert.ok(cols.length >= 2);
  for (const r of cols) assert.ok(!SVG.boxesMeet(b, rectBox(r)), `"169,103" ${where(b)} meets the ${r.part} column ${where(rectBox(r))}`);
  const own = cols.find((r) => r.part === "CO₂" && r.h > 1);
  assert.ok(b.x0 >= own.x + own.w && b.y0 <= own.y + own.h && b.y1 >= own.y, `beside its column, level with its top: ${where(b)} / ${where(rectBox(own))}`);
});

/** A DS-1 fixture element alone on an A4 page at w × h mm: its chart. */
function alone1(id, wmm, hmm) {
  const d0 = F.fixtureDoc("a4");
  const pg = d0.pages.find((p) => (p.elements || []).some((e) => e.id === id));
  const e = pg.elements.find((x) => x.id === id);
  const d = { ...d0, pages: [{ ...pg, elements: [{ ...e, frame: { ...e.frame, x: 5, y: 5, w: wmm, h: hmm } }] }] };
  return charts(R.renderDocument(d, F.fixtureData(R.renderData), { mode: "sheet", assets: F.assets }).html)[0];
}

test("round 4: frame sweeps: small frames keep what production drew clear (bar-end figures, legends, legend figures, the total)", () => {
  // From the reviewers' frame sweeps (w 25–100 mm, h 15–70 mm) against production.
  const muted = R.buildTheme({}).colors.muted;
  // 1. A horizontal bar's bar-end figures win over tick labels: the plot narrows for them and the tick labels thin.
  const hbar = alone1("p-charts.hbar", 30, 25);
  assert.ok(hbar.texts.some((t) => t.s === "1,500.000"), hbar.texts.map((t) => t.s).join(" | "));
  const ticks = hTicks(hbar);
  for (let i = 1; i < ticks.length; i++) assert.ok(!SVG.boxesMeet(boxOf(ticks[i - 1]), boxOf(ticks[i])), `tick ${ticks[i - 1].s} meets ${ticks[i].s}`);
  // 2. A plot at its floor never pushes what is under it into the legend: gas_split leaves out its unit note, monthly_stack
  //    its month names, and the legend stays clear.
  for (const [id, w, h] of [["g.gas_split", 40, 15], ["g.monthly_stack", 40, 15]]) {
    const c = alone(id, w, h);
    const leg = c.texts.filter((t) => /^(2024|2025|Scope \d)$/.test(t.s) && t.fill === muted);
    assert.ok(leg.length >= 2, `${id}: legend ${c.texts.map((t) => t.s).join(" | ")}`);
    for (const l of leg) for (const t of c.texts) if (t !== l) assert.ok(!SVG.boxesMeet(boxOf(l), boxOf(t)), `${id} ${w}×${h}: legend "${l.s}" meets "${t.s}"`);
  }
  // 3. A wide, short donut prints its total beside the ring (no room in its hole or under it).
  const dn = alone1("p-summary.donut", 95, 15);
  const fig = dn.texts.find((t) => t.s === "12,480.000 tCO₂e");
  const ring = ringOf(dn);
  assert.ok(fig && ring && boxOf(fig).x0 >= ring.cx + ring.r, `beside the ring: ${dn.texts.map((t) => `${t.s}@${t.x.toFixed(1)}`).join(" | ")}`);
  // 4. A short scope donut keeps its legend's tCO₂e figures (production drew them clear) before the total it drew over the ring.
  const sd = alone("g.scope_donut", 30, 15);
  for (const s of ["Scope 1 3,410.000", "Scope 2 5,800.000", "Scope 3 3,270.000"]) assert.ok(sd.texts.some((t) => t.s === s), `${s}: ${sd.texts.map((t) => t.s).join(" | ")}`);
});

// ---- #209 round 5 ------------------------------------------------------------------------------------------------------

/** The columns of a vertical chart (its rects over the plot grouped by x-range, left to right): x0, x1, top, bottom. */
function columnsOf(c) {
  const ys = axisYs(c);
  const floor = ys.length ? ys[0] : c.h;
  const cols = [];
  for (const r of c.rects) {
    if (r.y > floor + EPS) continue; // a legend's squares, under the plot
    if (r.w <= EPS) continue; // no width (a frame narrower than the axis and the target's year): no column to read a label against
    let col = cols.find((q) => Math.abs(q.x0 - r.x) < EPS && Math.abs(q.x1 - (r.x + r.w)) < EPS);
    if (!col) cols.push((col = { x0: r.x, x1: r.x + r.w, top: r.y, bottom: r.y + r.h }));
    col.top = Math.min(col.top, r.y);
    col.bottom = Math.max(col.bottom, r.y + r.h);
  }
  return cols.sort((a, b) => a.x0 - b.x0);
}
/** Each column's value label (as the chart prints it) and whether it is kept first, for the vertical kinds of randomCharts. */
function columnLabels(c) {
  const f = (v) => RF.formatNumber(v, "auto", "tCO₂e");
  const signed = (d) => `${d >= 0 ? "+" : "−"}${f(Math.abs(d))}`;
  const kind = c.kind;
  if (kind === "bar" || kind === "stacked_bar") {
    const keys = c.value.series[0].values.map((p) => p.key);
    return keys.map((key, i) => ({ s: f(c.value.series.reduce((a, s) => a + Math.max(0, s.values.find((p) => p.key === key).value ?? 0), 0)), first: i === keys.length - 1, bold: i === keys.length - 1 }));
  }
  if (kind === "target_bars") {
    const pts = c.value.series[0].values;
    return pts.map((p, i) => ({ s: f(p.value), first: i === pts.length - 1, bold: false }));
  }
  if (kind === "waterfall") {
    const pts = c.value.series[0].values;
    return pts.map((p, i) => (i === 0 || i === pts.length - 1 ? { s: f(p.value), first: true, bold: false } : { s: signed(p.value), first: false, bold: false }));
  }
  const steps = require(path.resolve("dist/reporting/studio/render/charts/ghg/trend.js")).bridgeSteps(c.value);
  return steps.map((s) => (s.kind === "abs" ? { s: f(s.to), first: true, bold: true } : { s: signed(s.to - s.from), first: false, bold: false }));
}
const numOf = (s) => (s.startsWith("−") ? -1 : 1) * Number(s.replace(/^[+−]/, "").replace(/,/g, ""));
/**
 * Why a value label's box `b` (font size `size`) does not read as column k's (null when it does): its centre more than 40 % of
 * the way towards another column's middle; another column under or over it (sharing some of its width) within a line of it
 * while its own is farther by more than a line (resting on a neighbour); or more than two lines higher than its natural place
 * over its own column. A label beside its column (no
 * column spans its width) reads as the nearest column's.
 */
function notOwn(b, k, cols, size) {
  const own = cols[k];
  const mid = (o) => (o.x0 + o.x1) / 2;
  const cx = mid(b);
  // Beside its column (round 4, in a plot too short for a line over it): in a gap no column spans, its own column the nearest.
  const gapTo = (o) => Math.hypot(Math.max(0, o.x0 - b.x1, b.x0 - o.x1), Math.max(0, o.top - b.y1, b.y0 - o.bottom));
  if (!cols.some((o) => o.x0 < b.x1 - EPS && b.x0 < o.x1 - EPS)) {
    const near = cols.findIndex((o, j) => j !== k && gapTo(o) < gapTo(own) - EPS);
    return near >= 0 ? `beside, nearer column ${near} (${gapTo(cols[near]).toFixed(1)}) than its own (${gapTo(own).toFixed(1)})` : null;
  }
  for (const [j, o] of cols.entries()) {
    const d = mid(o) - mid(own);
    if (j !== k && Math.abs(d) > EPS && (cx - mid(own)) * Math.sign(d) > 0.4 * Math.abs(d) + EPS) return `centred ${(cx - mid(own)).toFixed(1)} towards column ${j} (${d.toFixed(1)} away)`;
  }
  const across = (o) => o.x0 < b.x1 - EPS && b.x0 < o.x1 - EPS;
  const vgap = (o) => Math.max(0, o.top - b.y1, b.y0 - o.bottom);
  const ownGap = across(own) ? vgap(own) : Infinity;
  const line = SVG.LABEL_LIFT * size;
  for (const [j, o] of cols.entries()) if (j !== k && across(o) && vgap(o) < line - EPS && vgap(o) < ownGap - line - EPS) return `on column ${j} (gap ${vgap(o).toFixed(1)}, its own ${ownGap.toFixed(1)})`;
  if (b.y1 <= own.top + EPS && own.top - b.y1 > SVG.SMALL * 0.5 + 2 * SVG.LABEL_LIFT * size + EPS) return `${(own.top - b.y1).toFixed(1)} over its own column`;
  return null;
}
/** Every drawn value label of a vertical chart with its own column (matched by value, the nearest of equal ones). */
function ownedLabels(c) {
  const muted = R.buildTheme({}).colors.muted;
  const cols = columnsOf(c);
  const want = columnLabels(c);
  const out = [];
  for (const t of c.texts.filter((x) => /^[+−]?\d[\d,]*(\.\d+)?$/.test(x.s) && x.fill !== muted)) {
    const ks = want.map((w, k) => ({ w, k })).filter(({ w }) => Math.abs(numOf(w.s) - numOf(t.s)) < 0.0015 && Math.sign(numOf(w.s)) === Math.sign(numOf(t.s)));
    if (!ks.length) continue;
    const k = ks.reduce((a, b) => (Math.abs((cols[b.k].x0 + cols[b.k].x1) / 2 - t.x) < Math.abs((cols[a.k].x0 + cols[a.k].x1) / 2 - t.x) ? b : a)).k;
    out.push({ t, k });
  }
  return { cols, want, labels: out };
}
/**
 * A spot over column k where its label `s` (bold or not), at the smallest step, meets no mark, no tick label or other text
 * (`obstacles`), stays inside the chart and reads as column k's (notOwn): its centre anywhere its box still spans the column's
 * middle, up to two lines over its natural place. Null when there is none.
 */
function spotOver(c, k, s, bold, cols, obstacles) {
  const size = SVG.SMALL * 0.8;
  const own = cols[k];
  const mid = (own.x0 + own.x1) / 2;
  const half = SVG.labelWidth(s, size, bold) / 2;
  for (let dy = 0; dy <= 2 * SVG.LABEL_LIFT * size + 1e-9; dy += 0.2)
    for (let dx = -half; dx <= half + 1e-9; dx += 0.2) {
      const b = SVG.inkBox(mid + dx, own.top - SVG.SMALL * 0.5 - dy, s, size, { anchor: "middle", bold });
      if (b.x0 < -1e-6 || b.x1 > c.w + 1e-6 || b.y0 < -1e-6 || b.y1 > c.h + 1e-6) continue;
      if (obstacles.some((o) => SVG.boxesMeet(o, b))) continue;
      if (!notOwn(b, k, cols, size)) return { dx, dy };
    }
  return null;
}
/**
 * The kept-first rule (#209 round 5): a kept-first label (latest total, waterfall start and end, bridge base and current) is
 * placed before the lower ones, so it is left out only when no spot over its own column fits it at the smallest step
 * (spotOver, with every mark, tick label and other kept-first label in the way): never while a lower label holds its room.
 */
function keptFirstLeftOut(c) {
  const muted = R.buildTheme({}).colors.muted;
  const { cols, want, labels } = ownedLabels(c);
  if (cols.length !== want.length) return [];
  const drawn = new Set(labels.map((l) => l.k));
  const rects = c.rects.filter((r) => r.y <= (axisYs(c)[0] ?? c.h) + EPS).map(rectBox);
  // A target's words as target_bars declares them to its labels (labelBox: an em box with air), any other text by its ink.
  const others = c.texts.filter((t) => !(/^[+−]?\d[\d,]*(\.\d+)?$/.test(t.s) && t.fill !== muted)).map((t) => (c.kind === "target_bars" && /^(Baseline|Target\b)/.test(t.s) ? SVG.labelBox(t.x, t.y, t.s, t.size, { anchor: t.anchor, bold: t.bold }) : boxOf(t)));
  const firsts = labels.filter((l) => want[l.k].first).map((l) => boxOf(l.t));
  const out = [];
  want.forEach((w, k) => {
    if (!w.first || drawn.has(k)) return;
    const spot = spotOver(c, k, w.s, w.bold, cols, [...rects, ...others, ...firsts]);
    if (spot) out.push(`"${w.s}" left out, though it fits over its column at dx ${spot.dx.toFixed(1)} dy ${spot.dy.toFixed(1)}`);
  });
  return out;
}

const ROUND5_CASES = [
  ["m77 fe #109", {"kind":"stacked_bar","w":170,"h":130,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Scope 1","values":[{"key":"2019","value":3155.761},{"key":"2020","value":1220.949},{"key":"2021","value":11539.203},{"key":"2022","value":4541.706},{"key":"2023","value":2585.609}]},{"label":"Scope 2","values":[{"key":"2019","value":2246.848},{"key":"2020","value":5100.053},{"key":"2021","value":42.477},{"key":"2022","value":51711.235},{"key":"2023","value":2375.427}]},{"label":"Scope 3","values":[{"key":"2019","value":6273.069},{"key":"2020","value":16703.027},{"key":"2021","value":2624.23},{"key":"2022","value":45540.823},{"key":"2023","value":3628.41}]}]}}],
  ["m77 fe #297", {"kind":"waterfall","w":132,"h":135,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Total","values":[{"key":"2019","value":2605.613},{"key":"2020","value":7796.857},{"key":"2021","value":11918.7},{"key":"2022","value":12687.001}]}]}}],
  ["m77 fe #341", {"kind":"waterfall","w":284,"h":207,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Total","values":[{"key":"2019","value":188010.902},{"key":"2020","value":176965.147},{"key":"2021","value":2705.048},{"key":"2022","value":10372.067},{"key":"2023","value":15331.217},{"key":"2024","value":12559.538},{"key":"2025","value":11654.578}]}]}}],
  ["m77 fe #120", {"kind":"target_bars","w":151,"h":211,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Total","values":[{"key":"2019","value":10505.959},{"key":"2020","value":173.91},{"key":"2021","value":12547.398},{"key":"2022","value":434.163}]}],"target":{"baseline":13929.977,"value":16496.235,"year":2030}}}],
  ["m77 ext #12", {"kind":"bar","w":161,"h":210,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Total","values":[{"key":"2019","value":14694.534},{"key":"2020","value":6513.27},{"key":"2021","value":7806.362},{"key":"2022","value":13258.123},{"key":"2023","value":2439.688}]}]}}],
  ["m77 ext #232", {"kind":"bar","w":237,"h":207,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Total","values":[{"key":"2019","value":31147.39},{"key":"2020","value":56304.958},{"key":"2021","value":26637.026},{"key":"2022","value":88046.808},{"key":"2023","value":164953.608},{"key":"2024","value":17874.279}]}]}}],
  ["gen 11 #14", {"kind":"stacked_bar","w":130,"h":118,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Scope 1","values":[{"key":"2019","value":5836.633},{"key":"2020","value":4533.609},{"key":"2021","value":619.704}]},{"label":"Scope 2","values":[{"key":"2019","value":3791.29},{"key":"2020","value":5319.07},{"key":"2021","value":6097.287}]},{"label":"Scope 3","values":[{"key":"2019","value":4082.892},{"key":"2020","value":62139.537},{"key":"2021","value":3647.901}]}]}}],
  ["gen 11 #83", {"kind":"bar","w":241,"h":152,"value":{"display":"","value":1,"unit":"tCO₂e","series":[{"label":"Total","values":[{"key":"2019","value":179288.179},{"key":"2020","value":50585.419},{"key":"2021","value":18107.054},{"key":"2022","value":13857.043},{"key":"2023","value":17654.669},{"key":"2024","value":165324.05},{"key":"2025","value":5630.016}]}]}}],
  ["gen2 23 #288", {"kind":"base_year_waterfall","w":125,"h":175,"value":{"display":"7,010.225","value":7010.225,"unit":"tCO₂e","series":[{"label":"Total emissions","values":[{"key":"2024","value":13662.122},{"key":"2025","value":7010.225}]}],"compare":{"against":"base","year":2019,"value":149353.773,"change_abs":-142343.548,"change_pct":-95.306}}}],
];
const renderCase = ([, k]) => {
  const svg = R.chartRenderer(k.kind)({ value: k.value, w: k.w, h: k.h, theme: R.buildTheme({}), options: k.options ?? {}, label: k.kind });
  return { kind: k.kind === "base_year_waterfall" && k.value.compare ? "bridge_compare" : k.kind, w: k.w, h: k.h, value: k.value, body: /<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1], ...parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1]) };
};

test("round 5: a value label reads as its own column's: never on a taller neighbour's top, never centred over a neighbour, never far above its own", () => {
  // The reviewers' charts (seeds 77 and 11, gen2 seed 23): round 4 lifted a kept-first label onto a taller neighbour (the bold
  // 2023 "8,589.445" on the 2022 bar under "101,793.763"; a waterfall's start and end over the steps beside them; the bridge's
  // current year at the top of the Change bar).
  for (const k of ROUND5_CASES) {
    const c = renderCase(k);
    const { cols, want, labels } = ownedLabels(c);
    assert.equal(cols.length, want.length, `${k[0]}: columns`);
    assert.ok(labels.length >= 2, `${k[0]}: ${labels.map((l) => l.t.s).join(", ")}`);
    for (const { t, k: col } of labels) {
      const why = notOwn(boxOf(t), col, cols, t.size);
      assert.equal(why, null, `${k[0]}: "${t.s}" ${why}`);
    }
    assert.deepEqual(keptFirstLeftOut(c), [], k[0]);
  }
  // The DS-1 waterfall and the DS-8 bridge in the narrow, tall frames of the reviewers' sweeps.
  for (const [what, c] of [
    ...[55, 60, 65, 70].map((hh) => [`p-charts.water 30×${hh}`, alone1("p-charts.water", 30, hh)]),
    ...[55, 60, 65, 70].map((hh) => [`g.bridge_compare 30×${hh}`, alone("g.bridge_compare", 30, hh)]),
  ]) {
    const cols = columnsOf(c);
    const muted = R.buildTheme({}).colors.muted;
    const vals = c.texts.filter((t) => /^[+−]?\d[\d,]*\.\d{3}$/.test(t.s) && t.fill !== muted);
    for (const t of vals) {
      // Its own column: the one whose step the fixture labels with this figure (the nearest middle of those it may be).
      const k = cols.map((q, j) => ({ j, d: Math.abs((q.x0 + q.x1) / 2 - t.x) })).sort((a, b) => a.d - b.d)[0].j;
      const why = notOwn(boxOf(t), k, cols, t.size);
      assert.equal(why, null, `${what}: "${t.s}" ${why}`);
    }
  }
  // fitLabelRow: a bold label blocked by a tall neighbour moves sideways, still over its own mark; with no room to its side it is
  // left out rather than drawn on the tall bar.
  const S = SVG.SMALL;
  const row = (w) => () => ({ labels: [{ x: 50, y: 150 - S * 0.5, text: "12,480.000", bold: true }, { x: 80, y: 30 - S * 0.5, text: "93,000.000" }], obstacles: [SVG.rectBox(40, 150, 20, 50, 0), SVG.rectBox(70, 30, 20, 170, 1)] });
  const f = SVG.fitLabelRow(row(120), 120, 200);
  assert.ok(f.labels[0], "the bold label is drawn");
  const b = SVG.inkBox(f.labels[0].x, f.labels[0].y, "12,480.000", f.size, { anchor: "middle", bold: true });
  assert.ok(b.x1 <= 70 && b.x0 <= 50 && b.x1 >= 50 && b.y1 <= 150 && b.y1 >= 150 - S * 0.5 - 2 * SVG.LABEL_LIFT * f.size, `over its own bar, clear of the tall one: ${where(b)}`);
  // The same bar with a tick label to its left: no room beside it, so it is left out (never lifted onto the tall bar).
  const blocked = () => ({ ...row(120)(), obstacles: [...row(120)().obstacles, { x0: 0, x1: 34, y0: 100, y1: 160 }] });
  const g = SVG.fitLabelRow(blocked, 120, 200);
  if (g.labels[0]) {
    const bb = SVG.inkBox(g.labels[0].x, g.labels[0].y, "12,480.000", g.size, { anchor: "middle", bold: true });
    assert.ok(bb.x1 <= 70 + EPS && bb.y1 >= 150 - S * 0.5 - 2 * SVG.LABEL_LIFT * g.size - EPS, `never over the tall bar: ${where(bb)}`);
  }
});

test("round 5: over random charts every value label reads as its own column's, and a kept-first label is left out only when nothing over its column fits it", () => {
  const kinds = ["bar", "stacked_bar", "waterfall", "target_bars", "base_year_waterfall", "bridge_compare"];
  let labels = 0;
  let charts = 0;
  for (const [seed, n, frame] of [[4209, 400, null], [5209, 400, null], [9209, 600, mixedFrames]])
    for (const c of randomCharts(seed, n, kinds, frame)) {
      const at = `seed ${seed} #${c.i} ${c.kind} ${c.w}×${c.h}`;
      const own = ownedLabels(c);
      if (own.cols.length !== own.want.length) continue;
      charts++;
      for (const { t, k } of own.labels) {
        labels++;
        const why = notOwn(boxOf(t), k, own.cols, t.size);
        assert.equal(why, null, `${at}: "${t.s}" ${why}`);
      }
      assert.deepEqual(keptFirstLeftOut(c), [], at);
    }
  assert.ok(charts > 800 && labels > 3000, `${charts} charts, ${labels} labels`);
});

test("round 5: ranked bars print each value right after its own bar, never after the longer prior-year bar under it", () => {
  // m77 ext #339 (Muharraq depot), s77 ext #35 (Sitra warehouse), gen2 seed 23 #239 (Business travel): round 4 moved the value
  // to the end of the grey prior-year bar, where it read as that year's figure.
  const cases = [
    { w: 281, h: 114, kind: "site_bars", options: { greyPrior: true }, prior: [["Manama plant", 11492.441], ["Sitra warehouse", 1774.435], ["Head office", 1046.29], ["Muharraq depot", 12228.325], ["Riffa lab", 783.556], ["Hidd port", 690.588]], cur: [["Manama plant", 114.984], ["Sitra warehouse", 1144.083], ["Head office", 315.453], ["Muharraq depot", 1759.502], ["Riffa lab", 935.572], ["Hidd port", 848.983]] },
    { w: 395, h: 79, kind: "site_bars", options: { greyPrior: true }, prior: [["Manama plant", 218.054], ["Sitra warehouse", 17851.194], ["Head office", 1186.247]], cur: [["Manama plant", 261.574], ["Sitra warehouse", 336.162], ["Head office", 5525.018]] },
    { w: 231, h: 164, kind: "category_bars", options: {}, prior: [["1 · Purchased goods and services", 4850.736], ["2 · Capital goods", 15399.163], ["3 · Fuel- and energy-related activities", 4865.353], ["4 · Upstream transportation and distribution", 6403.229], ["5 · Waste generated in operations", 9608.736], ["6 · Business travel", 72745.997], ["7 · Employee commuting", 9779.937], ["9 · Downstream transportation and distribution", 9375.484]], cur: [["1 · Purchased goods and services", 135690.457], ["2 · Capital goods", 18560.536], ["3 · Fuel- and energy-related activities", 18284.142], ["4 · Upstream transportation and distribution", 5210.049], ["5 · Waste generated in operations", 11893.189], ["6 · Business travel", 22263.843], ["7 · Employee commuting", 19678.998], ["9 · Downstream transportation and distribution", 14034.429]] },
  ];
  const S = SVG.SMALL;
  const check = (c, at, want) => {
    // The bar-end figures (a headline total, at the chart's left edge, is not one).
    const vals = c.texts.filter((t) => t.anchor === "start" && t.x > EPS && /^\d[\d,]*\.\d{3}$/.test(t.s));
    if (want) for (const s of want) assert.ok(vals.some((t) => t.s === s), `${at}: "${s}" is drawn (${vals.map((t) => t.s).join(", ")})`);
    const cur = c.rects.filter((r) => r.part);
    for (const t of vals) {
      const own = cur.find((r) => t.y >= r.y - EPS && t.y <= r.y + r.h + EPS);
      assert.ok(own, `${at}: "${t.s}" is level with its own bar`);
      // Right after its own bar's end; at most SMALL further, past a prior-year bar that ends that close (the last resort).
      const after = t.x - (own.x + own.w) - S * 0.4;
      assert.ok(after > -EPS && after < S + EPS, `${at}: "${t.s}" starts ${(t.x - own.x - own.w).toFixed(1)} after its own bar's end`);
      if (after > EPS) assert.ok(c.rects.some((r) => !r.part && Math.abs(r.x + r.w + S * 0.4 - t.x) < EPS && r.y >= own.y + own.h - EPS && r.y <= own.y + own.h + S), `${at}: "${t.s}" starts ${after.toFixed(1)} past its own bar, not after its prior-year bar`);
      for (const r of c.rects.filter((x) => x.w > 0.5 && x.h > 0.5)) if (r !== own) assert.ok(!SVG.boxesMeet(boxOf(t), rectBox(r)), `${at}: "${t.s}" meets a bar`);
    }
    return vals.length;
  };
  const fmt = (v) => RF.formatNumber(v, "auto", "tCO₂e");
  for (const k of cases) {
    const value = { display: "1.000", value: 1, unit: "tCO₂e", series: [{ label: "2024", values: k.prior.map(([key, v]) => ({ key, value: v })) }, { label: "2025", values: k.cur.map(([key, v]) => ({ key, value: v })) }] };
    const svg = R.chartRenderer(k.kind)({ value, w: k.w, h: k.h, theme: R.buildTheme({}), options: k.options, label: k.kind });
    const c = parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(svg)[1]);
    const top3 = [...k.cur].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([, v]) => fmt(v));
    check(c, `${k.kind} ${k.w}×${k.h}`, top3);
  }
  // The DS-8 fixture in the reviewers' sweep: at 30 × 30 mm "620.000" moves down within its bar's height, clear of the bold
  // "1,290.000" (round 4 left it out); at 40 × 15 mm the bold "1,290.000" starts after the prior-year bar that ends 4.3 units
  // past its own (at its own bar's end it meets that bar; round 4 left the other labels out).
  let n = 0;
  for (const [id, wmm, hmm, want] of [["g.category_bars", 30, 30, ["1,290.000", "620.000", "410.000"]], ["g.category_prior", 40, 15, ["1,290.000"]]]) n += check(alone(id, wmm, hmm), `${id} ${wmm}×${hmm}`, want);
  // Over random charts: every value label starts right after its own bar.
  for (const c of randomCharts(7209, 400, ["category_prior", "category_bars", "site_bars"])) n += check(c, `#${c.i} ${c.kind} ${c.w}×${c.h}`);
  assert.ok(n > 500, String(n));
});

test("round 5: textWidth is the widest face's own sum of advances plus 0.05 em, so labels that fit in every face are drawn", () => {
  const faces = Object.entries(METRICS.faces);
  const samples = ["−1,600.000", "12,480.000", "9,300.000", "620.000", "174.000", "1,290.000 · 39%", "Total emissions 12,480.000 tCO₂e", "Baseline", "Target 2030"];
  for (const s of samples)
    for (const bold of [false, true]) {
      const widest = Math.max(...faces.filter(([f]) => f.endsWith(bold ? "@700" : "@400")).map(([, m]) => [...s].reduce((a, ch) => a + m.advance[ch], 0)));
      assert.ok(MET.textWidth(s, 1, bold) <= widest + 0.05 + 1e-9, `"${s}"${bold ? " bold" : ""}: ${MET.textWidth(s, 1, bold).toFixed(3)} em vs the widest face's ${widest.toFixed(3)} em`);
    }
  assert.ok(MET.TEXT_MARGIN_EM <= 0.05, String(MET.TEXT_MARGIN_EM));
  // The reviewers' frames, where production drew the figure clear in all eight faces at its own mark.
  const muted = R.buildTheme({}).colors.muted;
  const has = (c, s, at) => {
    const t = c.texts.find((x) => x.s === s);
    assert.ok(t, `${at}: "${s}" is drawn (${c.texts.filter((x) => x.fill !== muted).map((x) => x.s).join(" | ")})`);
    for (const u of c.texts) if (u !== t) assert.ok(!SVG.boxesMeet(boxOf(t), boxOf(u)), `${at}: "${s}" meets "${u.s}"`);
  };
  has(alone1("p-charts.water", 40, 15), "−1,600.000", "p-charts.water 40×15");
  has(alone1("p-charts.water", 30, 70), "−820.000", "p-charts.water 30×70");
  has(alone1("p-charts.target", 45, 15), "9,300.000", "p-charts.target 45×15");
  has(alone("g.base_year_waterfall", 40, 15), "−800.000", "g.base_year_waterfall 40×15");
  has(renderCase(ROUND5_CASES.find((k) => k[0] === "m77 fe #120")), "173.910", "m77 fe #120 target_bars 151×211");
});

test("round 5: a wide, short donut puts its figure beside the ring when under it would cost a share label", () => {
  const theme = R.buildTheme({});
  const donut = (w, h, parts, display) => {
    const value = { display, value: 1, unit: "tCO₂e", series: parts.map(([label, v]) => ({ label, values: [{ key: "2025", value: v }] })) };
    const c = parseSvg(/<svg [^>]*>(.*)<\/svg>/s.exec(R.chartRenderer("donut")({ value, w, h, theme, options: {}, label: "donut" }))[1]);
    return { ...c, shares: c.texts.filter((t) => /%$/.test(t.s)) };
  };
  // gen2 seed 67 #9 (344 × 90): production drew all five shares clear; round 4 put the figure under the ring and left out 5.7 %.
  const a = donut(344, 90, [["Scope 1", 1238.537], ["Scope 2", 16527.73], ["Scope 3", 13586.679], ["Biogenic", 15985.875], ["Other", 175256.211], ["Removals", 13392.727]], "235,987.759");
  assert.deepEqual(a.shares.map((t) => t.s).sort(), ["5.7%", "5.8%", "6.8%", "7.0%", "74%"], a.texts.map((t) => t.s).join(" | "));
  for (const t of a.shares) for (const u of a.texts) if (u !== t) assert.ok(!SVG.boxesMeet(boxOf(t), boxOf(u)), `"${t.s}" meets "${u.s}"`);
  assert.ok(a.texts.some((t) => t.s === "235,987.759 tCO₂e" || t.s === "235,987.759"), "the figure is drawn");
  // gen2 seed 23 #338 (417 × 129): the shares production drew clear (85 %, 5.7 % and the 4.6 % left of the ring; the other 4.6 %
  // met "5.7%" in production) stay.
  const b = donut(417, 129, [["Scope 1", 8443.422], ["Scope 2", 157352.167], ["Scope 3", 8562.946], ["Biogenic", 10445.232]], "184,803.767");
  for (const s of ["85%", "5.7%", "4.6%"]) assert.ok(b.shares.some((t) => t.s === s), `${s}: ${b.texts.map((t) => t.s).join(" | ")}`);
});

test("round 5: target_bars never lifts its plot so far that the target's words meet each other, a tick label or the other line", () => {
  // gen seed 53 #241 (132 × 88): round 4's staggered row pushed "Baseline" into "Target 2030" and under the target line.
  const value = { display: "", value: 1, unit: "tCO₂e", series: [{ label: "Total", values: [["2019", 12448.115], ["2020", 18224.368], ["2021", 127191.883], ["2022", 12050.126]].map(([key, v]) => ({ key, value: v })) }], target: { baseline: 157750.446, value: 191784.579, year: 2030 } };
  const body = /<svg [^>]*>(.*)<\/svg>/s.exec(R.chartRenderer("target_bars")({ value, w: 132, h: 88, theme: R.buildTheme({}), options: {}, label: "target_bars" }))[1];
  const gen = parseSvg(body);
  const base = gen.texts.find((t) => t.s === "Baseline");
  const tgt = gen.texts.find((t) => t.s === "Target 2030");
  assert.ok(base && tgt, gen.texts.map((t) => t.s).join(" | "));
  // Production drew the two words 9.57 apart (baseline to baseline) and its target line 1.43 under the top of "Baseline"'s
  // estimated ink (the ascenders' height); round 4 lifted the plot to 8.14 apart and 2.87 into "Baseline". They stay as
  // production drew them: a lift never brings them closer.
  assert.ok(base.y - tgt.y >= 9.57 - EPS, `"Baseline" at ${base.y}, "Target 2030" at ${tgt.y}: ${(base.y - tgt.y).toFixed(2)} apart`);
  const ty = num(/<line [^>]*y1="([\d.]+)"[^>]*data-target=/.exec(body)[1]);
  const bb = boxOf(base);
  assert.ok(ty <= bb.y0 + 1.44 || ty > bb.y1 + 1, `the target line at ${ty} runs ${(ty - bb.y0).toFixed(2)} into "Baseline" ${where(bb)}`);
  // Production's figure on the 2021 bar ("127,192", clear in every face) stays.
  assert.ok(gen.texts.some((t) => t.s === "127,191.883"), gen.texts.map((t) => t.s).join(" | "));
  // The DS-1 target at 25 × 55 mm: "Baseline" stays as far from the "12.5k" tick as production drew it (clear in every face).
  const c = alone1("p-charts.target", 25, 55);
  const b2 = c.texts.find((t) => t.s === "Baseline");
  const tick = c.texts.find((t) => t.s === "12.5k");
  assert.ok(b2 && tick && b2.y - tick.y >= 9.471 - EPS, `"Baseline" at ${b2?.y}, "12.5k" at ${tick?.y}`);
});
