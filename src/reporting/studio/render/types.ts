/**
 * DS-1 · the renderer's input types.
 *
 * render/ is mirrored byte for byte into ESG-lite_FE (src/lib/studio/render),
 * so it cannot import the contracts by path (they live at different places in
 * the two repos). These are structural copies of the ReportDoc v2 shapes in
 * 01-contracts §2 (backend: src/studio/contracts/schema.ts, FE:
 * src/lib/studio/contracts.ts). A contract doc is assignable to `RenderDoc`;
 * src/reporting/studio/contractsCheck.ts proves it at compile time, so a
 * contract change that the renderer doesn't follow fails `npm run build`.
 *
 * The resolved-data shapes (`RenderValue`, `RenderData`) are the renderer's
 * side of `POST /studio/resolve` (DS-2): numbers arrive formatted (`display`),
 * charts draw from `series`, and an unavailable value carries its reason.
 */

export type PageFormat = "a4" | "a4_landscape" | "letter" | "a5" | "slide_16_9" | "square" | "social_191";
export type RenderMode = "sheet" | "paged" | "present" | "print";
export type FontId = "source-serif-4" | "source-sans-3" | "dm-serif-display" | "ibm-plex-sans" | "ibm-plex-serif" | "archivo" | "fraunces" | "noto-sans";
export type Look = "classic" | "light" | "night";
export type TextStyleId = "kicker" | "title" | "heading" | "subheading" | "body" | "caption" | "big_number" | "quote" | "footnote";
export type Measure = "value" | "change_abs" | "change_pct" | "share" | "progress" | "target" | "baseline";
export type NumberFormat = "auto" | "int" | "1dp" | "2dp" | "pct0" | "pct1" | "compact" | "indian";
export type DataSource = "kpi" | "ghg" | "input" | "custom";
export type FrameMask = "rect" | "rounded" | "circle" | "arch" | "blob";

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Any binding; the renderer reads only `source` and, for custom data, the table. */
export interface RenderBinding {
  source: DataSource;
  columns?: string[];
  rows?: (string | number)[][];
}

export interface DataTokenNode {
  type: "data";
  attrs: { binding: RenderBinding; measure: Measure; format?: NumberFormat; year?: "current" | "prior" | "base" | number };
}
export interface TextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (TextNode | DataTokenNode)[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}
export interface TextDoc {
  type: "doc";
  content: TextNode[];
}

export interface ThemeOverrides {
  look?: Look;
  colors?: Partial<Record<"primary" | "accent" | "ink" | "muted" | "surface" | "coverFrom" | "coverTo", string>>;
  fonts?: { heading?: FontId; body?: FontId };
}

export interface ElementPropsByType {
  text: { doc: TextDoc; style: TextStyleId; align: "left" | "center" | "right" | "justify"; color?: string; valign?: "top" | "middle" | "bottom" };
  kpi_tile: { binding: RenderBinding; label?: string; showDelta: boolean; showSparkline: boolean; variant: "plain" | "card" | "band" };
  chart: {
    binding: RenderBinding;
    kind: string;
    title?: string;
    subtitle?: string;
    caption?: string;
    options: {
      greyPrior?: boolean;
      showValues?: boolean;
      horizontal?: boolean;
      stacked?: boolean;
      showTarget?: boolean;
      colors?: "scope" | "brand";
      showLegend?: boolean;
      variant?: "bar" | "donut";
      basisNote?: boolean;
    };
  };
  table: {
    binding?: RenderBinding;
    columns?: string[];
    rows?: (string | number | null)[][];
    style: "lined" | "zebra" | "minimal";
    totalRow?: boolean;
    /** DS-8: column widths in % of the frame (static and bound tables). */
    colWidths?: number[];
    /** DS-8: merged cells of a static table (row, column, row span, column span; body rows from 0). */
    merges?: { r: number; c: number; rs: number; cs: number }[];
  };
  image: { assetId: string; fit: "cover" | "contain"; alt: string; crop?: Crop; radius?: number; bleed?: boolean };
  shape: { shape: "rect" | "ellipse" | "line"; fill?: string; stroke?: string; strokeWidth?: number; radius?: number; opacity?: number; bleed?: boolean };
  icon: { name: string; color?: string };
  sdg: { goal: number; variant: "full" | "compact" };
  divider: { color?: string; strokeWidth?: number; style?: "solid" | "dashed" | "dotted" };
  page_number: { format?: "n" | "n_of_m"; align?: "left" | "center" | "right"; color?: string };
  placeholder: { accepts: string[]; hint?: string };
  frame: { mask: FrameMask; assetId?: string; fit: "cover" | "contain"; alt: string; crop?: Crop; bleed?: boolean };
  grid: { columns: number; gap: number; mask?: FrameMask; cells: { assetId?: string; alt: string; crop?: Crop }[] };
  line: { x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth: number; dash: "solid" | "dashed" | "dotted"; startArrow?: boolean; endArrow?: boolean };
  big_number: { binding: RenderBinding; measure?: Measure; format?: NumberFormat; label?: string; showDelta: boolean };
  progress: { binding: RenderBinding; variant: "ring" | "bar"; label?: string; color?: string };
  callout: { doc: TextDoc; icon?: string; tone?: "primary" | "accent" | "muted" | "good" | "warn"; color?: string };
  qr: { url: string; color?: string };
}
export type ElementType = keyof ElementPropsByType;

interface ElementBase {
  id: string;
  frame: Frame;
  z: number;
  hidden?: boolean;
  opacity?: number;
  locked?: boolean;
  templateLocked?: boolean;
  source?: string;
}
export type ElementOf<T extends ElementType> = ElementBase & { type: T; props: ElementPropsByType[T] };
export type RenderElement = { [T in ElementType]: ElementOf<T> }[ElementType];

export interface RenderFreeformPage {
  id: string;
  kind: "freeform";
  name: string;
  background: { color?: string; assetId?: string; fit?: "cover" | "contain" };
  elements: RenderElement[];
  hidden?: boolean;
  bookmark?: string;
  notes?: string;
  guides?: { axis: "x" | "y"; mm: number }[];
}
export interface RenderFlowSection {
  id: string;
  kind: "flow";
  name: string;
  flowType: string;
  options: { columns?: 1 | 2; years?: { last: number }; startOnRight?: boolean; categories?: number[]; showDq?: boolean; showMethod?: boolean };
  content?: TextDoc;
  hidden?: boolean;
  bookmark?: string;
}
export type RenderPage = RenderFreeformPage | RenderFlowSection;

export interface RenderDoc {
  kind: "ghg" | "sustainability";
  format: PageFormat;
  meta: { title: string; subtitle?: string; year: number; yearType: "CY" | "FY" };
  design: { theme: ThemeOverrides };
  pages: RenderPage[];
  assets: { id: string; alt: string }[];
}

// ---------------------------------------------------------------------------
// Resolved data (DS-2 POST /studio/resolve → the renderer)
// ---------------------------------------------------------------------------

/** One series of a chart: a label ("Scope 1", "2025") and its values by key (year, category, month…). */
export interface RenderSeries {
  label: string;
  values: { key: string; value: number | null }[];
}

export interface RenderValue {
  /** The formatted figure, e.g. "12,480". The renderer prints this and never formats a reported number. */
  display: string;
  value: number | null;
  unit: string | null;
  source?: DataSource;
  series?: RenderSeries[];
  approvedAt?: string | null;
  /** The value isn't recorded or can't be computed: shows "Not reported" with this reason (D7). */
  unavailable?: { reason: string } | null;
  /** Change vs the compare year, formatted ("+4.2%"), with direction and whether it is good. */
  delta?: { display: string; direction: "up" | "down" | "flat"; good?: boolean | null } | null;
  /** 0..1 for `progress` elements (base → target). */
  progress?: number | null;
  /** Target markers (target_bars). */
  target?: { baseline?: number | null; value?: number | null; year?: number; status?: string } | null;
  /** materiality_matrix points (impact, financial, 0–10). */
  points?: { label: string; x: number; y: number }[];
  /** sankey links. */
  links?: { from: string; to: string; value: number }[];
  /** DS-8: the comparison /resolve returns with `compare` (base_year_waterfall reads the base year's figure). */
  compare?: { against: string; year: number | null; value: number | null } | null;
  /** DS-8: months or quarters stacked by scope (monthly_stack), current year. */
  stacks?: RenderSeries[];
  /** A table already formatted by the source (preferred over `series` for table elements). */
  table?: { columns: string[]; rows: (string | number | null)[][] } | null;
}

/** A row of a flow table (indexes, factor table, data tables). */
export interface FlowRow {
  cells: (string | number | null)[];
  /** An element or page id the row points at; the paged renderer prints its page number. */
  ref?: string;
  /** e.g. BRSR Core ◆ */
  mark?: string;
  /** Group heading rows. */
  group?: boolean;
}
export interface FlowTable {
  columns: string[];
  rows: FlowRow[];
  note?: string;
}
export interface Scope3CategoryRow {
  n: number;
  name: string;
  status: "reported" | "excluded" | "not_addressed";
  /** Formatted value when reported. */
  display?: string;
  reason?: string;
  method?: string;
  dq?: string;
}

/** Everything a render needs besides the doc. Built by `renderData()` from a /resolve response. */
export interface RenderData {
  /** By `bindingKey(binding)`. */
  values: Record<string, RenderValue>;
  /** By `tokenKey(token.attrs)`. */
  tokens: Record<string, RenderValue>;
  /** Flow tables by section id (data tables, indexes, glossary, factor table). */
  flow?: Record<string, FlowTable>;
  /** scope3_categories sections, by section id. */
  scope3?: Record<string, Scope3CategoryRow[]>;
}

export interface RenderAssets {
  /** assetId → URL. Unknown ids render an empty frame with the alt text. */
  urls: Record<string, string>;
}

export interface RenderOptions {
  mode: RenderMode;
  watermark?: "DRAFT" | "PROOF";
  /** Print mode only: crop marks around the trim box. */
  cropMarks?: boolean;
  /** Sheet mode (editor): show the safe-area and bleed guides and the page's ruler guides. */
  guides?: boolean;
  assets?: RenderAssets;
  /** Base URL for @font-face (the API serves /studio/fonts/:file). Empty = inline by html.ts. */
  fontBase?: string;
}

/** The brand side of a theme (from `brand` + DS-3 brand kit). */
export interface RenderBrand {
  primary?: string;
  accent?: string;
  look?: Look;
  fontHeading?: FontId | null;
  fontBody?: FontId | null;
  logoUrl?: string | null;
}

/** A style preset (01-contracts §1 StylePreset). */
export interface RenderStyle {
  palette: [string, string, string, string, string];
  fonts: { heading: FontId; body: FontId };
}
