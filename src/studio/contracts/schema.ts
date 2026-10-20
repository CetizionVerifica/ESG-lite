/**
 * Design Studio contracts (DS-0) §2: the ReportDoc v2 zod schema
 * (docs/design-studio/01-contracts.md §2, on top of the RS v1 shape in
 * docs/design-studio/rs-base/01-contracts.md §2), and `upgradeV1(doc)`.
 *
 * Exports `ReportDocSchema`, `PageSchema`, `ElementSchema`, `TextDocSchema`,
 * `ThemeOverridesSchema` and the binding schemas from ./sources. Every write
 * of a doc validates with `ReportDocSchema` (DS_DOC_INVALID with the zod
 * issues) and checks `docBytes(doc) <= MAX_DOC_BYTES` (DS_DOC_TOO_LARGE).
 *
 * Rules the schema enforces beyond shapes:
 *  - every free-form element's frame lies on the page of the doc's format
 *    (images, frames and shapes flagged `bleed` may reach into the bleed);
 *  - page ids and element ids are unique in the doc;
 *  - `meta.frameworks` belong to the doc's kind;
 *  - text holds only the allowed TipTap nodes and marks, with `data` chips.
 */
import { z } from "zod";
import {
  ChartKindSchema,
  DocPurposeSchema,
  ElementSourceSchema,
  FlowTypeSchema,
  FontIdSchema,
  FRAMEWORKS_BY_KIND,
  FrameworkCodeSchema,
  HexColorSchema,
  LookSchema,
  MeasureSchema,
  NumberFormatSchema,
  PAGE_FORMAT_SIZES,
  PageFormatSchema,
  ReportKindSchema,
  TextStyleIdSchema,
  YearTypeSchema,
  type PageFormat,
} from "./enums";
import {
  BindingSchema,
  CustomDataSchema,
  DataTokenSchema,
  GhgBindingSchema,
  InputBindingSchema,
  KpiBindingSchema,
  KpiRefSchema,
  SitesSchema,
  type Binding,
} from "./sources";

/** The whole document is ≤ 2 MB of JSON (DS_DOC_TOO_LARGE). */
export const MAX_DOC_BYTES = 2 * 1024 * 1024;
export const docBytes = (doc: unknown): number => Buffer.byteLength(JSON.stringify(doc ?? null), "utf8");

/** Float slack when checking frames against the page (mm). */
export const FRAME_EPSILON_MM = 0.01;

const Id = z.string().min(1).max(120);
const Mm = z.number().finite().min(-10000).max(10000);
const Year = z.number().int().min(1990).max(2100);
const SafeUrl = z
  .string()
  .max(2000)
  .regex(/^(https?:\/\/|mailto:)/i, "Links must start with http://, https:// or mailto:");

// ---------------------------------------------------------------------------
// Text (TipTap JSON): paragraph, heading(2–4), bulletList, orderedList,
// listItem, hardBreak, text (bold, italic, link, highlight), data chips.
// ---------------------------------------------------------------------------

export const TEXT_NODE_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "hardBreak", "text"] as const;
export const TEXT_MARK_TYPES = ["bold", "italic", "link", "highlight"] as const;

export const TextMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }).strict(),
  z.object({ type: z.literal("italic") }).strict(),
  z.object({ type: z.literal("highlight"), attrs: z.object({ color: HexColorSchema.optional() }).strict().optional() }).strict(),
  z.object({ type: z.literal("link"), attrs: z.object({ href: SafeUrl }).passthrough() }).strict(),
]);

export interface TextNode {
  type: (typeof TEXT_NODE_TYPES)[number];
  attrs?: Record<string, unknown>;
  content?: Array<TextNode | z.infer<typeof DataTokenSchema>>;
  text?: string;
  marks?: Array<z.infer<typeof TextMarkSchema>>;
}

export const TextNodeSchema: z.ZodType<TextNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(TEXT_NODE_TYPES),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(z.union([DataTokenSchema, TextNodeSchema])).max(2000).optional(),
      text: z.string().max(20000).optional(),
      marks: z.array(TextMarkSchema).max(4).optional(),
    })
    .strict()
    .superRefine((node, ctx) => {
      if (node.type === "text") {
        if (typeof node.text !== "string" || !node.text.length) ctx.addIssue({ code: "custom", message: "A text node needs text", path: ["text"] });
        if (node.content) ctx.addIssue({ code: "custom", message: "A text node has no content", path: ["content"] });
      } else {
        if (node.text !== undefined) ctx.addIssue({ code: "custom", message: `${node.type} has no text of its own`, path: ["text"] });
        if (node.marks) ctx.addIssue({ code: "custom", message: "Only text carries marks", path: ["marks"] });
      }
      if (node.type === "heading") {
        const level = node.attrs?.level;
        if (level !== 2 && level !== 3 && level !== 4) ctx.addIssue({ code: "custom", message: "Headings are level 2, 3 or 4", path: ["attrs", "level"] });
      }
    }),
);

export const TextDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(TextNodeSchema).max(2000),
  })
  .strict();
export type TextDoc = z.infer<typeof TextDocSchema>;

// ---------------------------------------------------------------------------
// Theme, assets
// ---------------------------------------------------------------------------

export const ThemeOverridesSchema = z
  .object({
    look: LookSchema.optional(),
    colors: z
      .object({
        primary: HexColorSchema,
        accent: HexColorSchema,
        ink: HexColorSchema,
        muted: HexColorSchema,
        surface: HexColorSchema,
        coverFrom: HexColorSchema,
        coverTo: HexColorSchema,
      })
      .partial()
      .strict()
      .optional(),
    fonts: z.object({ heading: FontIdSchema, body: FontIdSchema }).partial().strict().optional(),
  })
  .strict();
export type ThemeOverrides = z.infer<typeof ThemeOverridesSchema>;

export const ASSET_KINDS = ["image", "logo", "ai_image"] as const;
export const AssetRefSchema = z
  .object({
    id: Id,
    kind: z.enum(ASSET_KINDS),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    alt: z.string().max(500),
  })
  .strict();
export type AssetRef = z.infer<typeof AssetRefSchema>;

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** Millimetres on the doc's format, origin top-left; rotation in degrees. */
export const FrameSchema = z
  .object({
    x: Mm,
    y: Mm,
    w: z.number().finite().positive().max(10000),
    h: z.number().finite().positive().max(10000),
    rotation: z.number().finite().min(-360).max(360),
  })
  .strict();
export type Frame = z.infer<typeof FrameSchema>;

const CropSchema = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().finite().positive(), h: z.number().finite().positive() }).strict();

/** A single value: everything but custom table data. */
export const ValueBindingSchema = z.union([KpiBindingSchema, GhgBindingSchema, InputBindingSchema]);

export const TextPropsSchema = z
  .object({
    doc: TextDocSchema,
    style: TextStyleIdSchema,
    align: z.enum(["left", "center", "right", "justify"]),
    color: HexColorSchema.optional(),
    valign: z.enum(["top", "middle", "bottom"]).optional(),
  })
  .strict();
export const KpiTilePropsSchema = z
  .object({
    binding: ValueBindingSchema,
    label: z.string().max(200).optional(),
    showDelta: z.boolean(),
    showSparkline: z.boolean(),
    variant: z.enum(["plain", "card", "band"]),
  })
  .strict();
export const ChartPropsSchema = z
  .object({
    binding: BindingSchema,
    kind: ChartKindSchema,
    title: z.string().max(300).optional(),
    subtitle: z.string().max(300).optional(),
    caption: z.string().max(1000).optional(),
    options: z
      .object({ greyPrior: z.boolean(), showValues: z.boolean(), horizontal: z.boolean(), stacked: z.boolean(), showTarget: z.boolean() })
      .partial()
      .strict(),
  })
  .strict();
export const TableCellSchema = z.union([z.string().max(2000), z.number().finite(), z.null()]);
export const TablePropsSchema = z
  .object({
    binding: BindingSchema.optional(),
    columns: z.array(z.string().max(200)).max(20).optional(),
    rows: z.array(z.array(TableCellSchema).max(20)).max(500).optional(),
    style: z.enum(["lined", "zebra", "minimal"]),
    totalRow: z.boolean().optional(),
  })
  .strict();
export const ImagePropsSchema = z
  .object({
    assetId: Id,
    fit: z.enum(["cover", "contain"]),
    alt: z.string().max(500),
    crop: CropSchema.optional(),
    radius: z.number().finite().min(0).optional(),
    bleed: z.boolean().optional(),
  })
  .strict();
export const ShapePropsSchema = z
  .object({
    shape: z.enum(["rect", "ellipse", "line"]),
    fill: HexColorSchema.optional(),
    stroke: HexColorSchema.optional(),
    strokeWidth: z.number().finite().min(0).max(50).optional(),
    radius: z.number().finite().min(0).optional(),
    opacity: z.number().min(0).max(1).optional(),
    bleed: z.boolean().optional(),
  })
  .strict();
export const IconPropsSchema = z.object({ name: z.string().min(1).max(80), color: HexColorSchema.optional() }).strict();
export const SdgPropsSchema = z.object({ goal: z.number().int().min(1).max(17), variant: z.enum(["full", "compact"]) }).strict();
export const DividerPropsSchema = z
  .object({ color: HexColorSchema.optional(), strokeWidth: z.number().finite().min(0).max(20).optional(), style: z.enum(["solid", "dashed", "dotted"]).optional() })
  .strict();
export const PageNumberPropsSchema = z
  .object({ format: z.enum(["n", "n_of_m"]).optional(), align: z.enum(["left", "center", "right"]).optional(), color: HexColorSchema.optional() })
  .strict();
export const PlaceholderPropsSchema = z
  .object({ accepts: z.array(z.enum(["text", "image", "chart", "table", "kpi_tile", "frame", "big_number"])).min(1).max(7), hint: z.string().max(300).optional() })
  .strict();

/** DS-1 §3: an image clipped by a mask, crop in the frame's coordinates. */
export const FRAME_MASKS = ["rect", "rounded", "circle", "arch", "blob"] as const;
export const FramePropsSchema = z
  .object({
    mask: z.enum(FRAME_MASKS),
    assetId: Id.optional(),
    fit: z.enum(["cover", "contain"]),
    alt: z.string().max(500),
    crop: CropSchema.optional(),
    bleed: z.boolean().optional(),
  })
  .strict();
/** A photo collage of n frames with a gap. */
export const GridPropsSchema = z
  .object({
    columns: z.number().int().min(1).max(6),
    gap: z.number().finite().min(0).max(50),
    mask: z.enum(FRAME_MASKS).optional(),
    cells: z.array(z.object({ assetId: Id.optional(), alt: z.string().max(500), crop: CropSchema.optional() }).strict()).min(1).max(12),
  })
  .strict();
/** Start and end points in mm, relative to the element's frame. */
export const LinePropsSchema = z
  .object({
    x1: Mm,
    y1: Mm,
    x2: Mm,
    y2: Mm,
    stroke: HexColorSchema.optional(),
    strokeWidth: z.number().finite().min(0.1).max(20),
    dash: z.enum(["solid", "dashed", "dotted"]),
    startArrow: z.boolean().optional(),
    endArrow: z.boolean().optional(),
  })
  .strict();
export const BigNumberPropsSchema = z
  .object({
    binding: ValueBindingSchema,
    measure: MeasureSchema.optional(),
    format: NumberFormatSchema.optional(),
    label: z.string().max(200).optional(),
    showDelta: z.boolean(),
  })
  .strict();
export const ProgressPropsSchema = z
  .object({ binding: ValueBindingSchema, variant: z.enum(["ring", "bar"]), label: z.string().max(200).optional(), color: HexColorSchema.optional() })
  .strict();
export const CalloutPropsSchema = z
  .object({ doc: TextDocSchema, icon: z.string().max(80).optional(), tone: z.enum(["primary", "accent", "muted", "good", "warn"]).optional(), color: HexColorSchema.optional() })
  .strict();
export const QrPropsSchema = z.object({ url: z.string().max(2000).regex(/^https?:\/\//i, "A QR code links to an http(s) URL"), color: HexColorSchema.optional() }).strict();

const elementBase = {
  /** '<pageId>.<slot>' for layout elements, a nanoid for user ones. */
  id: Id,
  frame: FrameSchema,
  z: z.number().int().min(-10000).max(10000),
  locked: z.boolean().optional(),
  templateLocked: z.boolean().optional(),
  groupId: Id.optional(),
  hidden: z.boolean().optional(),
  /** Element transparency (DS-6 contextual toolbar); 1 when absent. */
  opacity: z.number().min(0).max(1).optional(),
  source: ElementSourceSchema,
  reviewed: z.boolean().optional(),
  basedOnHash: z.string().max(128).optional(),
};
const el = <T extends string, P extends z.ZodType>(type: T, props: P) => z.object({ ...elementBase, type: z.literal(type), props }).strict();

export const ElementSchema = z.discriminatedUnion("type", [
  el("text", TextPropsSchema),
  el("kpi_tile", KpiTilePropsSchema),
  el("chart", ChartPropsSchema),
  el("table", TablePropsSchema),
  el("image", ImagePropsSchema),
  el("shape", ShapePropsSchema),
  el("icon", IconPropsSchema),
  el("sdg", SdgPropsSchema),
  el("divider", DividerPropsSchema),
  el("page_number", PageNumberPropsSchema),
  el("placeholder", PlaceholderPropsSchema),
  el("frame", FramePropsSchema),
  el("grid", GridPropsSchema),
  el("line", LinePropsSchema),
  el("big_number", BigNumberPropsSchema),
  el("progress", ProgressPropsSchema),
  el("callout", CalloutPropsSchema),
  el("qr", QrPropsSchema),
]);
export type Element = z.infer<typeof ElementSchema>;

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** DS-6: guides dragged out of a ruler, stored per page, never printed. */
export const GuideSchema = z.object({ axis: z.enum(["x", "y"]), mm: Mm }).strict();

export const FreeformPageSchema = z
  .object({
    id: Id,
    kind: z.literal("freeform"),
    name: z.string().max(200),
    layoutId: Id.optional(),
    background: z.object({ color: HexColorSchema.optional(), assetId: Id.optional(), fit: z.enum(["cover", "contain"]).optional() }).strict(),
    elements: z.array(ElementSchema).max(500),
    hidden: z.boolean().optional(),
    lockedByTemplate: z.boolean().optional(),
    bookmark: z.string().max(200).optional(),
    /** Speaker notes (Present mode, DS-11). */
    notes: z.string().max(20000).optional(),
    guides: z.array(GuideSchema).max(100).optional(),
  })
  .strict();
export type FreeformPage = z.infer<typeof FreeformPageSchema>;

export const FlowOptionsSchema = z
  .object({
    columns: z.union([z.literal(1), z.literal(2)]),
    kpis: z.array(KpiRefSchema).max(500),
    years: z.object({ last: z.number().int().min(1).max(20) }).strict(),
    groupBy: z.enum(["pillar", "topic"]),
    showEvidence: z.boolean(),
    startOnRight: z.boolean(),
    /** GHG flow sections (DS-7): which Scope 3 categories, and whether DQ and method show. */
    categories: z.array(z.number().int().min(1).max(15)).max(15),
    showDq: z.boolean(),
    showMethod: z.boolean(),
  })
  .partial()
  .strict();

export const FlowSectionSchema = z
  .object({
    id: Id,
    kind: z.literal("flow"),
    name: z.string().max(200),
    flowType: FlowTypeSchema,
    options: FlowOptionsSchema,
    content: TextDocSchema.optional(),
    hidden: z.boolean().optional(),
    bookmark: z.string().max(200).optional(),
  })
  .strict();
export type FlowSection = z.infer<typeof FlowSectionSchema>;

export const PageSchema = z.discriminatedUnion("kind", [FreeformPageSchema, FlowSectionSchema]);
export type Page = z.infer<typeof PageSchema>;

// ---------------------------------------------------------------------------
// ReportDoc v2
// ---------------------------------------------------------------------------

export const ReportMetaSchema = z
  .object({
    title: z.string().min(1).max(200),
    subtitle: z.string().max(300).optional(),
    year: Year,
    yearType: YearTypeSchema,
    sites: SitesSchema,
    frameworks: z.array(FrameworkCodeSchema).max(7),
    compareYear: Year.optional(),
    language: z.literal("en"),
  })
  .strict();

export const ReportDesignSchema = z
  .object({
    templateId: Id,
    templateVersion: z.number().int().min(1),
    styleId: Id.optional(),
    theme: ThemeOverridesSchema,
  })
  .strict();

/** Set on a resized copy (DS-10). */
export const DocSourceSchema = z.object({ docId: z.number().int().positive(), rev: z.number().int().min(0), dataHash: z.string().max(128) }).strict();

/** True when a frame lies on a page of `format`, allowing `allowanceMm` outside every edge. */
export const frameOnPage = (frame: { x: number; y: number; w: number; h: number }, format: PageFormat, allowanceMm = 0): boolean => {
  const { wMm, hMm } = PAGE_FORMAT_SIZES[format];
  const a = allowanceMm + FRAME_EPSILON_MM;
  return frame.x >= -a && frame.y >= -a && frame.x + frame.w <= wMm + a && frame.y + frame.h <= hMm + a;
};

/** Elements that may reach into the bleed when flagged `bleed` (full-bleed backgrounds and images). */
const mayBleed = (e: Element): boolean => (e.type === "image" || e.type === "frame" || e.type === "shape") && e.props.bleed === true;

export const ReportDocObjectSchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: ReportKindSchema,
    purpose: DocPurposeSchema,
    format: PageFormatSchema,
    meta: ReportMetaSchema,
    design: ReportDesignSchema,
    pages: z.array(PageSchema).max(500),
    assets: z.array(AssetRefSchema).max(1000),
    source: DocSourceSchema.optional(),
  })
  .strict();

export const ReportDocSchema = ReportDocObjectSchema.superRefine((doc, ctx) => {
  const allowed = FRAMEWORKS_BY_KIND[doc.kind];
  doc.meta.frameworks.forEach((f, i) => {
    if (!allowed.includes(f)) ctx.addIssue({ code: "custom", message: `${f} isn't a framework of a ${doc.kind} report`, path: ["meta", "frameworks", i] });
  });
  const pageIds = new Set<string>();
  const elementIds = new Set<string>();
  const { bleedMm } = PAGE_FORMAT_SIZES[doc.format];
  doc.pages.forEach((page, p) => {
    if (pageIds.has(page.id)) ctx.addIssue({ code: "custom", message: `Duplicate page id ${page.id}`, path: ["pages", p, "id"] });
    pageIds.add(page.id);
    if (page.kind !== "freeform") return;
    page.elements.forEach((e, i) => {
      if (elementIds.has(e.id)) ctx.addIssue({ code: "custom", message: `Duplicate element id ${e.id}`, path: ["pages", p, "elements", i, "id"] });
      elementIds.add(e.id);
      if (!frameOnPage(e.frame, doc.format, mayBleed(e) ? bleedMm : 0)) {
        ctx.addIssue({ code: "custom", message: `Element ${e.id} lies outside the ${doc.format} page`, path: ["pages", p, "elements", i, "frame"] });
      }
    });
  });
});
export type ReportDoc = z.infer<typeof ReportDocObjectSchema>;

// ---------------------------------------------------------------------------
// v1 → v2 (RS docs: always sustainability, A4, report)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** An RS v1 Binding (no `source`) as a v2 KpiBinding; anything with a source is kept. */
const upgradeBinding = (b: unknown): unknown => (isObj(b) && b.source === undefined && Array.isArray(b.kpis) ? { source: "kpi", ...b } : b);

/** RS KpiToken `{type:'kpi', attrs:{kpi, year, measure, unit?, format?, sites?}}` → DataToken. */
const upgradeToken = (node: Json, docSites: unknown): Json => {
  const a = isObj(node.attrs) ? node.attrs : {};
  const year = a.year;
  const binding: Json = {
    source: "kpi",
    kpis: [a.kpi],
    years: typeof year === "number" ? [year] : { last: year === "prior" ? 2 : 1 },
    sites: a.sites ?? docSites ?? "all",
  };
  if (a.unit !== undefined) binding.unit = a.unit;
  const attrs: Json = { binding, measure: a.measure };
  if (a.format !== undefined) attrs.format = a.format;
  if (year !== undefined) attrs.year = year;
  return { type: "data", attrs };
};

const upgradeText = (node: unknown, docSites: unknown): unknown => {
  if (!isObj(node)) return node;
  if (node.type === "kpi") return upgradeToken(node, docSites);
  return Array.isArray(node.content) ? { ...node, content: node.content.map((c) => upgradeText(c, docSites)) } : node;
};

const upgradeElement = (e: unknown, docSites: unknown): unknown => {
  if (!isObj(e) || !isObj(e.props)) return e;
  const props: Json = { ...e.props };
  if ("binding" in props) props.binding = upgradeBinding(props.binding);
  if (isObj(props.doc)) props.doc = upgradeText(props.doc, docSites);
  return { ...e, props };
};

const upgradePage = (p: unknown, docSites: unknown): unknown => {
  if (!isObj(p)) return p;
  if (p.kind === "freeform") return { ...p, elements: Array.isArray(p.elements) ? p.elements.map((e) => upgradeElement(e, docSites)) : p.elements };
  if (p.kind === "flow" && isObj(p.content)) return { ...p, content: upgradeText(p.content, docSites) };
  return p;
};

/**
 * RS ReportDoc v1 → v2: kind `sustainability`, purpose `report`, format `a4`,
 * `design.{designId, designVersion}` → `{templateId, templateVersion}`, KPI
 * bindings gain `source: 'kpi'` and `kpi` text tokens become `data` chips.
 * A v2 doc comes back unchanged. The result is not validated here: callers
 * parse it with `ReportDocSchema`. No v1 docs exist in production (DS-2).
 */
export function upgradeV1(doc: unknown): unknown {
  if (!isObj(doc)) throw new Error("Not a report doc");
  if (doc.schemaVersion === 2) return doc;
  if (doc.schemaVersion !== 1) throw new Error(`Unknown schemaVersion ${String(doc.schemaVersion)}`);
  const meta = isObj(doc.meta) ? doc.meta : {};
  const design = isObj(doc.design) ? doc.design : {};
  return {
    schemaVersion: 2,
    kind: "sustainability",
    purpose: "report",
    format: "a4",
    meta,
    design: {
      templateId: design.designId !== undefined ? String(design.designId) : "",
      templateVersion: design.designVersion,
      theme: design.theme ?? {},
    },
    pages: Array.isArray(doc.pages) ? doc.pages.map((p) => upgradePage(p, meta.sites)) : [],
    assets: Array.isArray(doc.assets) ? doc.assets : [],
  };
}

/** Every binding in a doc (element props and text chips), in page order: for resolve (DS-2) and checks (DS-12). */
export function collectBindings(doc: ReportDoc): Binding[] {
  const out: Binding[] = [];
  const walkText = (n: unknown) => {
    if (!isObj(n)) return;
    if (n.type === "data" && isObj(n.attrs)) out.push(n.attrs.binding as Binding);
    if (Array.isArray(n.content)) n.content.forEach(walkText);
  };
  for (const page of doc.pages) {
    if (page.kind === "flow") {
      walkText(page.content);
      continue;
    }
    for (const e of page.elements) {
      const props = e.props as Json;
      if (isObj(props.binding)) out.push(props.binding as Binding);
      if (isObj(props.doc)) walkText(props.doc);
    }
  }
  return out;
}

export { BindingSchema, CustomDataSchema, DataTokenSchema, GhgBindingSchema, InputBindingSchema, KpiBindingSchema };
