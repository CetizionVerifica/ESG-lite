// DS-1 render fixture: a ReportDoc v2 with every element type, every RS chart
// kind, an unavailable binding (market-based Scope 2), custom data, and one
// flow section of each type, plus the resolved data the renderer needs.
// `fixtureDoc(format)` lays the same pages out on any format by scaling the A4
// frames, so every format renders the same content.
const A4 = { w: 210, h: 297 };
const BLEED = { a4: 3, a4_landscape: 3, letter: 3, a5: 3, slide_16_9: 0, square: 0, social_191: 0 };
const SIZES = {
  a4: [210, 297], a4_landscape: [297, 210], letter: [215.9, 279.4], a5: [148, 210],
  slide_16_9: [338.7, 190.5], square: [285.75, 285.75], social_191: [317.5, 166.1],
};

const ghg = (metric, extra = {}) => ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra });
const kpi = (code, extra = {}) => ({ source: "kpi", kpis: [code], years: { last: 3 }, sites: "all", ...extra });
const text = (s, style = "body", extra = {}) => ({ style, align: "left", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: s }] }] }, ...extra });

const B = {
  total: ghg("total", { compare: "prior" }),
  scope1: ghg("scope1"),
  s2m: ghg("scope2_market"),
  byScope: ghg("total", { breakdown: "scope", years: { last: 3 } }),
  byCat: ghg("scope3", { breakdown: "scope3_category", top: 5 }),
  trend: ghg("total", { years: { last: 4 } }),
  renew: kpi("ENV-ENERGY-RENEW-SHARE", { years: { last: 1 } }),
  target: kpi("ENV-GHG-S12", { compare: "target" }),
  water: kpi("ENV-WATER-WITHDRAWAL"),
  matrix: kpi("GOV-MATERIALITY"),
  flows: kpi("ENV-ENERGY-FLOWS"),
  bridge: ghg("total", { compare: "base", years: [2020, 2025] }),
  custom: { source: "custom", columns: ["Initiative", "Saved tCO₂e"], rows: [["LED retrofit", 120], ["Solar PPA", 860], ["Fleet EVs", 310]] },
};

const token = (binding, measure = "value") => ({ type: "data", attrs: { binding, measure } });

let z = 0;
const el = (id, type, frame, props, extra = {}) => ({ id, type, frame: { rotation: 0, ...frame }, z: z++, source: "layout", props, ...extra });

function a4Pages() {
  z = 0;
  return [
    {
      id: "p-cover", kind: "freeform", name: "Cover", bookmark: "Cover", background: { color: "#0F5132" }, notes: "Speaker notes: open with the total.",
      guides: [{ axis: "x", mm: 20 }, { axis: "y", mm: 150 }],
      elements: [
        el("p-cover.bg", "frame", { x: -3, y: -3, w: 216, h: 150 }, { mask: "rect", assetId: "a-plant", fit: "cover", alt: "The plant at dawn", bleed: true }),
        el("p-cover.kicker", "text", { x: 20, y: 160, w: 170, h: 8 }, text("GHG INVENTORY", "kicker", { color: "#FFFFFF" })),
        el("p-cover.title", "text", { x: 20, y: 170, w: 170, h: 40 }, text("Greenhouse gas inventory 2025", "title", { color: "#FFFFFF" })),
        el("p-cover.total", "big_number", { x: 20, y: 215, w: 90, h: 32 }, { binding: B.total, measure: "value", format: "compact", label: "tCO₂e in 2025", showDelta: true }),
        el("p-cover.qr", "qr", { x: 165, y: 255, w: 25, h: 25 }, { url: "https://acme.example/ghg-2025" }),
        el("p-cover.line", "line", { x: 20, y: 250, w: 120, h: 4 }, { x1: 0, y1: 2, x2: 120, y2: 2, stroke: "#FFFFFF", strokeWidth: 0.6, dash: "dashed", endArrow: true }),
      ],
    },
    { id: "f-toc", kind: "flow", name: "Contents", flowType: "toc", options: {} },
    {
      id: "p-summary", kind: "freeform", name: "Executive summary", bookmark: "Executive summary", background: {},
      elements: [
        el("p-summary.heading", "text", { x: 15, y: 15, w: 180, h: 14 }, { style: "heading", align: "left", doc: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Executive summary" }] }] } }),
        el("p-summary.body", "text", { x: 15, y: 32, w: 180, h: 34 }, { style: "body", align: "justify", doc: { type: "doc", content: [
          { type: "paragraph", content: [{ type: "text", text: "Scope 1 emissions were " }, token(B.scope1), { type: "text", text: " tCO₂e. Market-based Scope 2 is " }, token(B.s2m), { type: "text", text: "." }] },
          { type: "bulletList", content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }, { type: "text", text: " and " }, { type: "text", text: "italic", marks: [{ type: "italic" }] }, { type: "text", text: " and " }, { type: "text", text: "highlight", marks: [{ type: "highlight", attrs: { color: "#FDE68A" } }] }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A link", marks: [{ type: "link", attrs: { href: "https://acme.example" } }] }, { type: "text", text: " and <script>alert(1)</script>" }] }] },
          ] },
        ] } }),
        el("p-summary.tile1", "kpi_tile", { x: 15, y: 70, w: 56, h: 32 }, { binding: B.total, label: "Total emissions", showDelta: true, showSparkline: true, variant: "card" }),
        el("p-summary.tile2", "kpi_tile", { x: 77, y: 70, w: 56, h: 32 }, { binding: B.scope1, label: "Scope 1", showDelta: false, showSparkline: false, variant: "plain" }),
        el("p-summary.tile3", "kpi_tile", { x: 139, y: 70, w: 56, h: 32 }, { binding: B.s2m, label: "Scope 2 (market-based)", showDelta: false, showSparkline: false, variant: "band" }),
        el("p-summary.ring", "progress", { x: 15, y: 108, w: 40, h: 40 }, { binding: B.renew, variant: "ring", label: "Renewable share" }),
        el("p-summary.bar", "progress", { x: 60, y: 118, w: 70, h: 14 }, { binding: B.target, variant: "bar", label: "Towards the 2030 target" }),
        el("p-summary.callout", "callout", { x: 135, y: 108, w: 60, h: 40 }, { icon: "leaf", tone: "good", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Biogenic CO₂ is reported separately." }] }] } }),
        el("p-summary.donut", "chart", { x: 15, y: 152, w: 85, h: 70 }, { binding: B.byScope, kind: "donut", title: "Scope 2 is the largest share", options: {} }),
        el("p-summary.bars", "chart", { x: 110, y: 152, w: 85, h: 70 }, { binding: B.trend, kind: "bar", title: "Emissions fell for two years", subtitle: "tCO₂e", caption: "Location-based Scope 2.", options: { greyPrior: true, showValues: true } }),
        el("p-summary.unavail", "chart", { x: 15, y: 226, w: 85, h: 30 }, { binding: B.s2m, kind: "bar", title: "Market-based Scope 2", options: {} }),
        el("p-summary.table", "table", { x: 110, y: 226, w: 85, h: 30 }, { binding: B.custom, style: "zebra", totalRow: false }),
        el("p-summary.pn", "page_number", { x: 170, y: 282, w: 25, h: 6 }, { format: "n_of_m", align: "right" }),
        el("p-summary.rot", "shape", { x: 15, y: 262, w: 20, h: 20, rotation: 15 }, { shape: "rect", fill: "#F59E0B", radius: 2 }, { opacity: 0.8 }),
      ],
    },
    {
      id: "p-charts", kind: "freeform", name: "Charts", background: { color: "#FFFFFF" },
      elements: [
        el("p-charts.stacked", "chart", { x: 15, y: 15, w: 85, h: 60 }, { binding: B.byScope, kind: "stacked_bar", title: "By scope", options: {} }),
        el("p-charts.hbar", "chart", { x: 110, y: 15, w: 85, h: 60 }, { binding: B.byCat, kind: "bar", title: "Top Scope 3 categories", options: { horizontal: true } }),
        el("p-charts.line", "chart", { x: 15, y: 80, w: 85, h: 55 }, { binding: B.water, kind: "line", title: "Water withdrawal", options: {} }),
        el("p-charts.share", "chart", { x: 110, y: 80, w: 85, h: 25 }, { binding: B.byScope, kind: "share_bar", options: {} }),
        el("p-charts.dots", "chart", { x: 110, y: 108, w: 40, h: 40 }, { binding: B.renew, kind: "dot_grid", options: {} }),
        el("p-charts.spark", "chart", { x: 155, y: 108, w: 40, h: 20 }, { binding: B.trend, kind: "sparkline", options: {} }),
        el("p-charts.water", "chart", { x: 15, y: 140, w: 85, h: 60 }, { binding: B.bridge, kind: "waterfall", title: "From base year to 2025", options: {} }),
        el("p-charts.sankey", "chart", { x: 110, y: 150, w: 85, h: 50 }, { binding: B.flows, kind: "sankey", title: "Energy flows", options: {} }),
        el("p-charts.target", "chart", { x: 15, y: 205, w: 85, h: 60 }, { binding: B.target, kind: "target_bars", title: "Scope 1 and 2 vs target", options: { showTarget: true } }),
        el("p-charts.matrix", "chart", { x: 110, y: 205, w: 85, h: 60 }, { binding: B.matrix, kind: "materiality_matrix", title: "Material topics", options: {} }),
        el("p-charts.custom", "chart", { x: 15, y: 268, w: 60, h: 24 }, { binding: B.custom, kind: "bar", options: { horizontal: true } }),
        el("p-charts.ghgkind", "chart", { x: 80, y: 268, w: 50, h: 24 }, { binding: B.byScope, kind: "scope_split", options: {} }),
      ],
    },
    {
      id: "p-elements", kind: "freeform", name: "Elements", background: { color: "#F8FAFC" },
      elements: [
        el("p-el.img", "image", { x: 15, y: 15, w: 60, h: 40 }, { assetId: "a-plant", fit: "cover", alt: "Plant", radius: 3 }),
        el("p-el.img-crop", "image", { x: 80, y: 15, w: 50, h: 40 }, { assetId: "a-plant", fit: "cover", alt: "Cropped plant", crop: { x: -10, y: -5, w: 80, h: 60 } }),
        el("p-el.img-missing", "image", { x: 135, y: 15, w: 60, h: 40 }, { assetId: "a-missing", fit: "contain", alt: "No such asset" }),
        el("p-el.f-round", "frame", { x: 15, y: 60, w: 40, h: 40 }, { mask: "rounded", assetId: "a-plant", fit: "cover", alt: "Rounded" }),
        el("p-el.f-circle", "frame", { x: 60, y: 60, w: 40, h: 40 }, { mask: "circle", assetId: "a-plant", fit: "cover", alt: "Circle" }),
        el("p-el.f-arch", "frame", { x: 105, y: 60, w: 40, h: 40 }, { mask: "arch", assetId: "a-plant", fit: "cover", alt: "Arch" }),
        el("p-el.f-blob", "frame", { x: 150, y: 60, w: 40, h: 40 }, { mask: "blob", assetId: "a-plant", fit: "cover", alt: "Blob" }),
        el("p-el.grid", "grid", { x: 15, y: 105, w: 90, h: 60 }, { columns: 3, gap: 2, mask: "rounded", cells: [{ assetId: "a-plant", alt: "1" }, { assetId: "a-plant", alt: "2" }, { alt: "3" }, { assetId: "a-plant", alt: "4" }, { assetId: "a-plant", alt: "5" }] }),
        el("p-el.ellipse", "shape", { x: 110, y: 105, w: 30, h: 20 }, { shape: "ellipse", fill: "#2F6FB0", stroke: "#0F5132", strokeWidth: 0.5 }),
        el("p-el.hline", "shape", { x: 145, y: 110, w: 50, h: 2 }, { shape: "line", stroke: "#0F5132", strokeWidth: 0.4 }),
        el("p-el.dotted", "line", { x: 110, y: 130, w: 85, h: 20 }, { x1: 0, y1: 0, x2: 85, y2: 20, strokeWidth: 0.8, dash: "dotted", startArrow: true, endArrow: true }),
        el("p-el.icon", "icon", { x: 110, y: 152, w: 12, h: 12 }, { name: "factory" }),
        el("p-el.icon-unknown", "icon", { x: 125, y: 152, w: 12, h: 12 }, { name: "no-such-icon", color: "#B42318" }),
        el("p-el.sdg13", "sdg", { x: 140, y: 152, w: 25, h: 25 }, { goal: 13, variant: "full" }),
        el("p-el.sdg7", "sdg", { x: 170, y: 152, w: 12, h: 12 }, { goal: 7, variant: "compact" }),
        el("p-el.divider", "divider", { x: 15, y: 170, w: 180, h: 2 }, { style: "dashed", strokeWidth: 0.4 }),
        el("p-el.placeholder", "placeholder", { x: 15, y: 176, w: 85, h: 30 }, { accepts: ["image", "chart"] }),
        el("p-el.table", "table", { x: 105, y: 176, w: 90, h: 40 }, { binding: B.byScope, style: "lined", totalRow: false }),
        el("p-el.table-own", "table", { x: 15, y: 210, w: 85, h: 30 }, { columns: ["Site", "Share"], rows: [["Manama", "62%"], ["Sitra", "38%"], ["Total", "100%"]], style: "minimal", totalRow: true }),
        el("p-el.overflow", "text", { x: 105, y: 222, w: 90, h: 8 }, text("This text is far too long for its small frame, so the measuring script reports an overflow in millimetres for the TEXT_OVERFLOW check.")),
        el("p-el.unsafe", "shape", { x: 2, y: 250, w: 30, h: 10 }, { shape: "rect", fill: "#B42318" }),
        el("p-el.hidden", "text", { x: 40, y: 250, w: 50, h: 10 }, text("Hidden element"), { hidden: true }),
        el("p-el.tiny", "text", { x: 40, y: 262, w: 60, h: 6 }, text("Footnote-sized text", "footnote")),
        el("p-el.qr-long", "qr", { x: 150, y: 245, w: 40, h: 40 }, { url: "https://acme.example/" + "x".repeat(400) }),
      ],
    },
    { id: "f-narr", kind: "flow", name: "Methodology", bookmark: "Methodology", flowType: "narrative", options: { columns: 2 }, content: { type: "doc", content: Array.from({ length: 12 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `Paragraph ${i + 1}. We follow the GHG Protocol Corporate Standard with an operational control boundary. Emission factors come from the factor library with their sources and versions listed in the annex. ` }] })) } },
    { id: "f-data", kind: "flow", name: "Data tables", flowType: "data_tables", options: { years: { last: 3 } } },
    { id: "f-gri", kind: "flow", name: "GRI content index", flowType: "gri_index", options: {} },
    { id: "f-brsr", kind: "flow", name: "BRSR index", flowType: "brsr_index", options: {} },
    { id: "f-esrs", kind: "flow", name: "ESRS index", flowType: "esrs_index", options: {} },
    { id: "f-ghgp", kind: "flow", name: "GHG Protocol index", flowType: "ghgp_index", options: {} },
    { id: "f-iso", kind: "flow", name: "ISO 14064-1 index", flowType: "iso_index", options: {} },
    { id: "f-method", kind: "flow", name: "Methods", flowType: "methodology", options: {}, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Location-based Scope 2 uses grid factors." }] }] } },
    { id: "f-gloss", kind: "flow", name: "Glossary", flowType: "glossary", options: {} },
    { id: "f-factors", kind: "flow", name: "Emission factors", flowType: "ghg_factor_table", options: {} },
    { id: "f-s3", kind: "flow", name: "Scope 3 categories", bookmark: "Scope 3 categories", flowType: "scope3_categories", options: {} },
    { id: "p-hidden", kind: "freeform", name: "Hidden page", hidden: true, background: {}, elements: [] },
  ];
}

const scaleFrame = (f, sx, sy) => ({ x: f.x * sx, y: f.y * sy, w: f.w * sx, h: f.h * sy, rotation: f.rotation });

function fixtureDoc(format = "a4", opts = {}) {
  const [w, h] = SIZES[format];
  const sx = w / A4.w;
  const sy = h / A4.h;
  const pages = a4Pages().map((p) => {
    if (p.kind !== "freeform") return p;
    return { ...p, elements: p.elements.map((e) => {
      let frame = scaleFrame(e.frame, sx, sy);
      // A bleed frame reaches the format's bleed (none on screen formats) and no further.
      if (e.props.bleed) {
        const bl = BLEED[format];
        const x = Math.max(-bl, frame.x), y = Math.max(-bl, frame.y);
        frame = { ...frame, x, y, w: Math.min(w + bl, frame.x + frame.w) - x, h: Math.min(h + bl, frame.y + frame.h) - y };
      }
      const props = e.type === "line" ? { ...e.props, x1: e.props.x1 * sx, x2: e.props.x2 * sx, y1: e.props.y1 * sy, y2: e.props.y2 * sy } : e.props;
      return { ...e, frame, props };
    }) };
  });
  return {
    schemaVersion: 2, kind: "ghg", purpose: "report", format,
    meta: { title: "ACME GHG inventory 2025", subtitle: "Scope 1, 2 and 3", year: 2025, yearType: "CY", sites: "all", frameworks: ["GHGP", "ISO14064"], compareYear: 2024, language: "en" },
    design: { templateId: "ghg-inventory", templateVersion: 1, theme: { look: "classic", colors: { primary: "#0F5132", accent: "#F59E0B" }, fonts: { heading: "fraunces", body: "source-sans-3" }, ...(opts.theme || {}) } },
    pages,
    assets: [{ id: "a-plant", kind: "image", w: 1600, h: 1000, alt: "The plant at dawn" }],
  };
}

// A 4×3 PNG (green → teal gradient) as the asset, so images render offline.
const PLANT_PNG = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0B3B25"/><stop offset="1" stop-color="#2DD4BF"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/><circle cx="120" cy="30" r="14" fill="#FDE68A"/></svg>');

const ser = (label, pairs) => ({ label, values: pairs.map(([key, value]) => ({ key: String(key), value })) });

function rows(n, cols) {
  return Array.from({ length: n }, (_, i) => ({ cells: [`Row ${i + 1}`, ...Array.from({ length: cols - 1 }, (_, c) => (i + 1) * 10 + c)] }));
}

/** Resolved data as DS-2 would return it (values are made up, display strings formatted). */
function fixtureData(renderData, opts = {}) {
  const v = (display, value, unit, extra = {}) => ({ display, value, unit, source: "ghg", approvedAt: "2026-04-12", ...extra });
  const bindings = [B.total, B.scope1, B.s2m, B.byScope, B.byCat, B.trend, B.renew, B.target, B.water, B.matrix, B.flows, B.bridge];
  const values = [
    v("12,480", 12480, "tCO₂e", { delta: { display: "−4.2%", direction: "down", good: true }, series: [ser("Total", [[2022, 13900], [2023, 13020], [2024, 13030], [2025, 12480]])] }),
    v("3,210", 3210, "tCO₂e"),
    v("Not reported", null, "tCO₂e", { unavailable: { reason: "NOT_RECORDED" } }),
    v("12,480", 12480, "tCO₂e", { series: [ser("Scope 1", [[2023, 3400], [2024, 3300], [2025, 3210]]), ser("Scope 2", [[2023, 6100], [2024, 6000], [2025, 5800]]), ser("Scope 3", [[2023, 3520], [2024, 3730], [2025, 3470]])] }),
    v("3,470", 3470, "tCO₂e", { series: [ser("tCO₂e", [["Cat 1 Purchased goods", 1500], ["Cat 4 Upstream transport", 820], ["Cat 6 Business travel", 610], ["Cat 7 Commuting", 340], ["Cat 5 Waste", 200]])] }),
    v("12,480", 12480, "tCO₂e", { series: [ser("Total", [[2022, 13900], [2023, 13020], [2024, 13030], [2025, 12480]])] }),
    { display: "38%", value: 0.38, unit: "%", source: "kpi", progress: 0.38 },
    { display: "49%", value: 9100, unit: "tCO₂e", source: "kpi", progress: 0.49, target: { baseline: 11500, value: 6500, year: 2030 }, series: [ser("Scope 1+2", [[2023, 9500], [2024, 9300], [2025, 9010]])] },
    { display: "41,200", value: 41200, unit: "m³", source: "kpi", series: [ser("Manama", [[2023, 25000], [2024, 24100], [2025, 23900]]), ser("Sitra", [[2023, 18000], [2024, 17500], [2025, 17300]])] },
    { display: "", value: null, unit: null, source: "kpi", points: [{ label: "Climate", x: 8, y: 9 }, { label: "Water", x: 6, y: 4 }, { label: "Safety", x: 3, y: 8 }, { label: "Biodiversity", x: 2, y: 3 }] },
    { display: "", value: null, unit: "GJ", source: "kpi", links: [{ from: "Grid", to: "Process", value: 60 }, { from: "Grid", to: "Buildings", value: 15 }, { from: "Diesel", to: "Fleet", value: 20 }, { from: "Solar", to: "Process", value: 5 }] },
    v("12,480", 12480, "tCO₂e", { series: [ser("Bridge", [["2020", 14000], ["Growth", 900], ["Efficiency", -1600], ["Renewables", -820], ["2025", 12480]])] }),
  ];
  const tokens = [{ type: "data", attrs: { binding: B.scope1, measure: "value" } }, { type: "data", attrs: { binding: B.s2m, measure: "value" } }];
  const tokenValues = [values[1], { display: "Not reported", value: null, unit: "tCO₂e", unavailable: { reason: "NOT_RECORDED" } }];
  const idx = (cols, n, name) => ({ columns: cols, rows: Array.from({ length: n }, (_, i) => ({ cells: [`${name}-${i + 1}`, `Our title for disclosure ${i + 1}`, i % 3 ? "Reported" : "Omitted"], ref: i % 2 ? "page-p-summary" : "page-p-charts", mark: name === "BRSR" && i % 4 === 0 ? "◆" : undefined })) });
  const flow = {
    "f-data": { columns: ["KPI", "2023", "2024", "2025"], rows: [{ group: true, cells: ["Environment"] }, ...rows(opts.dataRows ?? 12, 4)] },
    "f-gri": idx(["Code", "Disclosure", "Status"], 10, "GRI 305"),
    "f-brsr": idx(["Code", "Disclosure", "Status"], 6, "BRSR"),
    "f-esrs": idx(["Code", "Disclosure", "Status"], 6, "E1"),
    "f-ghgp": idx(["Requirement", "Where", "Status"], 8, "GHGP"),
    "f-iso": idx(["Clause", "Where", "Status"], 8, "ISO"),
    "f-gloss": { columns: ["Term", "Meaning"], rows: [{ cells: ["tCO₂e", "Tonnes of carbon dioxide equivalent"] }, { cells: ["GWP", "Global warming potential"] }] },
    "f-factors": { columns: ["Activity", "Factor", "Unit", "Source"], rows: [{ cells: ["Diesel", "2.68", "kgCO₂e/l", "DEFRA 2025"] }, { cells: ["Grid electricity", "0.71", "kgCO₂e/kWh", "CEA v20"] }] },
  };
  const scope3 = {
    "f-s3": Array.from({ length: 15 }, (_, i) => {
      const n = i + 1;
      if ([1, 4, 5, 6, 7].includes(n)) return { n, name: `Category ${n}`, status: "reported", display: String(n * 100), method: n === 1 ? "Spend-based" : "Distance-based", dq: "3.2" };
      if (n === 9) return { n, name: "Downstream transportation and distribution", status: "not_addressed" };
      return { n, name: `Category ${n}`, status: "excluded", reason: "Not relevant: no such activity in the boundary" };
    }),
  };
  return renderData(bindings, tokens, { values, tokens: tokenValues }, { flow, scope3 });
}

const assets = { urls: { "a-plant": PLANT_PNG } };

module.exports = { fixtureDoc, fixtureData, assets, SIZES, B };
