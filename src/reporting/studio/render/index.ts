/**
 * DS-1 · the one renderer (layer: src/reporting/studio/CLAUDE.md).
 *
 *   renderDocument(doc, data, opts, brand?, style?) → {html, css}
 *       every visible page in print order: free-form sheets and flow sections.
 *       Modes: sheet (editor / thumbnails), paged (Page view, proof),
 *       present (full-screen slides, notes hidden), print (bleed + crop marks).
 *   renderSheet(page, doc, data, opts, …)  → {html, css}: one free-form page (editor shadow root).
 *   renderFlow(section, doc, data, opts, …) → {html, css}: one flow section, unpaginated.
 *
 * Pure and deterministic: the same input gives the same strings in Node and in
 * the browser. html.ts (Node only) wraps the result with fonts, Paged.js and
 * window.__ready / window.__measure.
 */
import type { RenderContext } from "./context";
import { documentCss } from "./css";
import { emptyData } from "./data";
import { renderFlowHtml } from "./flow";
import { formatSpec } from "./formats";
import { renderSheetHtml } from "./sheet";
import { buildTheme, type Theme } from "./theme";
import type { RenderBrand, RenderData, RenderDoc, RenderFlowSection, RenderFreeformPage, RenderOptions, RenderStyle } from "./types";
import { esc } from "./util";

export interface RenderResult {
  html: string;
  css: string;
  pageIds: string[];
}

function context(doc: RenderDoc, data: RenderData | null | undefined, opts: RenderOptions, theme: Theme): RenderContext {
  const visible = doc.pages.filter((p) => !p.hidden);
  return {
    doc,
    data: data ?? emptyData(),
    theme,
    format: formatSpec(doc.format),
    mode: opts.mode,
    assets: opts.assets ?? { urls: {} },
    pageNo: 1,
    pageCount: visible.length,
    pages: visible.map((p) => ({ id: p.id, name: p.name, bookmark: p.bookmark, kind: p.kind })),
  };
}

const sheetWatermark = (opts: RenderOptions) => (opts.mode === "sheet" || opts.mode === "present" ? opts.watermark : undefined);

export function renderDocument(doc: RenderDoc, data: RenderData | null | undefined, opts: RenderOptions, brand?: RenderBrand | null, style?: RenderStyle | null): RenderResult {
  const theme = buildTheme(doc.design?.theme, brand, style);
  const ctx = context(doc, data, opts, theme);
  const visible = doc.pages.filter((p) => !p.hidden);
  const parts = visible.map((p, i) => {
    const c = { ...ctx, pageNo: i + 1 };
    return p.kind === "freeform" ? renderSheetHtml(p, c, { guides: opts.guides, watermark: sheetWatermark(opts) }) : renderFlowHtml(p, c, { watermark: opts.watermark });
  });
  const html = `<div class="ds-doc ds-doc--${esc(opts.mode)}" data-format="${esc(doc.format)}" data-kind="${esc(doc.kind)}" data-mode="${esc(opts.mode)}">${parts.join("\n")}</div>`;
  return { html, css: documentCss(theme, ctx.format, opts.mode, { cropMarks: opts.cropMarks, title: doc.meta?.title }), pageIds: visible.map((p) => p.id) };
}

export function renderSheet(page: RenderFreeformPage, doc: RenderDoc, data: RenderData | null | undefined, opts: RenderOptions, brand?: RenderBrand | null, style?: RenderStyle | null): RenderResult {
  const theme = buildTheme(doc.design?.theme, brand, style);
  const ctx = context(doc, data, opts, theme);
  const idx = ctx.pages.findIndex((p) => p.id === page.id);
  const html = `<div class="ds-doc ds-doc--sheet" data-format="${esc(doc.format)}" data-mode="sheet">${renderSheetHtml(page, { ...ctx, mode: "sheet", pageNo: idx >= 0 ? idx + 1 : 1 }, { guides: opts.guides, watermark: opts.watermark })}</div>`;
  return { html, css: documentCss(theme, ctx.format, "sheet"), pageIds: [page.id] };
}

export function renderFlow(section: RenderFlowSection, doc: RenderDoc, data: RenderData | null | undefined, opts: RenderOptions, brand?: RenderBrand | null, style?: RenderStyle | null): RenderResult {
  const theme = buildTheme(doc.design?.theme, brand, style);
  const ctx = context(doc, data, { ...opts, mode: "sheet" }, theme);
  const html = `<div class="ds-doc ds-doc--sheet" data-format="${esc(doc.format)}" data-mode="sheet">${renderFlowHtml(section, ctx, {})}</div>`;
  return { html, css: documentCss(theme, ctx.format, "sheet"), pageIds: [section.id] };
}

export { buildTheme, contrastRatio, mix, themeCss, type Theme } from "./theme";
export { FORMATS, PX_PER_MM, bleedFor, formatPx, formatSpec, type FormatSpec } from "./formats";
export { FONTS, FONT_FILES, fontFaceCss, fontFile, fontStack } from "./fonts";
export { NOT_REPORTED, bindingHash, bindingKey, emptyData, lookup, renderData, tokenKey } from "./data";
export { formatNumber } from "./format";
export { MEASURE_JS, type Measurement } from "./measure";
export { qrMatrix, qrSvg } from "./qr";
export { RENDERED_ELEMENT_TYPES } from "./elements";
export { chartRenderer, registerChart, registeredChartKinds } from "./charts/registry";
// DS-8: GHG chart kinds, kind validity, typed-data rules.
export {
  ALL_CHART_KINDS,
  CHART_KIND_LABELS,
  CUSTOM_MAX_COLS,
  CUSTOM_MAX_ROWS,
  GAS_UNIT_NOTE,
  GHG_CHART_KINDS,
  RS_CHART_KINDS,
  SCOPE2_BASIS_NOTE,
  chartKindValidity,
  defaultGhgChart,
  reservedLabel,
  squarify,
  unlinkedElements,
  validChartKinds,
  yearCount,
  type ChartBindingLike,
  type GhgChartKind,
  type KindCheck,
} from "./charts/ghg";
export { bridgeSteps } from "./charts/ghg/trend";
export { pickColumns } from "./elements/table";
export { linearScale } from "./charts/scale";
export { sankeyLayout } from "./charts/sankey";
export { ICON_NAMES, SDG } from "./icons";
export { RENDER_HASH } from "./hash";
export { endsFootnoteRun, footnoteNotes, footnoteOf, pageFootnotes, readingOrder, sectionFootnotes, type PageFootnotes } from "./footnotes"; // DS-7
export type * from "./types";
