// Assembles a complete, self-contained HTML document from a Report + Theme.
// Everything is inlined (styles, echarts, paged.js, chart data) so the page has
// zero network dependencies at render time — reproducible and offline-safe.

import { readFileSync } from "node:fs";
import { renderBlocks } from "./blocks";
import { buildVariety, type Variety } from "./variety";
import type { Report, Theme } from "./types";

/** Read a bundled library from node_modules, trying minified then plain. */
function readLib(candidates: string[]): string {
  for (const rel of candidates) {
    try {
      return readFileSync(rel, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(`Could not locate any of: ${candidates.join(", ")}`);
}

const echartsJs = () =>
  readLib(["node_modules/echarts/dist/echarts.min.js", "node_modules/echarts/dist/echarts.js"]);

const pagedJs = () =>
  readLib([
    "node_modules/pagedjs/dist/paged.polyfill.min.js",
    "node_modules/pagedjs/dist/paged.polyfill.js",
  ]);

/** Map a friendly page size to a CSS @page size value. */
function pageSizeCss(size: string): string {
  if (size === "Square") return "210mm 210mm";
  return size; // A4 | Letter | any literal CSS size
}

function css(theme: Theme, report: Report): string {
  const c = theme.colors;
  const runningHeader = report.docTitle ?? "";
  return `
:root{
  --primary:${c.primary};--accent:${c.accent};--ink:${c.ink};--muted:${c.muted};
  --surface:${c.surface};--border:${c.border};--onPrimary:${c.onPrimary};
  --cover-from:${c.coverBgFrom};--cover-to:${c.coverBgTo};
  --font-heading:${theme.fonts.heading};--font-body:${theme.fonts.body};
  --tint:color-mix(in srgb, var(--primary) 6%, #ffffff);
  --tint-accent:color-mix(in srgb, var(--accent) 14%, #ffffff);
  --tint-strong:color-mix(in srgb, var(--primary) 13%, #ffffff);
  --ink-brand:color-mix(in srgb, var(--primary) 82%, #000000);
}
@page{
  size:${pageSizeCss(theme.page.size)};
  margin:${theme.page.margin};
  @top-right{ content:"${runningHeader}"; font-family:var(--font-body); font-size:8pt; font-weight:600; color:${c.accent}; }
  @bottom-left{ content:"${theme.footer}"; font-family:var(--font-body); font-size:8pt; font-weight:600; color:${c.primary}; }
  @bottom-right{ content:counter(page) " / " counter(pages); font-family:var(--font-body); font-size:8pt; font-weight:700; color:${c.accent}; }
}
@page cover{ margin:0;
  @top-right{content:none} @bottom-left{content:none} @bottom-right{content:none}
}
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; }
body{ font-family:var(--font-body); color:var(--ink); font-size:10.5pt; line-height:1.55; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1,h2,h3{ font-family:var(--font-heading); font-weight:700; margin:0; }

/* ---- Cover ---- */
.cover{ page:cover; break-after:page; position:relative; height:100%; overflow:hidden;
  background:linear-gradient(150deg,var(--cover-from) 0%,var(--cover-to) 100%);
  color:var(--onPrimary); }
.cover-bg,.cover-bg-img{ position:absolute; inset:0; width:100%; height:100%; z-index:0; }
.cover-bg svg{ width:100%; height:100%; display:block; }
.cover-bg-img{ object-fit:cover; }
.cover::after{ content:""; position:absolute; inset:0; z-index:1;
  background:linear-gradient(180deg, rgba(0,0,0,.04) 40%, rgba(0,0,0,.30) 100%); }
.cover-inner{ position:relative; z-index:2; height:100%; padding:24mm 22mm; display:flex; flex-direction:column; }
.cover-top{ flex:0 0 auto; }
.cover-logo svg{ height:34px; width:auto; }
.cover-logo img{ height:34px; width:auto; max-width:60%; object-fit:contain; }
.cover-logo{ color:var(--onPrimary); font-family:var(--font-heading); font-weight:700; font-size:18pt; }
.cover-main{ flex:1 1 auto; display:flex; flex-direction:column; justify-content:flex-end; padding-bottom:14mm; }
.cover-title{ font-size:40pt; line-height:1.08; letter-spacing:-0.02em; max-width:16em; }
.cover-subtitle{ font-size:14pt; font-weight:400; margin-top:10px; opacity:.9; max-width:34em; }
.cover-meta{ flex:0 0 auto; display:flex; flex-wrap:wrap; gap:26px 40px; padding-top:14mm; border-top:1px solid rgba(255,255,255,.28); }
.cover-meta-item{ display:flex; flex-direction:column; gap:3px; }
.cover-meta-label{ font-size:8pt; letter-spacing:.08em; text-transform:uppercase; opacity:.72; }
.cover-meta-value{ font-size:10.5pt; font-weight:600; }

/* ---- Document-style cover (white, two-column, hero) ---- */
.cover--document{ page:cover; background:#ffffff; color:var(--ink); overflow:hidden;
  display:grid; grid-template-columns:1.04fr .96fr; }
.cover--document::after{ display:none; }
.doc-left{ display:flex; flex-direction:column; padding:22mm 12mm 22mm 20mm; }
.doc-logo{ flex:0 0 auto; color:var(--primary); }
.doc-logo svg{ height:52px; width:auto; }
.doc-logo img{ height:52px; width:auto; max-width:80%; object-fit:contain; }
.doc-head{ margin-top:auto; }
.doc-title{ font-family:Georgia,'Times New Roman',serif; font-size:30pt; line-height:1.12; color:var(--ink); letter-spacing:-0.01em; }
.doc-subtitle{ font-size:11pt; font-weight:700; color:var(--accent); margin:12px 0 0; }
.doc-caption{ font-size:9.5pt; color:var(--muted); margin:6px 0 0; }
.doc-cards{ margin-top:22px; display:flex; flex-direction:column; gap:8px; }
.info-card{ background:var(--primary); color:var(--onPrimary); border-radius:8px; padding:11px 15px; }
.info-card-label{ font-family:var(--font-heading); font-weight:700; font-size:9.5pt; }
.info-card-value{ font-size:9pt; opacity:.82; margin-top:2px; }
.doc-right{ position:relative; padding:14mm 14mm 14mm 0; }
.doc-hero{ height:100%; border-radius:12px; overflow:hidden; background:var(--primary); }
.doc-hero-media{ display:block; width:100%; height:100%; object-fit:cover; }
.doc-hero-media svg{ width:100%; height:100%; display:block; }

/* full-bleed hero cover variant */
.cover--hero{ page:cover; position:relative; overflow:hidden; color:#fff; background:var(--primary); }
.cover--hero .hero-bg{ position:absolute; inset:0; z-index:0; }
.cover--hero .hero-bg img, .cover--hero .hero-bg svg{ width:100%; height:100%; object-fit:cover; display:block; }
.cover--hero::after{ content:""; position:absolute; inset:0; z-index:1; background:linear-gradient(180deg, rgba(4,10,20,.34) 0%, rgba(4,10,20,.55) 45%, rgba(4,10,20,.92) 100%); }
.cover--hero .hero-logo{ position:absolute; top:22mm; left:22mm; z-index:2; }
.cover--hero .hero-logo svg, .cover--hero .hero-logo img{ height:40px; width:auto; }
.cover--hero .hero-inner{ position:relative; z-index:2; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:24mm 22mm; }
.cover--hero .doc-title{ color:#fff; font-family:Georgia,'Times New Roman',serif; font-size:34pt; line-height:1.1; letter-spacing:-0.01em; }
.cover--hero .doc-subtitle{ color:#fff; font-size:12pt; font-weight:700; margin-top:12px; opacity:.95; }
.cover--hero .doc-caption{ color:rgba(255,255,255,.82); font-size:9.5pt; margin-top:6px; }
.cover--hero .hero-cards{ display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
.cover--hero .hero-cards .info-card{ flex:1 1 40%; background:rgba(6,12,24,.55); border:1px solid rgba(255,255,255,.30); color:#fff; }
.cover--hero .hero-cards .info-card-value{ opacity:.86; }

/* ---- Executive dashboard (statBoard) ---- */
.statboard{ break-inside:avoid; text-align:center; padding:4mm 0 2mm; }
.stat-badge{ display:inline-block; background:var(--primary); color:var(--onPrimary);
  font-family:var(--font-heading); font-weight:700; font-size:7.5pt; letter-spacing:.1em;
  text-transform:uppercase; padding:5px 11px; border-radius:6px; }
.stat-title{ font-size:19pt; color:var(--primary); margin:12px 0 16px; }
.stat-kpis{ display:grid; grid-template-columns:repeat(3,1fr); gap:11px; margin:0 0 12px; text-align:left; }
.stat-kpi{ background:var(--tint); border:1px solid var(--border); border-left:4px solid var(--accent); border-radius:12px; padding:14px 16px; }
.stat-kpi-value{ font-family:var(--font-heading); font-weight:700; font-size:21pt; color:var(--primary); line-height:1.04; }
.stat-kpi-label{ font-family:var(--font-heading); font-weight:700; font-size:9.5pt; color:var(--ink); margin-top:6px; }
.stat-kpi-sub{ font-size:8.5pt; color:var(--muted); margin-top:2px; }
.stat-tiles{ display:grid; grid-template-columns:repeat(3,1fr); gap:11px; margin-top:4px; text-align:left; }
.stat-tile{ background:var(--ink-brand); color:#fff; border-radius:12px; padding:13px 15px; }
.stat-tile-label{ font-family:var(--font-heading); font-weight:700; font-size:8.5pt; }
.stat-tile-value{ font-size:8pt; opacity:.8; margin-top:3px; }

/* ---- Section header ---- */
.section-head{ margin:0 0 16px; padding-top:0; break-before:page; break-inside:avoid; break-after:avoid-page; }
.cover + .section-head, .section-head:first-child{ break-before:avoid; margin-top:0; }
.block-title{ break-after:avoid-page; }
.section-head--band{ background:linear-gradient(135deg, var(--tint-strong), var(--tint-accent)); border:1px solid var(--border); border-radius:16px; padding:18px 20px; margin-bottom:16px; }
.section-kicker{ font-family:var(--font-heading); font-weight:700; font-size:9pt; letter-spacing:.14em; color:var(--accent); }
.section-title{ font-size:22pt; letter-spacing:-0.01em; color:var(--primary); margin-top:4px; }
.section-rule{ height:3px; width:52px; background:var(--accent); border-radius:2px; margin-top:10px; }

/* ---- Generic block ---- */
.block{ margin:0 0 16px; }
.block-title{ font-size:12.5pt; color:var(--ink); margin-bottom:8px; }
.block-subtitle{ font-size:9.5pt; color:var(--muted); margin:-4px 0 8px; }

/* ---- Narrative ---- */
.narrative p{ margin:0 0 10px; }
.narrative p:last-child{ margin-bottom:0; }
.narrative-grid{ display:grid; grid-template-columns:1fr 1fr; gap:26px; break-inside:avoid; }
.narrative-grid > div > p:last-child{ margin-bottom:0; }

/* ---- KPI tiles ---- */
.kpi-block{ break-inside:avoid; }
.kpi-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.kpi-grid--grid{ grid-template-columns:repeat(2,1fr); }
.kpi{ border:1px solid var(--border); border-top:3px solid var(--accent); border-radius:12px; padding:14px 14px 13px; background:var(--tint); }
.kpi-label{ font-size:8.5pt; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px; min-height:2.4em; }
.kpi-value{ font-family:var(--font-heading); font-weight:700; font-size:21pt; color:var(--primary); line-height:1; }
.kpi-unit{ font-size:9pt; font-weight:600; color:var(--muted); margin-left:4px; }
.kpi-delta{ margin-top:8px; display:inline-block; font-size:8.5pt; font-weight:600; padding:2px 8px; border-radius:999px; }
.kpi-delta.good{ color:#027A48; background:#ECFDF3; }
.kpi-delta.bad{ color:#B42318; background:#FEF3F2; }

/* ---- Chart ---- */
.chart-block{ break-inside:avoid; margin:0 0 18px; background:#fff; border:1px solid var(--border); border-radius:16px; padding:16px 18px; }
.chart{ width:100%; height:275px; }
.chart-caption{ font-size:8.5pt; color:var(--muted); margin-top:6px; font-style:italic; }

/* ---- Table ---- */
.table-block{ break-inside:avoid; background:#fff; border:1px solid var(--border); border-radius:16px; padding:16px 18px; }
table{ border-radius:10px; overflow:hidden; }
table{ width:100%; border-collapse:collapse; font-size:9.5pt; }
thead th{ background:var(--primary); color:var(--onPrimary); font-family:var(--font-heading); font-weight:600;
  font-size:8.5pt; text-transform:uppercase; letter-spacing:.04em; padding:10px 12px; }
tbody td{ padding:9px 12px; border-bottom:1px solid var(--border); }
tbody tr:nth-child(even){ background:var(--tint); }
tbody tr:last-child td{ font-weight:700; color:var(--primary); border-top:1.5px solid var(--border); }

/* ---- Dynamic layout rows ---- */
.lrow{ margin:0 0 18px; }
.lrow--pair{ display:grid; grid-template-columns:1fr 1.05fr; gap:24px; align-items:start; break-inside:avoid; }
.lrow--pair.pair-image, .lrow--pair.pair-kpiTiles{ grid-template-columns:1fr 1fr; }
.lrow--pair.reverse .lcol-text{ order:2; }
.lrow--pair.reverse .lcol-visual{ order:1; }
.lrow--pair .block{ margin:0; }
.lcol-text .narrative-grid{ display:block; }          /* single column inside a pair */
.lcol-text .block-title{ margin-top:0; }
.lcol-visual .chart{ height:230px; }
.lcol-visual .figure{ margin:0; }
.lcol-visual .figure img{ max-height:none; height:100%; min-height:230px; object-fit:cover; }
.lcol-visual .kpi-grid{ grid-template-columns:1fr 1fr; }
.lrow--twoup{ display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; break-inside:avoid; margin:0 0 18px; }
.lrow--twoup .block{ margin:0; }

/* ---- Image figure ---- */
.figure{ break-inside:avoid; margin:0 0 18px; }
.figure img{ width:100%; display:block; border-radius:16px; }
.figure-banner img{ height:150px; object-fit:cover; }
.figure-full img{ max-height:320px; object-fit:cover; }
.figure figcaption{ font-size:8.5pt; color:var(--muted); margin-top:6px; font-style:italic; }

/* ---- Callout ---- */
.callout{ break-inside:avoid; border-radius:12px; padding:14px 16px 14px 18px; border-left:4px solid var(--accent); background:var(--surface); }
.callout-info{ border-left-color:#2E90FA; background:#EFF8FF; }
.callout-success{ border-left-color:#12B76A; background:#ECFDF3; }
.callout-warning{ border-left-color:#F79009; background:#FFFAEB; }
.callout-title{ font-family:var(--font-heading); font-weight:700; font-size:10.5pt; margin-bottom:3px; }
.callout-body{ font-size:9.5pt; color:#344054; }
`;
}

/**
 * Browser-side orchestration: paginate FIRST, then render charts into the final
 * page-box containers. Chart containers reserve a fixed CSS height, so drawing
 * them after pagination doesn't disturb layout — and it means each chart is
 * sized to the true content width of its page (no right-edge clipping).
 */
const ORCHESTRATION = `
(async function(){
  try{
    var specs = JSON.parse(document.getElementById('chart-data').textContent || '[]');
    await window.PagedPolyfill.preview();
    var root = document.querySelector('.pagedjs_pages') || document;
    specs.forEach(function(opt, i){
      var el = root.querySelector('#chart-' + i);
      if(!el) return;
      var w = el.clientWidth || 640, h = el.clientHeight || 340;
      var chart = echarts.init(el, null, { renderer:'svg', width:w, height:h });
      chart.setOption(opt);
    });
    window.__ready = true;
  }catch(e){
    window.__error = String(e && e.stack || e);
    window.__ready = true;
  }
})();
`;

export function renderDocument(report: Report, theme: Theme, variety?: Variety): string {
  const v = variety ?? buildVariety(theme, 0);
  const { html, charts } = renderBlocks(report.blocks, theme, v);
  const chartData = JSON.stringify(charts).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${report.docTitle ?? report.slug}</title>
<style>${css(theme, report)}</style>
</head>
<body>
${html}
<script id="chart-data" type="application/json">${chartData}</script>
<script>window.PagedConfig = { auto: false };</script>
<script>${pagedJs()}</script>
<script>${echartsJs()}</script>
<script>${ORCHESTRATION}</script>
</body>
</html>`;
}
