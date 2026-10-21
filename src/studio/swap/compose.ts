/**
 * AT-2 · pure page composition (no DB, no model): a page's own elements put
 * into the slots of a library layout ("Suggest layouts") or of another
 * template's layout for the same role ("Try another template").
 *
 * The rules (contracts/pro.ts LayoutOptionMeta):
 *   - content (text, chips, charts, tables, tiles, pictures, icons) keeps its
 *     id, type and props; only `frame` and `z` may change. Content with no slot
 *     stays at its old frame (never dropped);
 *   - locked and template-locked elements don't move;
 *   - the only new elements are the layout's decoration blocks (shapes,
 *     dividers, lines, page numbers). Decoration that came from the page's old
 *     layout (`<pageId>.<slot>` ids) is replaced by the new layout's;
 *   - the layout's own content slots (its sample text, sample charts, empty
 *     picture frames) are never copied: nothing is invented, no figure typed.
 *
 *   contentClass(e) / isDecor(e)                  what a slot or element holds
 *   layoutSlots(layout)                            the layout's slots in reading order
 *   rankLayouts(page, layouts, opts)               candidates for a page, best first
 *   autoAssign(page, layout, given)                slot → element id (given pairs first, then by class)
 *   composePage(doc, page, layout, assignment)     the option page + placed ids + unplaced
 *   layoutOptionIssues(doc, original, option)      the invariants + ElementSchema + DS-12 layout checks
 *   swapTemplate(doc, target)                      the whole doc restyled with another template
 */
import crypto from "crypto";
import {
  ElementSchema,
  FreeformPageSchema,
  ReportDocSchema,
  type Element,
  type FreeformPage,
  type ReportDoc,
  type ReportLayout,
  type SwapPageMapping,
  type SwapUnplaced,
  type ThemeOverrides,
} from "../contracts";
import { layoutChecks } from "../checks/layout";
import { stableStringify } from "../sources/hash";

export type ContentClass = "heading" | "text" | "callout" | "chart" | "table" | "figure" | "picture" | "badge" | "placeholder";

const DECOR_TYPES = new Set<Element["type"]>(["shape", "divider", "line", "page_number"]);
const HEADING_STYLES = new Set(["kicker", "title", "heading", "subheading"]);

export const isDecor = (e: Pick<Element, "type">): boolean => DECOR_TYPES.has(e.type);

export function contentClass(e: Element): ContentClass | null {
  switch (e.type) {
    case "text":
      return HEADING_STYLES.has(e.props.style) ? "heading" : "text";
    case "callout":
      return "callout";
    case "chart":
      return "chart";
    case "table":
      return "table";
    case "kpi_tile":
    case "big_number":
    case "progress":
      return "figure";
    case "image":
    case "frame":
    case "grid":
      return "picture";
    case "icon":
    case "sdg":
    case "qr":
      return "badge";
    case "placeholder":
      return "placeholder";
    default:
      return null;
  }
}

/** Which element classes a slot of class `slot` accepts, best first. */
const ACCEPTS: Record<ContentClass, ContentClass[]> = {
  heading: ["heading", "text"],
  text: ["text", "callout", "heading"],
  callout: ["callout", "text"],
  chart: ["chart"],
  table: ["table"],
  figure: ["figure"],
  picture: ["picture"],
  badge: ["badge"],
  placeholder: [],
};
export const fits = (slot: ContentClass, el: ContentClass): boolean => ACCEPTS[slot].includes(el);

const readingOrder = <T extends { frame: { x: number; y: number } }>(a: T, b: T) => a.frame.y - b.frame.y || a.frame.x - b.frame.x;
const locked = (e: Element) => e.locked === true || e.templateLocked === true;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The part of an element id after its page prefix (`p07-scope1.total` → `total`). */
export const slotOf = (id: string, prefix: string): string => (id.startsWith(`${prefix}.`) ? id.slice(prefix.length + 1) : id);

export interface Slot {
  slot: string;
  cls: ContentClass;
  element: Element;
}

/** The layout's content slots in reading order (decoration and placeholders left out). */
export function layoutSlots(layout: Pick<ReportLayout, "page">): Slot[] {
  const prefix = layout.page.id;
  return layout.page.elements
    .filter((e) => !isDecor(e) && contentClass(e) && contentClass(e) !== "placeholder")
    .sort(readingOrder)
    .map((e) => ({ slot: slotOf(e.id, prefix), cls: contentClass(e) as ContentClass, element: e }));
}

/** The page's elements a layout can move: content, not locked, not hidden; in reading order. */
export function movable(page: FreeformPage): Array<{ element: Element; cls: ContentClass }> {
  return page.elements
    .filter((e) => !locked(e) && !e.hidden && !isDecor(e))
    .map((e) => ({ element: e, cls: contentClass(e) }))
    .filter((x): x is { element: Element; cls: ContentClass } => !!x.cls && x.cls !== "placeholder")
    .sort((a, b) => readingOrder(a.element, b.element));
}

/** The page's role from its layout id (`ghg-inventory/scope1`) or its template page id (`p07-scope1`). */
export function roleOf(page: Pick<FreeformPage, "id" | "layoutId">): string | null {
  if (page.layoutId && page.layoutId.includes("/")) return page.layoutId.split("/").pop() || null;
  const m = /^p\d+-(.+)$/.exec(page.id);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export type Assignment = Map<string, string>;

export interface GivenPair {
  slot: string;
  elementId: string;
}

/**
 * Checks the model's pairs against the layout and the page. Returns the
 * issues (for the retry) and the pairs that are fine.
 */
export function checkPairs(page: FreeformPage, layout: Pick<ReportLayout, "page" | "slug">, pairs: GivenPair[]): { ok: GivenPair[]; issues: string[] } {
  const slots = new Map(layoutSlots(layout).map((s) => [s.slot, s]));
  const els = new Map(movable(page).map((m) => [m.element.id, m]));
  const usedSlots = new Set<string>();
  const usedEls = new Set<string>();
  const ok: GivenPair[] = [];
  const issues: string[] = [];
  for (const p of pairs) {
    const s = slots.get(p.slot);
    const e = els.get(p.elementId);
    if (!s) issues.push(`${layout.slug} has no slot "${p.slot}"`);
    else if (!e) issues.push(`"${p.elementId}" isn't a movable element of this page`);
    else if (!fits(s.cls, e.cls)) issues.push(`slot "${p.slot}" of ${layout.slug} holds a ${s.cls}, not the ${e.cls} "${p.elementId}"`);
    else if (!roomFor(s.element.frame, e.element.frame)) issues.push(`slot "${p.slot}" of ${layout.slug} is too small for "${p.elementId}"`);
    else if (usedSlots.has(p.slot)) issues.push(`slot "${p.slot}" of ${layout.slug} is used twice`);
    else if (usedEls.has(p.elementId)) issues.push(`"${p.elementId}" is placed twice in ${layout.slug}`);
    else {
      usedSlots.add(p.slot);
      usedEls.add(p.elementId);
      ok.push(p);
    }
  }
  return { ok, issues };
}

/** How far a slot's size is from an element's (0 = same area and shape). */
const sizeMismatch = (a: { w: number; h: number }, b: { w: number; h: number }): number =>
  Math.abs(Math.log((a.w * a.h) / (b.w * b.h))) + Math.abs(Math.log(a.w / a.h / (b.w / b.h))) / 2;

/** A slot far smaller than the element (a footer line for a paragraph) isn't a place for it. */
export const roomFor = (slot: { w: number; h: number }, e: { w: number; h: number }): boolean =>
  !(slot.h < 0.4 * e.h && slot.h < 12) && !(slot.w < 0.4 * e.w && slot.w < 12) && (e.w * e.h) / (slot.w * slot.h) <= 6;

const textStyle = (e: Element): string | null => (e.type === "text" ? e.props.style : null);

/**
 * Slot → element id: the given pairs, then each remaining element (reading
 * order) into a free slot: the slot of the same name (same template family),
 * else one of the same class and text style, else the same class, else a class
 * it fits; within a tier the slot closest in size wins. Deterministic.
 */
export function autoAssign(page: FreeformPage, layout: Pick<ReportLayout, "page">, given: GivenPair[] = []): Assignment {
  const out: Assignment = new Map();
  const slots = layoutSlots(layout);
  const taken = new Set<string>();
  for (const p of given) {
    out.set(p.slot, p.elementId);
    taken.add(p.elementId);
  }
  const best = (pred: (s: Slot) => boolean, e: Element): Slot | undefined => {
    let pick: Slot | undefined;
    let score = Infinity;
    for (const s of slots) {
      if (out.has(s.slot) || !pred(s) || !roomFor(s.element.frame, e.frame)) continue;
      const m = sizeMismatch(s.element.frame, e.frame);
      if (m < score - 1e-9) {
        pick = s;
        score = m;
      }
    }
    return pick;
  };
  for (const { element, cls } of movable(page)) {
    if (taken.has(element.id)) continue;
    const own = slotOf(element.id, page.id);
    const style = textStyle(element);
    const s =
      best((x) => x.slot === own && fits(x.cls, cls), element) ??
      (style ? best((x) => x.cls === cls && textStyle(x.element) === style, element) : undefined) ??
      best((x) => x.cls === cls, element) ??
      best((x) => fits(x.cls, cls), element);
    if (s) {
      out.set(s.slot, element.id);
      taken.add(element.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ranking candidates
// ---------------------------------------------------------------------------

export interface RankedLayout {
  layout: ReportLayout;
  score: number;
  /** Movable elements that get a slot. */
  placed: number;
  /** Movable elements that keep their old frame. */
  leftOver: number;
}

/** What a layout looks like (element types and frames): families that share a page design count once. */
export const layoutShape = (layout: Pick<ReportLayout, "page">): string => stableStringify(layout.page.elements.map((e) => [e.type, e.frame]));

/**
 * Layouts for a page, best fit first. The page's own layout and `exclude`
 * slugs are left out, and so is a layout that looks the same as one already
 * listed (or as the page's own layout).
 */
export function rankLayouts(page: FreeformPage, layouts: ReportLayout[], opts: { exclude?: string[] } = {}): RankedLayout[] {
  const exclude = new Set([...(opts.exclude ?? []), ...(page.layoutId ? [page.layoutId] : [])]);
  const items = movable(page);
  const role = roleOf(page);
  const ranked: RankedLayout[] = [];
  const shapes = new Set(layouts.filter((l) => l.slug === page.layoutId).map(layoutShape));
  const ordered = [...layouts].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug));
  for (const layout of ordered) {
    if (exclude.has(layout.slug)) continue;
    const shape = layoutShape(layout);
    if (shapes.has(shape)) continue;
    shapes.add(shape);
    const slots = layoutSlots(layout);
    if (!slots.length && items.length) continue;
    const assigned = autoAssign(page, layout);
    const placed = assigned.size;
    const leftOver = items.length - placed;
    const emptySlots = slots.length - placed;
    // Covers and back covers only for pages of that kind.
    const coverish = layout.pageKind === "cover" || layout.pageKind === "back_cover";
    const pageIsCover = role === "cover" || role === "back_cover" || /cover/i.test(page.name);
    if (coverish !== pageIsCover) continue;
    const score = placed * 3 - leftOver * 4 - emptySlots + (role && layout.role === role ? 2 : 0);
    ranked.push({ layout, score, placed, leftOver });
  }
  return ranked.sort((a, b) => b.score - a.score || a.layout.sort - b.layout.sort || a.layout.slug.localeCompare(b.layout.slug));
}

// ---------------------------------------------------------------------------
// Composing a page
// ---------------------------------------------------------------------------

export function docElementIds(doc: ReportDoc, exceptPageId?: string): Set<string> {
  const ids = new Set<string>();
  for (const p of doc.pages) if (p.kind === "freeform" && p.id !== exceptPageId) for (const e of p.elements) ids.add(e.id);
  return ids;
}

const uniqueId = (want: string, taken: Set<string>): string => {
  let id = want;
  for (let n = 2; taken.has(id); n++) id = `${want}-${n}`;
  taken.add(id);
  return id;
};

export interface Composed {
  page: FreeformPage;
  /** Original element ids in the option (all of them, except replaced decoration). */
  placedElementIds: string[];
  /** Movable content that kept its old frame (no slot), and locked elements. */
  unplaced: Array<{ elementId: string; reason: "no_slot" | "locked" }>;
}

export interface ComposeOpts {
  /** Template swap: a text placed in the slot of the same name takes the slot's style and alignment. */
  restyleText?: boolean;
  /** Template swap: the page takes the layout's background when it has one. */
  background?: boolean;
}

/** One page rebuilt on `layout` with `assignment` (slot → element id). Pure; the input is unchanged. */
export function composePage(doc: ReportDoc, page: FreeformPage, layout: ReportLayout, assignment: Assignment, opts: ComposeOpts = {}): Composed {
  const slots = new Map(layoutSlots(layout).map((s) => [s.slot, s]));
  const slotFor = new Map<string, Slot>();
  for (const [slot, id] of assignment) {
    const s = slots.get(slot);
    if (s) slotFor.set(id, s);
  }
  const taken = docElementIds(doc, page.id);
  const elements: Element[] = [];
  const placedElementIds: string[] = [];
  const unplaced: Composed["unplaced"] = [];
  const movableIds = new Set(movable(page).map((m) => m.element.id));
  for (const e of page.elements) {
    if (locked(e)) {
      elements.push(clone(e));
      placedElementIds.push(e.id);
      taken.add(e.id);
      if (contentClass(e)) unplaced.push({ elementId: e.id, reason: "locked" });
      continue;
    }
    // Decoration from the page's old layout gives way to the new layout's.
    if (isDecor(e) && e.id.startsWith(`${page.id}.`)) continue;
    const s = slotFor.get(e.id);
    const next = clone(e);
    if (s) {
      next.frame = { ...s.element.frame };
      next.z = s.element.z;
      if (opts.restyleText && next.type === "text" && s.element.type === "text" && s.slot === slotOf(e.id, page.id)) {
        next.props = { ...next.props, style: s.element.props.style, align: s.element.props.align };
      }
    } else if (movableIds.has(e.id)) {
      unplaced.push({ elementId: e.id, reason: "no_slot" });
    }
    elements.push(next);
    placedElementIds.push(e.id);
    taken.add(e.id);
  }
  for (const d of layout.page.elements.filter(isDecor)) {
    const id = uniqueId(`${page.id}.${slotOf(d.id, layout.page.id)}`, taken);
    elements.push({ ...clone(d), id });
  }
  const background = opts.background && Object.keys(layout.page.background ?? {}).length ? clone(layout.page.background) : clone(page.background);
  return { page: { ...clone(page), layoutId: layout.slug, background, elements }, placedElementIds, unplaced };
}

// ---------------------------------------------------------------------------
// Checking an option
// ---------------------------------------------------------------------------

/** Everything but frame and z, for "props unchanged". */
const essence = (e: Element) => {
  const { frame: _f, z: _z, ...rest } = e;
  return stableStringify(rest);
};

/**
 * The option keeps every content element exactly (only frame/z move), adds
 * only decoration, re-validates with ElementSchema and the doc schema, and
 * brings no new DS-12 layout finding (safe area, overlapping a locked element).
 */
export function layoutOptionIssues(doc: ReportDoc, original: FreeformPage, option: FreeformPage, opts: { allowRestyle?: boolean } = {}): string[] {
  const issues: string[] = [];
  const now = new Map(option.elements.map((e) => [e.id, e]));
  for (const e of original.elements) {
    const n = now.get(e.id);
    if (isDecor(e) && e.id.startsWith(`${original.id}.`) && !locked(e)) {
      // Old-layout decoration may give way; its id may be reused by the new layout's.
      if (n && !isDecor(n)) issues.push(`${e.id} became content`);
      continue;
    }
    if (!n) {
      issues.push(`${e.id} is missing`);
      continue;
    }
    if (n.type !== e.type) issues.push(`${e.id} changed type`);
    else if (locked(e) && stableStringify(n) !== stableStringify(e)) issues.push(`${e.id} is locked and moved`);
    else if (essence(n) !== essence(e)) {
      const restyled = opts.allowRestyle && n.type === "text" && e.type === "text" && essence({ ...n, props: { ...n.props, style: e.props.style, align: e.props.align } } as Element) === essence(e);
      if (!restyled) issues.push(`${e.id} changed more than its position`);
    }
  }
  const before = new Set(original.elements.map((e) => e.id));
  for (const e of option.elements) {
    if (!before.has(e.id) && !isDecor(e)) issues.push(`${e.id} is new and isn't a layout block`);
    const r = ElementSchema.safeParse(e);
    if (!r.success) issues.push(`${e.id}: ${r.error.issues[0]?.message ?? "invalid"}`);
  }
  const page = FreeformPageSchema.safeParse(option);
  if (!page.success) issues.push(`page: ${page.error.issues[0]?.message ?? "invalid"}`);
  const withOption: ReportDoc = { ...doc, pages: doc.pages.map((p) => (p.id === original.id ? option : p)) };
  const full = ReportDocSchema.safeParse(withOption);
  if (!full.success) issues.push(...full.error.issues.slice(0, 4).map((i) => i.message));
  const key = (c: { id: string; elementId?: string }) => `${c.id}:${c.elementId ?? ""}`;
  const was = new Set(layoutChecks({ ...doc, pages: [original] }, null).map(key));
  for (const c of layoutChecks({ ...doc, pages: [option] }, null)) {
    if (c.severity === "error" || c.id === "OVERLAPS_LOCKED") if (!was.has(key(c))) issues.push(`${c.id} on ${c.elementId ?? "the page"}`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Template swap
// ---------------------------------------------------------------------------

export interface SwapTarget {
  slug: string;
  version: number;
  /** The template doc's theme (look …); the doc's own brand colours and fonts stay unless it sets them. */
  theme: ThemeOverrides;
  /** The template family's layouts in the doc's format. */
  layouts: ReportLayout[];
}

export interface SwapResult {
  doc: ReportDoc;
  pages: SwapPageMapping[];
  unplaced: SwapUnplaced[];
}

/** The doc restyled with another template: each page on the layout of the same role, every element kept. */
export function swapTemplate(doc: ReportDoc, target: SwapTarget): SwapResult {
  const byRole = new Map<string, ReportLayout>();
  for (const l of target.layouts) if (!byRole.has(l.role)) byRole.set(l.role, l);
  const pages: SwapPageMapping[] = [];
  const unplaced: SwapUnplaced[] = [];
  let working: ReportDoc = clone(doc);
  for (const page of doc.pages) {
    if (page.kind !== "freeform") {
      pages.push({ pageId: page.id, fromLayoutId: null, toLayoutId: null, status: "kept" });
      continue;
    }
    const role = roleOf(page);
    const layout = role ? byRole.get(role) : undefined;
    if (!layout) {
      pages.push({ pageId: page.id, fromLayoutId: page.layoutId ?? null, toLayoutId: null, status: "kept" });
      continue;
    }
    const composed = composePage(working, page, layout, autoAssign(page, layout), { restyleText: true, background: true });
    working = { ...working, pages: working.pages.map((p) => (p.id === page.id ? composed.page : p)) };
    pages.push({ pageId: page.id, fromLayoutId: page.layoutId ?? null, toLayoutId: layout.slug, status: "mapped" });
    for (const u of composed.unplaced) unplaced.push({ pageId: page.id, ...u });
  }
  working.design = { ...working.design, templateId: target.slug, templateVersion: target.version, theme: { ...working.design.theme, ...clone(target.theme) } };
  return { doc: working, pages, unplaced };
}

export const docHash = (doc: unknown): string => crypto.createHash("sha256").update(stableStringify(doc)).digest("hex");
