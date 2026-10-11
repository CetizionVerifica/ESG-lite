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

/** The report faces (OFL, from @fontsource), inlined so every PDF renders the same
 * type whatever fonts the server has. Glyphs outside the Latin subset (e.g. the
 * subscript in tCO₂e) fall back to the next face in the stack. */
const FONT_FILES: { family: string; weight: number; file: string }[] = [
  { family: "Source Sans 3", weight: 400, file: "node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2" },
  { family: "Source Sans 3", weight: 600, file: "node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2" },
  { family: "Source Sans 3", weight: 700, file: "node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff2" },
  { family: "Source Serif 4", weight: 600, file: "node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2" },
];

let fontFaceCache: string | null = null;
function fontFaces(): string {
  if (fontFaceCache !== null) return fontFaceCache;
  fontFaceCache = FONT_FILES.map((f) => {
    try {
      const b64 = readFileSync(f.file).toString("base64");
      return `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
    } catch {
      return ""; // font package missing: the stack falls back to system faces
    }
  }).join("\n");
  return fontFaceCache;
}

/** Quote a value for a CSS `content:` string. */
const cssString = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/** Map a friendly page size to a CSS @page size value. */
function pageSizeCss(size: string): string {
  if (size === "Square") return "210mm 210mm";
  return size; // A4 | Letter | any literal CSS size
}

function css(theme: Theme, report: Report): string {
  const c = theme.colors;
  const runningHeader = report.docTitle ?? "";
  const runningLeft = report.runningLeft ?? theme.name;
  const runningFooter = report.runningFooter ?? theme.footer;
  return `
${fontFaces()}
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
  @top-left{ content:${cssString(runningLeft)}; font-family:var(--font-body); font-size:7.5pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:${c.primary};
    vertical-align:bottom; padding-bottom:2mm; border-bottom:0.3mm solid ${c.primary}; }
  @top-center{ content:""; vertical-align:bottom; padding-bottom:2mm; border-bottom:0.3mm solid ${c.primary}; }
  @top-right{ content:${cssString(runningHeader)}; white-space:nowrap; font-family:var(--font-body); font-size:7.5pt; color:${c.muted};
    vertical-align:bottom; padding-bottom:2mm; border-bottom:0.3mm solid ${c.primary}; }
  @bottom-left{ content:${cssString(runningFooter)}; white-space:nowrap; font-family:var(--font-body); font-size:7.5pt; color:${c.muted};
    vertical-align:top; padding-top:2mm; border-top:0.2mm solid ${c.border}; }
  @bottom-center{ content:""; vertical-align:top; padding-top:2mm; border-top:0.2mm solid ${c.border}; }
  @bottom-right{ content:counter(page) " / " counter(pages); font-family:var(--font-body); font-size:7.5pt; font-weight:700; color:${c.primary};
    vertical-align:top; padding-top:2mm; border-top:0.2mm solid ${c.border}; }
}
@page cover{ margin:0;
  @top-left{content:none; border:none} @top-center{content:none; border:none} @top-right{content:none; border:none}
  @bottom-left{content:none; border:none} @bottom-center{content:none; border:none} @bottom-right{content:none; border:none}
}
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; }
body{ font-family:var(--font-body); color:var(--ink); font-size:10.5pt; line-height:1.55; font-feature-settings:"tnum" 1, "lnum" 1; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
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
.cover + .section-head, .section-head:first-child:not(.section-head--flow){ break-before:avoid; margin-top:0; }
/* Sub-section: flows onto the current page (no forced break) but stays glued to
   its following content, so short groups fill the page instead of orphaning. */
.section-head--flow{ break-before:auto; margin-top:22px; }
.section-head--flow .section-title{ font-size:16pt; }
.block-title{ break-after:avoid-page; }
.section-head--band{ background:linear-gradient(135deg, var(--tint-strong), var(--tint-accent)); border:1px solid var(--border); border-radius:16px; padding:18px 20px; margin-bottom:16px; }
.section-kicker{ font-family:var(--font-heading); font-weight:700; font-size:9pt; letter-spacing:.14em; color:var(--accent); }
.section-title{ font-size:22pt; letter-spacing:-0.01em; color:var(--primary); margin-top:4px; }
.section-rule{ height:3px; width:52px; background:var(--accent); border-radius:2px; margin-top:10px; }

/* ---- Generic block ---- */
.block{ margin:0 0 16px; }
.block-title{ font-family:var(--font-heading); font-weight:700; font-size:12.5pt; color:var(--ink-brand); margin-bottom:10px; display:block; }
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
.chart-block{ break-inside:avoid; margin:0 0 18px; background:#fff; border:1px solid var(--border); border-top:3px solid var(--primary); border-radius:6px 6px 12px 12px; padding:16px 18px 14px; }
.chart{ width:100%; height:320px; }
.chart--pie{ height:360px; }
.lrow--keep{ break-inside:avoid; }
.chart-caption{ font-size:9pt; color:var(--muted); margin-top:8px; padding-top:8px; border-top:1px solid var(--border); }

/* ---- Table ---- */
.table-block{ break-inside:avoid; background:#fff; border:1px solid var(--border); border-top:3px solid var(--primary); border-radius:6px 6px 12px 12px; padding:16px 18px; }
table{ width:100%; border-collapse:separate; border-spacing:0; font-size:10pt; }
thead th{ background:var(--primary); color:var(--onPrimary); font-family:var(--font-heading); font-weight:600;
  font-size:9pt; letter-spacing:.01em; padding:9px 12px; vertical-align:bottom; }
thead th:first-child{ border-top-left-radius:6px; }
thead th:last-child{ border-top-right-radius:6px; }
tbody td{ padding:8px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
tbody td.num{ font-variant-numeric:tabular-nums; white-space:nowrap; }
tbody tr:nth-child(even){ background:var(--tint); }
/* Totals row: only where the table says it has one (never the last data row). */
tbody tr.total-row td{ font-weight:700; color:var(--primary); background:var(--tint-strong); border-top:2px solid var(--primary); border-bottom:none; }

/* ---- Dynamic layout rows ---- */
.lrow{ margin:0 0 18px; }
.lrow--pair{ display:grid; grid-template-columns:1fr 1.05fr; gap:24px; align-items:start; break-inside:avoid; }
.lrow--pair.pair-image, .lrow--pair.pair-kpiTiles{ grid-template-columns:1fr 1fr; }
.lrow--pair.reverse .lcol-text{ order:2; }
.lrow--pair.reverse .lcol-visual{ order:1; }
.lrow--pair .block{ margin:0; }
.lcol-text .narrative-grid{ display:block; }          /* single column inside a pair */
.lcol-text .block-title{ margin-top:0; }
.lcol-visual .chart{ height:340px; }
.lcol-visual .chart--pie{ height:380px; }
.lcol-visual .figure{ margin:0; }
.lcol-visual .figure img{ max-height:none; height:100%; min-height:230px; object-fit:cover; }
.lcol-visual .kpi-grid{ grid-template-columns:1fr 1fr; }
.lrow--twoup{ display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; break-inside:avoid; margin:0 0 18px; }
.lrow--twoup .block{ margin:0; }

/* ---- Image figure ---- */
.figure{ break-inside:avoid; margin:0 0 18px; }
.figure img{ width:100%; display:block; border-radius:16px; }
.figure-banner img{ height:200px; object-fit:cover; }
.figure-full img{ max-height:320px; object-fit:cover; }
.figure figcaption{ font-size:8.5pt; color:var(--muted); margin-top:6px; font-style:italic; }

/* ---- Callout ---- */
.callout{ break-inside:avoid; border-radius:12px; padding:14px 16px 14px 18px; border-left:4px solid var(--accent); background:var(--surface); }
.callout-info{ border-left-color:#2E90FA; background:#EFF8FF; }
.callout-success{ border-left-color:#12B76A; background:#ECFDF3; }
.callout-warning{ border-left-color:#F79009; background:#FFFAEB; }
.callout-title{ font-family:var(--font-heading); font-weight:700; font-size:10.5pt; margin-bottom:3px; }
.callout-body{ font-size:9.5pt; color:#344054; }
${REPORT_CSS}
`;
}

/* Styles for the ruled report blocks (headline sections, KPI row, SVG figures,
   ruled tables, findings, notes, band cover). Status pill colours are fixed and
   never take the brand colours. */
const REPORT_CSS = `
.section-head--headline{ margin:0 0 6mm; }
.section-head--headline .section-kicker{ font-family:var(--font-body); font-size:7.5pt; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
.section-head--headline .section-title{ font-family:var(--font-heading); font-weight:600; font-size:18.5pt; line-height:1.16; letter-spacing:0; color:var(--primary); margin-top:1.5mm; text-wrap:balance; }
.section-head--headline:not(.section-head--flow){ padding-top:3.5mm; }
.section-head--headline.section-head--flow{ margin-top:7mm; }
.section-head--headline.section-head--flow .section-title{ font-size:14pt; }

.eyebrow{ font-size:7.5pt; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); }
.paragraph{ margin:0 0 5mm; font-size:9.5pt; color:#2D3748; }

.fig{ margin:0 0 6mm; break-inside:avoid; }
.fig-head{ display:flex; gap:2.5mm; align-items:baseline; border-top:0.5mm solid var(--primary); padding-top:1.6mm; margin-bottom:2.4mm; }
.fig-head b{ font-family:var(--font-body); font-weight:700; font-size:10.5pt; color:var(--ink); }
.fig-head span{ font-size:8pt; color:var(--muted); }
.fig-note{ margin:1.6mm 0 0; font-size:7.5pt; color:var(--muted); }
.svg-chart{ display:block; width:100%; height:auto; font-family:var(--font-body); }
.svg-chart text{ font-family:var(--font-body); }

.kpi-row{ display:grid; grid-template-columns:repeat(var(--cols,4),1fr); gap:3mm; margin:0 0 6mm; break-inside:avoid; }
.kpi-tile{ display:flex; flex-direction:column; gap:0.6mm; border-top:0.5mm solid var(--primary); padding-top:2mm; }
.kpi-tile-label{ font-size:7.8pt; font-weight:600; color:var(--muted); display:flex; align-items:center; gap:1.2mm; }
.kpi-tile-label i{ width:2.4mm; height:2.4mm; border-radius:0.5mm; display:inline-block; flex:none; }
.kpi-tile-value{ font-family:var(--font-heading); font-weight:600; font-size:23pt; line-height:1.05; color:var(--primary); }
.kpi-tile-sub{ font-size:7.5pt; color:var(--muted); }

table.ruled{ width:100%; border-collapse:collapse; border-radius:0; font-size:8.6pt; }
table.ruled th{ background:none; color:var(--primary); font-family:var(--font-body); font-weight:700; font-size:7.8pt; text-transform:none; letter-spacing:0;
  border-bottom:0.5mm solid var(--primary); padding:1.4mm 1.6mm; vertical-align:bottom; border-radius:0; }
table.ruled td{ padding:1.5mm 1.6mm; border-bottom:0.2mm solid var(--border); vertical-align:top; font-variant-numeric:tabular-nums; }
table.ruled tbody tr:nth-child(even){ background:none; }
table.ruled .r{ text-align:right; white-space:nowrap; } table.ruled .l{ text-align:left; } table.ruled .c{ text-align:center; }
table.ruled tr.total-row td{ font-weight:700; color:var(--primary); border-top:0.5mm solid var(--primary); border-bottom:none; background:var(--tint); }

.pill{ display:inline-block; font-size:7.2pt; font-weight:700; padding:0.4mm 1.8mm; border-radius:5mm; white-space:nowrap; }
.pill-ok{ background:#E7F6EC; color:#146C2E; }
.pill-warn{ background:#FFF4DE; color:#8A4B00; }
.pill-high{ background:var(--primary); color:var(--onPrimary); }
.pill-medium{ background:var(--tint-strong); color:var(--primary); }

.group-head{ display:flex; align-items:baseline; gap:2mm; border-top:0.5mm solid var(--primary); padding-top:1.6mm; margin-bottom:1.5mm; }
.group-head i{ width:3mm; height:3mm; border-radius:0.6mm; align-self:center; flex:none; }
.group-head b{ font-size:10.5pt; } .group-head span{ font-size:8pt; color:var(--muted); flex:1; }
.group-head em{ font-style:normal; font-weight:700; font-size:9pt; color:var(--primary); white-space:nowrap; }

.bullets{ margin:0 0 6mm; break-inside:avoid; }
.bullets ul{ margin:1.5mm 0 0; padding-left:4.5mm; display:grid; gap:1.2mm; font-size:9.5pt; }
.figures{ display:grid; grid-template-columns:1fr 1fr; gap:3mm 5mm; margin:0 0 6mm; break-inside:avoid; }
.figure-item{ display:flex; gap:3mm; align-items:baseline; border-top:0.2mm solid var(--border); padding-top:2mm; }
.figure-value{ font-family:var(--font-heading); font-weight:600; font-size:18pt; color:var(--primary); min-width:21mm; }
.figure-item p{ margin:0; font-size:8.8pt; }
.notes{ display:grid; grid-template-columns:1fr 1fr; gap:3mm 6mm; margin:0 0 6mm; }
.notes h3{ font-family:var(--font-body); font-size:9.5pt; color:var(--primary); margin:0 0 1mm; }
.notes p{ margin:0; font-size:8.5pt; color:#2D3748; }

/* band cover */
.cover--band{ background:#ffffff; color:var(--ink); display:flex; flex-direction:column; }
.cover--band::after{ display:none; }
.band-top{ height:28%; padding:16mm 16mm 0; display:flex; flex-direction:column; justify-content:space-between; }
.band-logo img, .band-logo svg{ height:17mm; width:auto; max-width:70%; object-fit:contain; }
.band-logo-text{ font-family:var(--font-heading); font-weight:600; font-size:20pt; color:var(--primary); }
.band-kicker{ font-size:8.5pt; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); padding-bottom:6mm; }
.band{ flex:1; position:relative; background:var(--primary); color:var(--onPrimary); padding:14mm 16mm; display:flex; flex-direction:column; overflow:hidden; }
.band > *{ position:relative; }
.band-rings{ position:absolute; right:-40mm; top:-30mm; width:150mm; height:150mm; border-radius:50%;
  background:repeating-radial-gradient(circle, transparent 0 6mm, color-mix(in srgb, var(--accent) 60%, transparent) 6mm 6.4mm); opacity:.7; }
.band-eyebrow{ margin:0; font-size:8.5pt; letter-spacing:.06em; color:color-mix(in srgb, var(--onPrimary) 75%, var(--primary)); }
.band-title{ margin:3mm 0 0; font-family:var(--font-heading); font-weight:600; font-size:37pt; line-height:1.04; max-width:11ch; letter-spacing:0; }
.band-sub{ margin:4mm 0 0; font-size:11.5pt; color:color-mix(in srgb, var(--onPrimary) 86%, var(--primary)); max-width:34ch; }
.band-hero{ margin-top:auto; display:flex; flex-wrap:wrap; align-items:baseline; gap:1.5mm 4mm; border-top:0.4mm solid color-mix(in srgb, var(--onPrimary) 35%, transparent); padding-top:5mm; }
.band-hero-value{ font-family:var(--font-heading); font-weight:600; font-size:46pt; line-height:1; }
.band-hero-unit{ font-size:10pt; color:color-mix(in srgb, var(--onPrimary) 86%, var(--primary)); }
.band-hero-delta{ font-size:9.5pt; font-weight:700; background:var(--accent); color:#ffffff; padding:0.8mm 2.4mm; border-radius:1mm; }
.band-meta{ margin:7mm 0 0; display:grid; grid-template-columns:repeat(4,1fr); gap:4mm; }
.band-meta dt{ font-size:7pt; letter-spacing:.08em; text-transform:uppercase; color:color-mix(in srgb, var(--onPrimary) 62%, var(--primary)); }
.band-meta dd{ margin:0.8mm 0 0; font-size:9pt; font-weight:600; }
`;

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
