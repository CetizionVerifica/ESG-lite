/**
 * DS-1 · the document stylesheet. Layout is the same in every mode; modes only
 * add page rules (paged, print), bleed and crop marks (print), the present
 * shell, and editor guides (sheet).
 */
import { bleedFor, type FormatSpec } from "./formats";
import { textStyleCss } from "./textStyles";
import { themeCss, type Theme } from "./theme";
import type { RenderMode } from "./types";
import { mm } from "./util";

const BASE = `
.ds-doc{font-family:var(--font-body);color:var(--ink);font-size:10pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:lining-nums;text-rendering:geometricPrecision;}
.ds-doc *,.ds-doc *::before,.ds-doc *::after{box-sizing:border-box;}
.ds-sheet{position:relative;overflow:hidden;background-color:var(--paper);page:freeform;break-after:page;break-inside:avoid;margin:0;}
.ds-el{position:absolute;transform-origin:50% 50%;}
.ds-bookmark{position:absolute;left:0;top:0;width:1px;height:1px;margin:0;overflow:hidden;font-size:1px;line-height:1;color:transparent;}
.ds-bg,.ds-bleed-fill{position:absolute;z-index:-1;overflow:hidden;}
.ds-bg img{width:100%;height:100%;display:block;}
.ds-text{width:100%;height:100%;display:flex;flex-direction:column;}
.ds-text-in>*:first-child{margin-top:0;}
.ds-text-in>*:last-child{margin-bottom:0;}
.ds-text-in p,.ds-callout-text p,.ds-narrative p{margin:0 0 0.55em;}
.ds-text-in h2,.ds-text-in h3,.ds-text-in h4,.ds-narrative h2,.ds-narrative h3,.ds-narrative h4{font-family:var(--font-heading);font-weight:600;line-height:1.2;margin:0 0 0.35em;}
.ds-narrative h2{font-size:15pt;}.ds-narrative h3{font-size:12pt;}.ds-narrative h4{font-size:10.5pt;}
.ds-text-in ul,.ds-text-in ol,.ds-narrative ul,.ds-narrative ol,.ds-callout-text ul{margin:0 0 0.55em;padding-left:1.3em;}
.ds-doc a{color:var(--primary);text-decoration:underline;}
.ds-doc mark{background:color-mix(in srgb,var(--accent) 30%,transparent);color:inherit;padding:0 0.1em;}
.ds-chip{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;}
.ds-nr{color:var(--muted);font-style:italic;font-weight:400;font-size:0.92em;}
.ds-unit{margin-left:0.3em;font-size:0.42em;font-weight:600;color:var(--muted);letter-spacing:0;}
.ds-delta{display:inline-block;font-size:8.5pt;font-weight:700;margin-top:1mm;}
.ds-delta--good{color:var(--good);}.ds-delta--bad{color:var(--bad);}.ds-delta--flat{color:var(--muted);}
.ds-tile{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:1mm;padding:3mm;overflow:hidden;}
.ds-tile--card{background:var(--surface);border:0.3mm solid var(--border);border-radius:2mm;}
.ds-tile--band{background:var(--primary);color:var(--onPrimary);}
.ds-tile--band .ds-unit,.ds-tile--band .ds-tile-label,.ds-tile--band .ds-nr{color:inherit;opacity:0.85;}
.ds-tile--band .ds-delta{color:inherit;}
.ds-tile-label{font-size:8pt;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;}
.ds-tile-value{font-family:var(--font-heading);font-weight:600;font-size:22pt;line-height:1.05;font-variant-numeric:tabular-nums;}
.ds-tile-spark{height:22%;min-height:4mm;}
.ds-big{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;}
.ds-big-value{font-variant-numeric:tabular-nums;white-space:nowrap;}
.ds-big-label{font-size:9pt;color:var(--muted);margin-top:1mm;}
.ds-sheet[style*="background-color"] .ds-big-label{color:inherit;opacity:0.85;}
.ds-progress{width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;gap:1.5mm;}
.ds-progress--ring{align-items:center;}
.ds-progress--ring svg{flex:1;min-height:0;}
.ds-progress-label{font-size:8.5pt;color:var(--muted);text-align:center;}
.ds-progress-head{display:flex;justify-content:space-between;align-items:baseline;font-size:9pt;}
.ds-progress--bar .ds-progress-label{text-align:left;}
.ds-progress-pct{font-weight:700;font-variant-numeric:tabular-nums;}
.ds-progress-track{height:2.4mm;border-radius:1.2mm;background:var(--border);overflow:hidden;}
.ds-progress-fill{height:100%;border-radius:1.2mm;}
.ds-callout{width:100%;height:100%;display:flex;gap:3mm;padding:3.5mm 4mm;border-left:1.2mm solid var(--primary);border-radius:1.5mm;overflow:hidden;}
.ds-callout-icon{flex:0 0 7mm;height:7mm;}
.ds-callout-text{flex:1;min-width:0;}
.ds-chart{margin:0;width:100%;height:100%;display:flex;flex-direction:column;}
.ds-chart-title{margin:0 0 0.6mm;}
.ds-chart-plot{flex:1;min-height:0;}
.ds-chart-plot svg{display:block;}
.ds-chart-caption{margin-top:1mm;}
.ds-unlinked{display:none;position:absolute;top:0.8mm;right:0.8mm;z-index:1;font-size:7pt;font-weight:700;line-height:1.3;color:#92400E;background:#FEF3C7;border:0.25mm solid #F59E0B;border-radius:1mm;padding:0.2mm 1.2mm;pointer-events:none;}
.ds-table--fixed{table-layout:fixed;}
.ds-table td.ds-merged{vertical-align:middle;}
.ds-table{width:100%;border-collapse:collapse;font-size:8.5pt;font-variant-numeric:tabular-nums;}
.ds-table th{text-align:left;font-weight:700;color:var(--ink);padding:1.4mm 1.6mm;border-bottom:0.4mm solid var(--ink);}
.ds-table td{padding:1.2mm 1.6mm;vertical-align:top;}
.ds-table .num{text-align:right;}
.ds-table--lined td{border-bottom:0.2mm solid var(--border);}
.ds-table--zebra tbody tr:nth-child(even) td{background:var(--surface);}
.ds-table--minimal th{border-bottom-width:0.2mm;}
.ds-table tr.ds-total td{font-weight:700;border-top:0.4mm solid var(--ink);border-bottom:none;}
.ds-table tr.ds-group th{background:var(--surface);border-bottom:none;padding-top:2mm;}
.ds-table thead{display:table-header-group;}
.ds-table tr{break-inside:avoid;}
.ds-mark{color:var(--accent);}
.ds-media{position:relative;width:100%;height:100%;overflow:hidden;}
.ds-media>img{display:block;}
.ds-img-missing{width:100%;height:100%;background:repeating-linear-gradient(45deg,var(--surface) 0 2mm,var(--border) 2mm 2.4mm);}
.ds-grid{position:relative;width:100%;height:100%;}
.ds-grid-cell{position:absolute;}
.ds-shape{width:100%;height:100%;}
.ds-divider{width:100%;position:relative;top:50%;}
.ds-sdg{width:100%;height:100%;color:#FFFFFF;display:flex;flex-direction:column;padding:8%;overflow:hidden;font-weight:700;}
.ds-sdg-n{font-size:2em;line-height:1;}
.ds-sdg--compact{align-items:center;justify-content:center;}
.ds-sdg-label{font-size:0.6em;text-transform:uppercase;line-height:1.15;margin-top:0.4em;}
.ds-page-number{width:100%;}
.ds-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;border:0.4mm dashed var(--muted);border-radius:1.5mm;color:var(--muted);font-size:8.5pt;padding:2mm;}
.ds-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:10000;overflow:hidden;}
.ds-watermark span{transform:rotate(-30deg);font-size:72pt;font-weight:700;letter-spacing:0.1em;color:var(--bad);opacity:0.12;}
.ds-flow{page:flow;break-before:page;}
.ds-flow-title{margin:0 0 5mm;color:var(--primary);}
.ds-narrative[data-columns="2"]{column-count:2;column-gap:8mm;}
.ds-flow-table{margin:2mm 0 4mm;}
.ds-flow-note{margin:0 0 4mm;}
.ds-flow-missing{margin:2mm 0;}
.ds-status{font-weight:700;font-size:7.5pt;text-transform:uppercase;letter-spacing:0.04em;}
.ds-status--reported{color:var(--good);}.ds-status--excluded{color:var(--muted);}.ds-status--not_addressed{color:var(--bad);}
.ds-toc{list-style:none;margin:0;padding:0;font-size:11pt;}
.ds-toc li{margin:0 0 2.5mm;}
.ds-toc a{display:flex;gap:2mm;color:var(--ink);text-decoration:none;}
.ds-toc-dots{flex:1;border-bottom:0.3mm dotted var(--muted);margin-bottom:1.2mm;}
.ds-toc-page{font-variant-numeric:tabular-nums;}
`;

const PAGED = (f: FormatSpec, mode: RenderMode, cropMarks: boolean, title: string): string => {
  const bleed = bleedFor(f.id, mode);
  const [t, r, b, l] = f.flowMarginsMm;
  const extra = mode === "print" && bleed ? `bleed:${mm(bleed)};${cropMarks ? "marks:crop;" : ""}` : "";
  return `
@page{size:${mm(f.wMm)} ${mm(f.hMm)};margin:0;${extra}}
@page freeform{margin:0;}
@page flow{margin:${mm(t)} ${mm(r)} ${mm(b)} ${mm(l)};
  @bottom-right{content:counter(page);font-family:var(--font-body);font-size:8pt;color:var(--muted);}
  @bottom-left{content:${JSON.stringify(title).replace(/</g, "\\3c ")};font-family:var(--font-body);font-size:8pt;color:var(--muted);}
}
.ds-toc-link::after,.ds-ref::after{content:target-counter(attr(href),page);font-variant-numeric:tabular-nums;}
.ds-ref{color:var(--ink);text-decoration:none;}
${mode === "print" ? ".ds-sheet{overflow:visible;}" : ""}
`;
};

const SHEET = `
.ds-doc--sheet .ds-sheet{margin:0 auto 8mm;box-shadow:0 0.5mm 3mm rgba(15,23,42,0.18);}
.ds-doc--sheet .ds-flow{width:var(--flow-w);margin:0 auto 8mm;padding:var(--flow-pad);background:var(--paper);box-shadow:0 0.5mm 3mm rgba(15,23,42,0.18);}
.ds-guides{position:absolute;inset:0;pointer-events:none;z-index:10001;}
.ds-guide-safe{position:absolute;border:0.25mm dashed rgba(37,99,235,0.6);}
.ds-guide-bleed{position:absolute;border:0.25mm solid rgba(220,38,38,0.6);}
.ds-guide{position:absolute;background:rgba(236,72,153,0.8);}
.ds-guide--x{top:0;bottom:0;width:0.25mm;}
.ds-guide--y{left:0;right:0;height:0.25mm;}
@media print{.ds-guides{display:none;}}
.ds-doc--sheet .ds-unlinked{display:inline-block;}
@media print{.ds-doc--sheet .ds-unlinked{display:none;}}
`;

const PRESENT = `
html,body{margin:0;background:#000;height:100%;overflow:hidden;}
.ds-doc--present .ds-sheet,.ds-doc--present .ds-flow{display:none;position:absolute;left:50%;top:50%;transform-origin:center center;}
.ds-doc--present .ds-flow{width:var(--flow-w);height:var(--flow-h);padding:var(--flow-pad);background:var(--paper);overflow:auto;}
.ds-doc--present .is-current{display:block;}
`;

/** The full stylesheet for a render. */
export function documentCss(theme: Theme, f: FormatSpec, mode: RenderMode, opts: { cropMarks?: boolean; title?: string } = {}): string {
  const [t, r, b, l] = f.flowMarginsMm;
  const flowVars = `.ds-doc{--flow-w:${mm(f.wMm)};--flow-h:${mm(f.hMm)};--flow-pad:${mm(t)} ${mm(r)} ${mm(b)} ${mm(l)};}`;
  const modeCss = mode === "paged" || mode === "print" ? PAGED(f, mode, !!opts.cropMarks, opts.title ?? "") : mode === "present" ? PRESENT : SHEET;
  return `${themeCss(theme)}\n${flowVars}\n${BASE}\n${textStyleCss(f.id)}\n${modeCss}`;
}

/** Only what one sheet needs (the editor's shadow root): theme, base, type scale and guides. */
export function sheetCss(theme: Theme, f: FormatSpec): string {
  return documentCss(theme, f, "sheet");
}
