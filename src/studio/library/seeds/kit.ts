/**
 * DS-4 · the authoring kit for the library seeds (data/studio/**). Pure
 * builders: a layout is written as a page of named slots, and
 * `npm run seeds:ds-4` (src/scripts/buildStudioSeeds.ts) turns the modules in
 * this folder into the JSON files the loader reads. Edit the TypeScript, run
 * the script, commit both: ci/unit/ds-4-library.test.cjs fails when the JSON
 * is stale.
 *
 * Colours: layouts never hard-code a colour, so the Classic, Light and Night
 * looks and the client's brand decide them (theme variables in the renderer).
 * Numbers: only through bindings (GHG, KPI, report inputs), never typed.
 */
import type { Binding, Element, FreeformPage, GhgBinding, InputBinding, KpiBinding, LayoutKind, PageFormat, TextDoc, TextNode, TextStyleId } from "../../contracts";
import { PAGE_FORMAT_SIZES } from "../../contracts";

type Json = Record<string, unknown>;
export type Frame = [x: number, y: number, w: number, h: number];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export type Inline = string | { type: "data"; attrs: Json };

const inline = (parts: Inline[]): TextNode[] =>
  parts.filter((p) => p !== "").map((p) => (typeof p === "string" ? { type: "text" as const, text: p } : (p as unknown as TextNode)));

/** One paragraph of text and data chips. */
export const para = (...parts: Inline[]): TextNode => ({ type: "paragraph", content: inline(parts) });
export const h = (level: 2 | 3 | 4, text: string): TextNode => ({ type: "heading", attrs: { level }, content: inline([text]) });
export const bullets = (...items: Inline[][]): TextNode => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [para(...i)] })) });
export const doc = (...nodes: TextNode[]): TextDoc => ({ type: "doc", content: nodes });
/** A paragraph doc from plain strings (one paragraph each). */
export const textDoc = (...paragraphs: string[]): TextDoc => doc(...paragraphs.map((p) => para(p)));

/** A data chip (01-contracts §2 DataToken). */
export const chip = (binding: GhgBinding | KpiBinding, measure: "value" | "change_pct" | "share" | "progress" = "value", format?: string): Inline => ({
  type: "data",
  attrs: { binding, measure, ...(format ? { format } : {}) },
});

// ---------------------------------------------------------------------------
// Bindings (relative to the doc's year and sites; DS-5 narrows `sites`)
// ---------------------------------------------------------------------------

export const ghg = (metric: GhgBinding["metric"], extra: Partial<Omit<GhgBinding, "source" | "metric">> = {}): GhgBinding =>
  ({ source: "ghg", metric, years: { last: 1 }, sites: "all", ...extra }) as GhgBinding;
export const kpi = (codes: string | string[], extra: Partial<Omit<KpiBinding, "source" | "kpis">> = {}): KpiBinding => ({
  source: "kpi",
  kpis: Array.isArray(codes) ? codes : [codes],
  years: { last: 1 },
  sites: "all",
  ...extra,
});
export const input = (key: InputBinding["key"]): InputBinding => ({ source: "input", key });

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export interface LayoutSeed {
  role: string;
  pageKind: LayoutKind;
  name: string;
  page: FreeformPage;
}

/** A page under construction: slots are added in z order. */
export class PageBuilder {
  readonly W: number;
  readonly H: number;
  /** The usual content margin (mm): the format's safe margin plus air. */
  readonly M: number;
  private els: Element[] = [];
  private z = 1;
  private background: FreeformPage["background"] = {};

  constructor(
    readonly role: string,
    readonly pageKind: LayoutKind,
    readonly name: string,
    readonly format: PageFormat,
  ) {
    const s = PAGE_FORMAT_SIZES[format];
    this.W = s.wMm;
    this.H = s.hMm;
    this.M = format === "slide_16_9" || format === "social_191" || format === "square" ? 20 : format === "a5" ? 13 : 18;
  }

  /** Content width between the margins. */
  get CW() {
    return this.W - 2 * this.M;
  }

  private push(slot: string, type: Element["type"], f: Frame, props: Json, extra: Json = {}): this {
    if (this.els.some((e) => e.id === `${this.role}.${slot}`)) throw new Error(`${this.role}: slot ${slot} is used twice`);
    const [x, y, w, hh] = f.map((v) => Math.round(v * 100) / 100) as Frame;
    this.els.push({ id: `${this.role}.${slot}`, type, frame: { x, y, w, h: hh, rotation: 0 }, z: this.z++, source: "layout", props, ...extra } as unknown as Element);
    return this;
  }

  bg(assetPlaceholder = false): this {
    this.background = assetPlaceholder ? { fit: "cover" } : {};
    return this;
  }

  text(slot: string, f: Frame, style: TextStyleId, body: TextDoc | string, opts: { align?: "left" | "center" | "right" | "justify"; valign?: "top" | "middle" | "bottom" } = {}): this {
    const d = typeof body === "string" ? textDoc(body) : body;
    return this.push(slot, "text", f, { doc: d, style, align: opts.align ?? "left", ...(opts.valign ? { valign: opts.valign } : {}) });
  }
  kicker(slot: string, f: Frame, s: string, align: "left" | "center" | "right" = "left") {
    return this.text(slot, f, "kicker", s, { align });
  }
  title(slot: string, f: Frame, s: string, align: "left" | "center" | "right" = "left") {
    return this.text(slot, f, "title", s, { align });
  }
  heading(slot: string, f: Frame, s: string, align: "left" | "center" | "right" = "left") {
    return this.text(slot, f, "heading", doc(h(2, s)), { align });
  }
  sub(slot: string, f: Frame, s: string) {
    return this.text(slot, f, "subheading", s);
  }
  body(slot: string, f: Frame, d: TextDoc | string, align: "left" | "justify" = "left") {
    return this.text(slot, f, "body", d, { align });
  }
  caption(slot: string, f: Frame, d: TextDoc | string, align: "left" | "center" | "right" = "left") {
    return this.text(slot, f, "caption", d, { align });
  }
  quote(slot: string, f: Frame, s: string) {
    return this.text(slot, f, "quote", s);
  }

  bigNumber(slot: string, f: Frame, binding: GhgBinding | KpiBinding | InputBinding, label: string, opts: { showDelta?: boolean; format?: string; measure?: string } = {}) {
    return this.push(slot, "big_number", f, { binding, label, showDelta: opts.showDelta ?? false, ...(opts.format ? { format: opts.format } : {}), ...(opts.measure ? { measure: opts.measure } : {}) });
  }
  tile(slot: string, f: Frame, binding: GhgBinding | KpiBinding | InputBinding, label: string, variant: "plain" | "card" | "band" = "card", opts: { showDelta?: boolean; showSparkline?: boolean } = {}) {
    return this.push(slot, "kpi_tile", f, { binding, label, showDelta: opts.showDelta ?? false, showSparkline: opts.showSparkline ?? false, variant });
  }
  chart(slot: string, f: Frame, kind: string, binding: Binding, title?: string, options: Json = {}, caption?: string) {
    return this.push(slot, "chart", f, { binding, kind, ...(title ? { title } : {}), ...(caption ? { caption } : {}), options });
  }
  table(slot: string, f: Frame, props: Json) {
    return this.push(slot, "table", f, { style: "lined", ...props });
  }
  progress(slot: string, f: Frame, binding: GhgBinding | KpiBinding | InputBinding, label: string, variant: "ring" | "bar" = "ring") {
    return this.push(slot, "progress", f, { binding, variant, label });
  }
  callout(slot: string, f: Frame, d: TextDoc | string, opts: { icon?: string; tone?: "primary" | "accent" | "muted" | "good" | "warn" } = {}) {
    return this.push(slot, "callout", f, { doc: typeof d === "string" ? textDoc(d) : d, ...(opts.icon ? { icon: opts.icon } : {}), tone: opts.tone ?? "muted" });
  }
  /** A colour block in the theme's primary (no fill = primary), or with `opacity` a tint. */
  block(slot: string, f: Frame, opts: { shape?: "rect" | "ellipse"; radius?: number; opacity?: number; bleed?: boolean } = {}) {
    return this.push(slot, "shape", f, { shape: opts.shape ?? "rect", ...(opts.radius ? { radius: opts.radius } : {}), ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}), ...(opts.bleed ? { bleed: true } : {}) });
  }
  rule(slot: string, f: Frame, style: "solid" | "dashed" | "dotted" = "solid") {
    return this.push(slot, "divider", f, { style });
  }
  photo(slot: string, f: Frame, alt: string, mask: "rect" | "rounded" | "circle" | "arch" | "blob" = "rect", bleed = false) {
    return this.push(slot, "frame", f, { mask, fit: "cover", alt, ...(bleed ? { bleed: true } : {}) });
  }
  icon(slot: string, f: Frame, name: string) {
    return this.push(slot, "icon", f, { name });
  }
  placeholder(slot: string, f: Frame, accepts: string[], hint: string) {
    return this.push(slot, "placeholder", f, { accepts, hint });
  }
  pageNumber(slot = "pn", align: "left" | "center" | "right" = "right") {
    const w = 30;
    const x = align === "left" ? this.M : align === "center" ? (this.W - w) / 2 : this.W - this.M - w;
    return this.push(slot, "page_number", [x, this.H - this.M + 2, w, 6], { format: "n", align });
  }
  /** Running footer: a hairline and the page number. */
  footer(label?: string) {
    this.rule("footrule", [this.M, this.H - this.M - 1, this.CW, 0.6]);
    if (label) this.caption("footlabel", [this.M, this.H - this.M + 1.5, this.CW - 35, 6], label);
    return this.pageNumber();
  }

  build(): LayoutSeed {
    return {
      role: this.role,
      pageKind: this.pageKind,
      name: this.name,
      page: { id: this.role, kind: "freeform", name: this.name, background: this.background, elements: this.els },
    };
  }
}

export const page = (role: string, pageKind: LayoutKind, name: string, format: PageFormat) => new PageBuilder(role, pageKind, name, format);

/** Evenly spaced columns inside [x, x + w]: returns each column's [x, w]. */
export const columns = (x: number, w: number, n: number, gap: number): [number, number][] => {
  const cw = (w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => [x + i * (cw + gap), cw]);
};

// ---------------------------------------------------------------------------
// Template files
// ---------------------------------------------------------------------------

/** A page of a template: a layout by role (with optional text for its text slots), or a flow section. */
export type TemplatePageSeed =
  | { layout: string; name?: string; text?: Record<string, string> }
  | { flow: { name: string; flowType: string; options?: Json; bookmark?: string } };

export interface TemplateSeed {
  family: string;
  version: number;
  kind: "ghg" | "sustainability";
  purpose: "report" | "summary" | "deck" | "social";
  format: PageFormat;
  name: string;
  description: string;
  tags: string[];
  looks: ("classic" | "light" | "night")[];
  meta: { title: string; subtitle?: string; frameworks: string[] };
  pages: TemplatePageSeed[];
}

export interface FamilySeed {
  template: TemplateSeed;
  layouts: LayoutSeed[];
}
