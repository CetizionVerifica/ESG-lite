// DS-1 renderer (pure): formats agree with the contracts, every element type
// and chart kind renders with its data marks, unavailable values say "Not
// reported" with a reason, text is escaped, number formats, scales, waterfall
// and sankey arithmetic, QR codes decode, theme precedence, mode switches
// (page rules, bleed, crop marks, guides), flow sections, a 300-row table, the
// snapshot goldens (ci/golden/ds/render) and the mirror hash.
//   npm run build && npm run test:unit
//   UPDATE_SNAPSHOT=1 node --test ci/unit/ds-1-render.test.cjs   # after an intended change
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const R = require(path.resolve("dist/reporting/studio/render/index.js"));
const C = require(path.resolve("dist/studio/contracts/index.js"));
const F = require(path.resolve("ci/golden/ds/render/fixture.cjs"));
const G = require(path.resolve("ci/golden/ds/render/golden.cjs"));
const jsQR = require("jsqr");

const data = F.fixtureData(R.renderData);
const a4 = F.fixtureDoc("a4");
const render = (mode, extra = {}, doc = a4, d = data) => R.renderDocument(doc, d, { mode, assets: F.assets, ...extra });

test("formats: the sizes are the contract's, bleed only on print formats, 16:9 is 1280×720 px", () => {
  for (const f of C.PAGE_FORMATS) {
    const s = R.FORMATS[f];
    assert.equal(s.wMm, C.PAGE_FORMAT_SIZES[f].wMm, f);
    assert.equal(s.hMm, C.PAGE_FORMAT_SIZES[f].hMm, f);
    assert.equal(s.bleedMm, C.PAGE_FORMAT_SIZES[f].bleedMm, f);
    assert.ok(s.safeMm > 0 && s.safeMm < Math.min(s.wMm, s.hMm) / 4, f);
  }
  assert.deepEqual(Object.keys(R.FORMATS).sort(), [...C.PAGE_FORMATS].sort());
  assert.deepEqual(R.formatPx("slide_16_9"), { w: 1280, h: 720 });
  assert.deepEqual(R.formatPx("square"), { w: 1080, h: 1080 });
  assert.deepEqual(R.formatPx("social_191"), { w: 1200, h: 628 });
  assert.equal(R.bleedFor("a4", "print"), 3);
  assert.equal(R.bleedFor("a4", "paged"), 0);
  assert.equal(R.bleedFor("slide_16_9", "print"), 0);
});

test("the fixture is a valid ReportDoc v2 on every format, and every contract element type has a renderer", () => {
  for (const f of C.PAGE_FORMATS) {
    const r = C.ReportDocSchema.safeParse(F.fixtureDoc(f));
    assert.ok(r.success, `${f}: ${r.success ? "" : r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  assert.deepEqual([...R.RENDERED_ELEMENT_TYPES].sort(), [...C.ELEMENT_TYPES].sort());
  const used = new Set(a4.pages.flatMap((p) => (p.kind === "freeform" ? p.elements.map((e) => e.type) : [])));
  for (const t of C.ELEMENT_TYPES) assert.ok(used.has(t), `fixture lacks ${t}`);
  const flows = new Set(a4.pages.filter((p) => p.kind === "flow").map((p) => p.flowType));
  for (const t of C.FLOW_TYPES) assert.ok(flows.has(t), `fixture lacks flow ${t}`);
  const kinds = new Set(a4.pages.flatMap((p) => (p.kind === "freeform" ? p.elements.filter((e) => e.type === "chart").map((e) => e.props.kind) : [])));
  // DS-8: the GHG kinds have their own fixture (ci/golden/ds/render/ghg-charts.cjs).
  for (const k of R.registeredChartKinds()) if (!R.GHG_CHART_KINDS.includes(k)) assert.ok(kinds.has(k), `fixture lacks chart ${k}`);
});

test("deterministic: the same input gives the same HTML and CSS", () => {
  for (const mode of C.RENDER_MODES) {
    const a = render(mode);
    const b = render(mode);
    assert.equal(a.html, b.html, mode);
    assert.equal(a.css, b.css, mode);
  }
});

test("every visible element and page carries its ids; hidden ones don't render", () => {
  const { html, pageIds } = render("sheet");
  for (const page of a4.pages) {
    if (page.hidden) {
      assert.ok(!html.includes(`data-page-id="${page.id}"`), page.id);
      assert.ok(!pageIds.includes(page.id));
      continue;
    }
    assert.ok(html.includes(`data-page-id="${page.id}"`), page.id);
    if (page.kind !== "freeform") continue;
    for (const e of page.elements) {
      const has = html.includes(`data-el-id="${e.id}"`);
      assert.equal(has, !e.hidden, e.id);
    }
  }
  // Absolutely positioned in mm with rotation and z-order.
  assert.match(html, /data-el-id="p-summary\.rot"[^>]*style="left:15mm;top:262mm;width:20mm;height:20mm;z-index:\d+;transform:rotate\(15deg\);opacity:0\.8;"/);
});

test("data marks: bound elements name their binding hash and source; custom data is unlinked", () => {
  const { html } = render("sheet");
  const tag = (id) => html.match(new RegExp(`<div class="ds-el [^"]*" data-el-id="${id.replace(".", "\\.")}"[^>]*>`))[0];
  assert.match(tag("p-summary.tile1"), new RegExp(`data-binding-hash="${R.bindingHash(F.B.total)}" data-source="ghg"`));
  assert.match(tag("p-summary.ring"), /data-source="kpi"/);
  assert.match(tag("p-summary.table"), /data-source="custom"[^>]*data-unlinked="true"/);
  assert.match(html, /Unlinked data/); // DS-8: the badge's words
  assert.match(tag("p-charts.custom"), /data-unlinked="true"/);
  // Text chips carry their marks too.
  assert.match(html, /class="ds-chip" data-source="ghg" data-binding-hash="[0-9a-f]{8}" data-measure="value">3,210\.000<\/span>/); // the server's display: tCO₂e with 3 decimals (#209)
});

test("an unavailable value renders \"Not reported\" with its reason, never 0 or blank", () => {
  const { html } = render("sheet");
  const tile = html.slice(html.indexOf('data-el-id="p-summary.tile3"'), html.indexOf('data-el-id="p-summary.ring"'));
  assert.match(tile, /data-reason="NOT_RECORDED"/);
  assert.match(tile, /<span class="ds-nr ds-tile-fig" data-reason="NOT_RECORDED">Not reported<\/span>/);
  assert.match(html, /data-el-id="p-summary\.unavail"[^>]*data-reason="NOT_RECORDED"/);
  assert.match(html, /ds-chip--nr[^>]*><span class="ds-nr" data-reason="NOT_RECORDED">Not reported<\/span>/);
  // A binding the resolver never answered.
  const empty = R.renderDocument(a4, R.emptyData(), { mode: "sheet" });
  assert.match(empty.html, /data-el-id="p-cover\.total"[^>]*data-reason="NOT_RESOLVED"/);
  assert.ok(!/>0<\/span>/.test(empty.html.slice(empty.html.indexOf("p-cover.total"), empty.html.indexOf("p-cover.qr"))));
});

test("text is escaped; links other than http(s) and mailto are dropped", () => {
  const { html } = render("sheet");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  const doc = JSON.parse(JSON.stringify(a4));
  const body = doc.pages[2].elements.find((e) => e.id === "p-summary.body");
  body.props.doc = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
    { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "mailto:a@b.co" } }] },
    { type: "text", text: '"><img src=x onerror=alert(1)>' },
  ] }, { type: "evilNode", content: [{ type: "text", text: "kept as text" }] }] };
  body.props.color = "red;background:url(x)";
  const out = R.renderDocument(doc, data, { mode: "sheet" }).html;
  assert.ok(!out.includes("javascript:"));
  assert.ok(out.includes('<a href="mailto:a@b.co">ok</a>'));
  assert.ok(!out.includes("<img src=x"));
  assert.ok(out.includes("kept as text"));
  assert.ok(!out.includes("evilNode"));
  assert.ok(!out.includes("url(x)"));
});

test("number formats for what the renderer draws: int, 1dp, pct, compact, Indian grouping", () => {
  assert.equal(R.formatNumber(1234567.891, "int"), "1,234,568");
  assert.equal(R.formatNumber(1234.56, "1dp"), "1,234.6");
  assert.equal(R.formatNumber(0.4567, "pct1"), "45.7%");
  assert.equal(R.formatNumber(0.4567, "pct0"), "46%");
  assert.equal(R.formatNumber(12345678, "indian"), "1,23,45,678");
  assert.equal(R.formatNumber(999, "indian"), "999");
  assert.equal(R.formatNumber(1234567, "compact"), "1.2m");
  assert.equal(R.formatNumber(15300, "compact"), "15.3k");
  assert.equal(R.formatNumber(-2500, "int"), "−2,500");
  assert.equal(R.formatNumber(null), "–");
  assert.equal(R.formatNumber(NaN), "–");
});

test("scales: nice ticks that include zero for bars", () => {
  const s = R.linearScale(130, 14200);
  assert.equal(s.min, 0);
  assert.ok(s.max >= 14200);
  assert.deepEqual(s.ticks.slice(0, 3), [0, 5000, 10000]);
  const neg = R.linearScale(-120, 340);
  assert.ok(neg.min <= -120 && neg.ticks.includes(0));
  assert.equal(neg.t(0) > 0, true);
});

test("waterfall: the first and last bars are the resolved start and end values", () => {
  const { html } = render("sheet");
  const chart = html.slice(html.indexOf('data-el-id="p-charts.water"'), html.indexOf('data-el-id="p-charts.sankey"'));
  const steps = [...chart.matchAll(/data-step="(\w+)" data-from="([-\d.]+)" data-to="([-\d.]+)"/g)].map((m) => ({ kind: m[1], from: +m[2], to: +m[3] }));
  assert.equal(steps.length, 5);
  assert.deepEqual(steps[0], { kind: "abs", from: 0, to: 14000 });
  assert.deepEqual(steps[4], { kind: "abs", from: 0, to: 12480 });
  assert.deepEqual(steps.slice(1, 4).map((s) => s.kind), ["up", "down", "down"]);
});

test("sankey: both columns sum to the total of the links", () => {
  const links = [{ from: "Grid", to: "Process", value: 60 }, { from: "Grid", to: "Buildings", value: 15 }, { from: "Diesel", to: "Fleet", value: 20 }, { from: "Solar", to: "Process", value: 5 }];
  const lay = R.sankeyLayout(links, 100, 2);
  assert.equal(lay.total, 100);
  assert.equal(lay.left.reduce((a, n) => a + n.value, 0), 100);
  assert.equal(lay.right.reduce((a, n) => a + n.value, 0), 100);
  const hl = lay.left.reduce((a, n) => a + n.h, 0) + 2 * (lay.left.length - 1);
  assert.ok(Math.abs(hl - 100) < 1e-9);
});

test("dot grid fills round(share × 100) dots; progress clamps to 0..1", () => {
  const { html } = render("sheet");
  assert.match(html, /data-filled="38"/);
  assert.match(html, /data-el-id="p-summary\.ring"[^>]*data-progress="0\.38"/);
  assert.match(html, /data-el-id="p-summary\.bar"[^>]*data-progress="0\.49"/);
});

test("QR codes decode to their URL (byte mode, level M, versions 1–40)", () => {
  for (const len of [10, 40, 120, 400, 1200]) {
    const url = "https://acme.example/" + "q".repeat(len);
    const m = R.qrMatrix(url);
    const scale = 3;
    const n = m.length + 8;
    const W = n * scale;
    const px = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const mx = Math.floor(x / scale) - 4;
        const my = Math.floor(y / scale) - 4;
        const v = mx >= 0 && my >= 0 && mx < m.length && my < m.length && m[my][mx] ? 0 : 255;
        px.set([v, v, v, 255], (y * W + x) * 4);
      }
    const r = jsQR(px, W, W);
    assert.ok(r, `length ${len} did not decode`);
    assert.equal(r.data, url);
  }
  assert.throws(() => R.qrMatrix("x".repeat(3000)));
  const { html } = render("sheet");
  assert.match(html, /data-el-id="p-el\.qr-long"[^>]*data-url=/);
  assert.match(html, /data-el-id="p-cover\.qr"[^>]*><svg[^>]*viewBox="0 0 37 37"/);
  assert.equal(R.qrMatrix("https://acme.example/ghg-2025").length, 29); // 29 bytes: version 3 at level M
});

test("theme: look → brand → style → doc overrides; contrast helpers", () => {
  const base = R.buildTheme({}, null, null);
  assert.equal(base.look, "classic");
  const brand = R.buildTheme({}, { primary: "#123456", look: "night", fontHeading: "archivo" }, null);
  assert.equal(brand.look, "night");
  assert.equal(brand.colors.primary, "#123456");
  assert.equal(brand.fonts.heading, "archivo");
  const style = R.buildTheme({}, { primary: "#123456" }, { palette: ["#AA0000", "#00AA00", "#111111", "#FAFAFA", "#777777"], fonts: { heading: "dm-serif-display", body: "noto-sans" } });
  assert.equal(style.colors.primary, "#AA0000");
  assert.equal(style.fonts.body, "noto-sans");
  const doc = R.buildTheme({ colors: { primary: "#0000FF" }, fonts: { body: "ibm-plex-serif" } }, { primary: "#123456" }, { palette: ["#AA0000", "#00AA00", "#111111", "#FAFAFA", "#777777"], fonts: { heading: "dm-serif-display", body: "noto-sans" } });
  assert.equal(doc.colors.primary, "#0000FF");
  assert.equal(doc.fonts.body, "ibm-plex-serif");
  const bad = R.buildTheme({ colors: { primary: "red;}" } }, { primary: "javascript" }, null);
  assert.equal(bad.colors.primary, base.colors.primary);
  assert.equal(Math.round(R.contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(R.contrastRatio("#777777", "#777777"), 1);
  assert.match(R.themeCss(base), /--primary:#0F5132;.*--s1:.*--font-heading:"Source Serif 4"/);
});

test("a dark page colour switches the page's text colours so the theme ink stays legible", () => {
  const { html } = render("sheet");
  const cover = html.match(/<section class="ds-sheet" id="page-p-cover"[^>]*>/)[0];
  assert.match(cover, /--ink:#FFFFFF;/);
  const white = html.match(/<section class="ds-sheet" id="page-p-charts"[^>]*>/)[0];
  assert.ok(!white.includes("--ink:"));
});

test("modes: paged sets the format's @page; print adds 3 mm bleed and crop marks; sheet shows guides; present hides all but one page", () => {
  const paged = render("paged");
  assert.match(paged.css, /@page\{size:210mm 297mm;margin:0;\}/);
  assert.match(paged.css, /@page flow\{margin:22mm 18mm 22mm 18mm;/);
  assert.ok(!paged.css.includes("bleed:"));
  const print = render("print", { cropMarks: true });
  assert.match(print.css, /@page\{size:210mm 297mm;margin:0;bleed:3mm;marks:crop;\}/);
  assert.match(print.html, /class="ds-bleed-fill" style="inset:-3mm;background:#0F5132"/);
  assert.ok(!render("print", { cropMarks: false }).css.includes("marks:crop"));
  const slide = R.renderDocument(F.fixtureDoc("slide_16_9"), data, { mode: "print", cropMarks: true });
  assert.match(slide.css, /@page\{size:338\.7mm 190\.5mm;margin:0;\}/);
  const sheet = render("sheet", { guides: true });
  assert.match(sheet.html, /class="ds-guides"/);
  assert.match(sheet.html, /class="ds-guide-safe" style="inset:10mm"/);
  assert.match(sheet.html, /class="ds-guide ds-guide--x" style="left:20mm"/);
  assert.ok(!render("paged", { guides: true }).html.includes("ds-guides"));
  const present = render("present");
  assert.match(present.css, /\.ds-doc--present \.is-current\{display:block;\}/);
  assert.ok(!present.html.includes("Speaker notes"));
  // The layout is the same in every mode: element boxes don't move.
  const box = (h) => h.match(/data-el-id="p-summary\.tile1"[^>]*style="([^"]+)"/)[1];
  assert.equal(box(sheet.html), box(paged.html));
  assert.equal(box(paged.html), box(print.html));
  assert.equal(box(print.html), box(present.html));
});

test("page numbers: sheet modes print the position; paged modes leave it to pagination", () => {
  assert.match(render("sheet").html, /<span class="ds-pn">3<\/span> of <span class="ds-pn-total">16<\/span>/);
  assert.match(render("paged").html, /<span class="ds-pn"><\/span> of <span class="ds-pn-total"><\/span>/);
});

test("flow sections: contents, indexes with page refs, BRSR Core marks, all 15 Scope 3 categories", () => {
  const { html } = render("paged");
  assert.match(html, /<ol class="ds-toc"><li><a class="ds-toc-link" href="#page-p-cover">/);
  assert.match(html, /<a class="ds-ref" href="#page-p-summary"><\/a>/);
  assert.match(html, /<span class="ds-mark">◆<\/span>/);
  const s3 = html.slice(html.indexOf('data-page-id="f-s3"'));
  assert.equal((s3.match(/data-category="/g) || []).length, 15);
  assert.match(s3, /data-category="9" data-status="not_addressed"/);
  assert.match(s3, /Scope 3 Category 9: Downstream transportation and distribution/);
  assert.match(s3, /Not relevant: no such activity in the boundary/);
  assert.match(html, /data-flow-type="narrative"[^>]*>.*data-columns="2"/s);
  // No rows → "Not reported", never an empty table.
  const none = R.renderDocument(a4, { ...data, flow: {} }, { mode: "paged" }).html;
  assert.match(none.slice(none.indexOf('data-page-id="f-gri"')), /^[^]*?data-reason="NO_ROWS"/);
});

test("a 300-row data table renders every row once, under a header row that repeats", () => {
  const big = F.fixtureData(R.renderData, { dataRows: 300 });
  const { html, css } = render("paged", {}, a4, big);
  const section = html.slice(html.indexOf('data-page-id="f-data"'), html.indexOf('data-page-id="f-gri"'));
  assert.equal((section.match(/<tr>/g) || []).length, 301); // 300 rows + the header row
  for (const n of [1, 150, 300]) assert.equal((section.match(new RegExp(`>Row ${n}<`, "g")) || []).length, 1);
  assert.match(section, /<thead><tr><th>KPI<\/th>/);
  assert.match(css, /\.ds-table thead\{display:table-header-group;\}/);
  assert.match(css, /\.ds-table tr\{break-inside:avoid;\}/);
});

test("charts: every RS kind is registered; the GHG kinds are DS-8's", () => {
  for (const k of ["stacked_bar", "bar", "line", "donut", "share_bar", "waterfall", "sankey", "target_bars", "dot_grid", "materiality_matrix", "sparkline"]) assert.ok(R.chartRenderer(k), k);
  // DS-8: the GHG kinds are registered (ci/unit/ds-8-charts.test.cjs tests them).
  for (const k of ["scope_split", "category_bars", "gas_split", "site_bars", "monthly_stack", "base_year_waterfall", "intensity_line", "treemap"]) assert.ok(R.chartRenderer(k), k);
  const { html } = render("sheet");
  assert.match(html, /data-el-id="p-charts\.ghgkind"(?:(?!data-el-id=).)*data-ghg-chart="scope_split"/s);
  // Static SVG with an accessible label; bars of prior years are grey.
  assert.match(html, /<svg [^>]*role="img" aria-label="Emissions fell for two years">/);
  const bars = html.slice(html.indexOf('data-el-id="p-summary.bars"'), html.indexOf('data-el-id="p-summary.unavail"'));
  assert.equal((bars.match(/fill="#B8C0CC"/g) || []).length, 3);
  assert.ok(!/echarts|<canvas/i.test(html));
});

test("pure: render/ imports nothing from Node, the app or a framework, and has no clock or randomness", () => {
  const dir = path.resolve("src/reporting/studio/render");
  const walk = (d) => fs.readdirSync(d).flatMap((n) => (fs.statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : n.endsWith(".ts") ? [path.join(d, n)] : []));
  for (const f of walk(dir)) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/from "([^"]+)"/g)) assert.ok(m[1].startsWith("./") || m[1].startsWith("../"), `${f}: ${m[1]}`);
    for (const m of src.matchAll(/from "(\.\.\/[^"]+)"/g)) assert.ok(path.resolve(path.dirname(f), m[1]).startsWith(dir), `${f} leaves render/: ${m[1]}`);
    assert.ok(!/Date\.now|new Date\(|Math\.random|process\.|require\(|Buffer\./.test(src), f);
  }
});

test("snapshot goldens: per element, per format, per mode (UPDATE_SNAPSHOT=1 rewrites)", () => {
  const got = G.build(R, F);
  if (process.env.UPDATE_SNAPSHOT === "1") {
    fs.writeFileSync(G.SNAPSHOT, JSON.stringify(got, null, 1) + "\n");
    fs.writeFileSync(G.FIXTURE, JSON.stringify(G.fixtureJson(R, F)) + "\n");
  }
  const want = JSON.parse(fs.readFileSync(G.SNAPSHOT, "utf8"));
  assert.equal(got.renderHash, want.renderHash, "RENDER_HASH moved: run npm run sync:studio-render, then UPDATE_SNAPSHOT=1");
  assert.deepEqual(Object.keys(got.elements).sort(), Object.keys(want.elements).sort());
  for (const id of Object.keys(want.elements)) assert.equal(got.elements[id], want.elements[id], `element ${id}`);
  assert.deepEqual(got.formats, want.formats);
  assert.deepEqual(got.modes, want.modes);
  assert.deepEqual(JSON.parse(fs.readFileSync(G.FIXTURE, "utf8")), JSON.parse(JSON.stringify(G.fixtureJson(R, F))), "fixture-a4.json is stale");
});

test("the mirror hash is current (npm run check:studio-render)", () => {
  const r = spawnSync(process.execPath, ["scripts/sync-studio-render.mjs", "check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, new RegExp(R.RENDER_HASH));
});

// #209 review: the FE mirror is type-checked by ESG-lite_FE's tsconfig (`tsc && vite build`), which is stricter than ours
// (noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch, isolatedModules, bundler resolution, DOM lib). The
// renderer is compiled here with those rules, and no ambient Node types (it is pure), so a sync can't hand the FE a mirror
// its build rejects.
const FE_TSCONFIG = {
  target: "ES2020",
  useDefineForClassFields: true,
  lib: ["ES2020", "DOM", "DOM.Iterable"],
  module: "ESNext",
  skipLibCheck: true,
  moduleResolution: "bundler",
  isolatedModules: true,
  noEmit: true,
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noFallthroughCasesInSwitch: true,
  types: [],
};
const feTsc = (dir) => {
  const files = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".ts")) files.push(p);
    }
  };
  walk(dir);
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "ds-render-fe-tsc-"));
  try {
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), JSON.stringify({ compilerOptions: FE_TSCONFIG, files }));
    return spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", path.join(tmp, "tsconfig.json")], { encoding: "utf8" });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

test("render/ compiles under the FE's tsconfig rules (the mirror never breaks ESG-lite_FE's typecheck or build)", () => {
  const r = feTsc(path.resolve("src/reporting/studio/render"));
  assert.equal(r.status, 0, `tsc with the FE rules:\n${r.stdout}${r.stderr}`);
  // The check bites: an unused parameter (the FE's TS6133) fails it.
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "ds-render-fe-bad-"));
  try {
    fs.writeFileSync(path.join(tmp, "bad.ts"), "export const ids = (xs: number[]): number[] => xs.map((x, i) => i);\n");
    const bad = feTsc(tmp);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout, /TS6133/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
