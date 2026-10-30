// DS-8 GHG chart goldens: one A4 page with every GHG chart kind (and the
// variants: scope_split as a donut, category_bars with a prior year in grey,
// monthly_stack without stacks, the base-year bridge from `compare`, a
// treemap in brand colours), plus typed data with its badge. The data has the
// shapes POST /studio/resolve returns for these bindings (DS-2
// sources/ghg.ts: one series per year keyed by the breakdown, the current
// year last; `stacks` per scope for months; a gas breakdown's series carry
// unit "t", tonnes of each gas, #209 review), with the seed company's
// figures for CY 2025 (made up; `display` is what the server sends: sources/format.ts
// formatNumber(value, "auto", unit), a tCO₂e figure with 3 decimals, #209).
//
//   build(R)        → { renderHash, elements: {id: html}, modes: {mode: {sha256, bytes}} }
//   fixtureJson(R)  → { doc, data } for the FE mirror test
//   doc(format)     → the page laid out on another format, A4 frames scaled (as the DS-1
//                     fixture does; ci/unit/ds-209-layout.test.cjs); the goldens are A4
const crypto = require("crypto");
const path = require("path");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });

const B = {
  scopes: ghg("total", { breakdown: "scope" }),
  scopes3y: ghg("total", { breakdown: "scope", years: { last: 3 } }),
  cats: ghg("scope3", { breakdown: "scope3_category", top: 8 }),
  cats2y: ghg("scope3", { breakdown: "scope3_category", top: 5, years: { last: 2 } }),
  gas: ghg("total", { breakdown: "gas", years: { last: 2 } }),
  sites: ghg("total", { breakdown: "site", top: 10 }),
  months: ghg("total", { breakdown: "month" }),
  months2: ghg("scope2_location", { breakdown: "quarter" }),
  bridge: ghg("total", { breakdown: "scope", years: [2022, 2025] }),
  bridgeCmp: ghg("total", { years: { last: 2 }, compare: "base" }),
  intensity: ghg("intensity_revenue", { years: { last: 5 } }),
  treemap: ghg("scope3", { breakdown: "scope3_category" }),
  custom: { source: "custom", columns: ["Initiative", "Saved"], rows: [["LED retrofit", 120], ["Solar PPA", 860], ["Fleet EVs", 310]] },
};

let z = 0;
const chart = (id, frame, binding, kind, extra = {}) => ({ id, type: "chart", frame: { rotation: 0, ...frame }, z: z++, source: "user", props: { binding, kind, options: {}, ...extra } });

const { SIZES } = require("./fixture.cjs");
const scaled = (format) => {
  const [w, h] = SIZES[format];
  return (f) => ({ ...f, x: (f.x * w) / 210, y: (f.y * h) / 297, w: (f.w * w) / 210, h: (f.h * h) / 297 });
};

function doc(format = "a4") {
  z = 0;
  const d = docA4();
  if (format === "a4") return d;
  const sc = scaled(format);
  return { ...d, format, pages: d.pages.map((p) => ({ ...p, elements: p.elements.map((e) => ({ ...e, frame: sc(e.frame) })) })) };
}

function docA4() {
  return {
    schemaVersion: 2, kind: "ghg", purpose: "report", format: "a4",
    meta: { title: "Seed Co GHG inventory 2025", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP"], language: "en" },
    design: { templateId: "ghg-inventory", templateVersion: 1, theme: { look: "classic" } },
    pages: [
      {
        id: "p-ghg", kind: "freeform", name: "GHG charts", background: {},
        elements: [
          chart("g.scope_split", { x: 10, y: 10, w: 90, h: 40 }, B.scopes, "scope_split", { title: "Scope 3 is the largest share" }),
          chart("g.scope_donut", { x: 110, y: 10, w: 90, h: 55 }, B.scopes3y, "scope_split", { options: { variant: "donut", basisNote: false } }),
          chart("g.category_bars", { x: 10, y: 55, w: 90, h: 60 }, B.cats, "category_bars", { title: "Purchased goods lead Scope 3" }),
          chart("g.category_prior", { x: 110, y: 70, w: 90, h: 50 }, B.cats2y, "category_bars", { options: { greyPrior: true } }),
          chart("g.gas_split", { x: 10, y: 120, w: 60, h: 45 }, B.gas, "gas_split"),
          chart("g.site_bars", { x: 75, y: 125, w: 60, h: 40 }, B.sites, "site_bars", { options: { colors: "brand" } }),
          chart("g.monthly_stack", { x: 140, y: 125, w: 60, h: 45 }, B.months, "monthly_stack"),
          chart("g.monthly_plain", { x: 10, y: 170, w: 60, h: 35 }, B.months2, "monthly_stack", { options: { showLegend: false } }),
          chart("g.base_year_waterfall", { x: 75, y: 170, w: 65, h: 45 }, B.bridge, "base_year_waterfall", { title: "Since the 2022 base year" }),
          chart("g.bridge_compare", { x: 145, y: 175, w: 55, h: 40 }, B.bridgeCmp, "base_year_waterfall"),
          chart("g.intensity_line", { x: 10, y: 220, w: 60, h: 40 }, B.intensity, "intensity_line"),
          chart("g.treemap", { x: 75, y: 220, w: 65, h: 55 }, B.treemap, "treemap"),
          chart("g.treemap_brand", { x: 145, y: 220, w: 55, h: 30 }, B.treemap, "treemap", { options: { colors: "brand", showValues: false } }),
          chart("g.custom", { x: 145, y: 255, w: 55, h: 30 }, B.custom, "bar", { options: { horizontal: true } }),
        ],
      },
    ],
    assets: [],
  };
}

const ser = (label, pairs) => ({ label, values: pairs.map(([key, value]) => ({ key: String(key), value })) });
const v = (display, value, extra = {}) => ({ display, value, unit: "tCO₂e", source: "ghg", approvedAt: "2026-04-12T09:30:00.000Z", ...extra });
const MONTHS = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
const s1m = [310, 290, 300, 270, 260, 250, 255, 262, 270, 280, 300, 313];
const s2m = [520, 480, 470, 455, 470, 510, 540, 545, 500, 470, 455, 385];
const s3m = [300, 280, 290, 285, 290, 295, 280, 285, 290, 295, 300, 280];

function data(renderData) {
  const pairs = [
    [B.scopes, v("12,480.000", 12480, { series: [ser("2025", [["Scope 1", 3410], ["Scope 2", 5800], ["Scope 3", 3270]])], total: 12480 })],
    [B.scopes3y, v("12,480.000", 12480, { series: [ser("2023", [["Scope 1", 3600], ["Scope 2", 6100], ["Scope 3", 3520]]), ser("2024", [["Scope 1", 3500], ["Scope 2", 6000], ["Scope 3", 3530]]), ser("2025", [["Scope 1", 3410], ["Scope 2", 5800], ["Scope 3", 3270]])] })],
    [B.cats, v("3,270.000", 3270, { series: [ser("2025", [["1 · Purchased goods and services", 1290], ["4 · Upstream transportation and distribution", 620], ["6 · Business travel", 410], ["7 · Employee commuting", 300], ["5 · Waste generated in operations", 210], ["3 · Fuel- and energy-related activities", 180], ["2 · Capital goods", 140], ["9 · Downstream transportation and distribution", 70], ["Other", 50]])] })],
    [B.cats2y, v("3,270.000", 3270, { series: [ser("2024", [["1 · Purchased goods and services", 1400], ["4 · Upstream transportation and distribution", 600], ["6 · Business travel", 380], ["7 · Employee commuting", 310], ["5 · Waste generated in operations", 240], ["Other", 600]]), ser("2025", [["1 · Purchased goods and services", 1290], ["4 · Upstream transportation and distribution", 620], ["6 · Business travel", 410], ["7 · Employee commuting", 300], ["5 · Waste generated in operations", 210], ["Other", 440]])] })],
    [B.gas, v("12,480.000", 12480, { series: [{ ...ser("2024", [["CO₂", 8600], ["CH₄", 21.4], ["N₂O", 3.1]]), unit: "t" }, { ...ser("2025", [["CO₂", 8350], ["CH₄", 19.8], ["N₂O", 2.9]]), unit: "t" }] })],
    [B.sites, v("12,480.000", 12480, { series: [ser("2025", [["Manama plant", 6900], ["Sitra warehouse", 2380], ["Head office", 1200], ["Muharraq depot", 2000]])] })],
    [B.months, v("12,480.000", 12480, { series: [ser("2025", MONTHS.map((m, i) => [m, s1m[i] + s2m[i] + s3m[i]]))], stacks: [ser("Scope 1", MONTHS.map((m, i) => [m, s1m[i]])), ser("Scope 2", MONTHS.map((m, i) => [m, s2m[i]])), ser("Scope 3", MONTHS.map((m, i) => [m, s3m[i]]))] })],
    [B.months2, v("5,800.000", 5800, { series: [ser("2025", [["Q1", 1470], ["Q2", 1435], ["Q3", 1585], ["Q4", 1310]])], stacks: [ser("Scope 2", [["Q1", 1470], ["Q2", 1435], ["Q3", 1585], ["Q4", 1310]])] })],
    [B.bridge, v("12,480.000", 12480, { series: [ser("2022", [["Scope 1", 3900], ["Scope 2", 6600], ["Scope 3", 3400]]), ser("2025", [["Scope 1", 3410], ["Scope 2", 5800], ["Scope 3", 3270]])] })],
    [B.bridgeCmp, v("12,480.000", 12480, { series: [ser("Total emissions", [["2024", 13030], ["2025", 12480]])], compare: { against: "base", year: 2022, value: 13900, change_abs: -1420, change_pct: -10.2 } })],
    [B.intensity, { display: "41.6", value: 41.6, unit: "tCO₂e per unit of revenue", source: "ghg", series: [ser("Intensity per revenue", [["2021", 52.3], ["2022", 49.8], ["2023", 46.1], ["2024", 44.0], ["2025", 41.6]])] }],
    [B.treemap, v("3,270.000", 3270, { series: [ser("2025", [["1 · Purchased goods and services", 1290], ["4 · Upstream transportation and distribution", 620], ["6 · Business travel", 410], ["7 · Employee commuting", 300], ["5 · Waste generated in operations", 210], ["3 · Fuel- and energy-related activities", 180], ["2 · Capital goods", 140], ["9 · Downstream transportation and distribution", 70], ["12 · End-of-life treatment of sold products", 50]])] })],
  ];
  return renderData(pairs.map((p) => p[0]), [], { values: pairs.map((p) => p[1]) });
}

function build(R) {
  const d = doc();
  const dt = data(R.renderData);
  const html = R.renderSheet(d.pages[0], d, dt, { mode: "sheet" }).html;
  const elements = {};
  const re = /<div class="ds-el [^"]*" data-el-id="([^"]+)"/g;
  let m;
  const starts = [];
  while ((m = re.exec(html))) starts.push({ id: m[1], at: m.index });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : html.lastIndexOf("</section>");
    elements[s.id] = html.slice(s.at, end);
  });
  const modes = {};
  for (const mode of ["sheet", "paged", "present", "print"]) {
    const r = R.renderDocument(d, dt, { mode, cropMarks: mode === "print" });
    modes[mode] = { sha256: sha(r.html + "\n" + r.css), bytes: r.html.length + r.css.length };
  }
  return { renderHash: R.RENDER_HASH, elements, modes };
}

const fixtureJson = (R) => ({ doc: doc(), data: data(R.renderData) });

module.exports = { B, doc, data, build, fixtureJson, sha, SNAPSHOT: path.join(__dirname, "ghg-snapshots.json"), FIXTURE: path.join(__dirname, "ghg-fixture.json") };
