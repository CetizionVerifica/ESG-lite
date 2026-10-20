/**
 * DS-10 · Resize and convert: the pure mapping engine.
 *
 * MIRRORED BYTE FOR BYTE to ESG-lite_FE src/lib/studio/resize.ts (the Resize
 * dialog previews the first pages with it). Edit it here, then run
 * `npm run sync:studio-resize` in ESG-lite_FE; both repos check the file's
 * sha256 against RESIZE_HASH (ESG-lite src/studio/resize/hash.ts, FE
 * src/lib/studio/resizeHash.ts). It imports nothing: no Node, no DOM, no app
 * code, no Date.now() or randomness. Docs come in and go out as plain JSON.
 *
 *   resizeTargetFor(purpose, format)  the profile a request maps to (deck, summary, social, booklet) or null
 *   resizeChapters(doc)               the "Pages to include" picker: chapters of the source and their page ids
 *   resizeDocument(doc, request)      the copy and its report (pages made, elements dropped, text cut)
 *   truncateTextDoc(doc, maxChars)    a TipTap doc cut at a word boundary with an ellipsis; chips stay whole
 *
 * Profiles:
 *   deck     (slide_16_9, a4_landscape)  one slide per included page, by the page's layout role
 *                                        (cover → title, exec_summary → highlights, scope3 → chart, …);
 *                                        flow sections become one "See the full report" slide
 *   summary  (a4, letter, a5)            one page filled from every included page, highlights first
 *   social   (square, social_191)        one card: the headline, one hero number, one chart
 *   booklet  (report: a5, a4, letter)    every page scaled to the new size (same aspect only)
 *
 * Bound elements (a binding or a data chip) move to slots by role
 * (hero_number, chart, table, body, …) with their bindings unchanged, so
 * the copy resolves the same numbers live. Bound elements with no slot are
 * dropped and listed. Text longer than its slot is cut with an ellipsis and
 * listed (`truncated`, TEXT_TRUNCATED); the server may replace it with an
 * AI summary marked unreviewed (DS-9).
 */

type Json = Record<string, any>;

export const RESIZE_ENGINE_VERSION = 1;

export type ResizeProfile = "deck" | "summary" | "social" | "booklet";

/** The five targets of the Resize dialog (05-ux S6), in its order. */
export interface ResizeTarget {
  id: "deck" | "summary" | "social_square" | "social_wide" | "booklet";
  label: string;
  purpose: "deck" | "summary" | "social" | "report";
  format: "slide_16_9" | "a4" | "square" | "social_191" | "a5";
  profile: ResizeProfile;
}

export const RESIZE_TARGETS: ResizeTarget[] = [
  { id: "deck", label: "Board deck 16:9", purpose: "deck", format: "slide_16_9", profile: "deck" },
  { id: "summary", label: "One-page summary A4", purpose: "summary", format: "a4", profile: "summary" },
  { id: "social_square", label: "Social card 1:1", purpose: "social", format: "square", profile: "social" },
  { id: "social_wide", label: "Social card 1.91:1", purpose: "social", format: "social_191", profile: "social" },
  { id: "booklet", label: "Booklet A5", purpose: "report", format: "a5", profile: "booklet" },
];

/** Formats each purpose can be resized to. Anything else is DS_FORMAT_INVALID. */
export const RESIZE_FORMATS: Record<string, string[]> = {
  deck: ["slide_16_9", "a4_landscape"],
  summary: ["a4", "letter", "a5"],
  social: ["square", "social_191"],
  report: ["a5", "a4", "letter"],
};

const PROFILE_BY_PURPOSE: Record<string, ResizeProfile> = { deck: "deck", summary: "summary", social: "social", report: "booklet" };

export function resizeTargetFor(purpose: string, format: string): ResizeProfile | null {
  const formats = RESIZE_FORMATS[purpose];
  return formats && formats.includes(format) ? PROFILE_BY_PURPOSE[purpose] : null;
}

// ---------------------------------------------------------------------------
// Roles: source pages (by layout role) and elements (by type and style)
// ---------------------------------------------------------------------------

/** A target page layout of a profile. */
export type TargetLayoutId = "title" | "highlights" | "chart" | "table" | "text" | "section" | "full_report" | "close" | "one_page" | "social_square" | "social_wide";

/** Element roles that slots accept. `decor` never moves. */
export type ElementRole = "kicker" | "title" | "heading" | "subtitle" | "body" | "caption" | "callout" | "hero_number" | "fact" | "chart" | "table" | "image" | "decor";

/** What a source page is, from its layout role (`layoutId` = `<family>/<role>`), else from its content. */
interface RoleRule {
  /** Target layout in a deck; null = leave the page out of a deck unless it is picked. */
  deck: TargetLayoutId | null;
  /** The deck layout when the page is picked although `deck` is null. */
  picked?: TargetLayoutId;
  chapter: string;
  /** A highlights page: fills the summary and the social card first. */
  highlights?: boolean;
  /** Never in a copy (a contents page). */
  skip?: boolean;
}

const R = (deck: TargetLayoutId | null, chapter: string, extra: Partial<RoleRule> = {}): RoleRule => ({ deck, chapter, ...extra });

/** GHG roles (DS-4 GHG families) and sustainability roles (DS-4 designs). */
const ROLE_RULES: Record<string, Record<string, RoleRule>> = {
  ghg: {
    cover: R("title", "summary"),
    compliance: R(null, "methodology", { picked: "text" }),
    conformance: R(null, "methodology", { picked: "text" }),
    exec_summary: R("highlights", "summary", { highlights: true }),
    headline: R("highlights", "summary", { highlights: true }),
    summary: R("highlights", "summary", { highlights: true }),
    boundary: R(null, "methodology", { picked: "text" }),
    period: R(null, "methodology", { picked: "chart" }),
    methodology: R(null, "methodology", { picked: "chart" }),
    scope1: R("chart", "scope12"),
    scope2: R("chart", "scope12"),
    scopes: R("chart", "scope12"),
    scope3: R("chart", "scope3"),
    iso_categories: R(null, "scope3", { picked: "chart" }),
    sites: R("chart", "scope12"),
    biogenic: R(null, "methodology", { picked: "chart" }),
    intensity: R(null, "trend", { picked: "highlights" }),
    trend: R("chart", "trend"),
    data_quality: R(null, "methodology", { picked: "highlights" }),
    uncertainty: R(null, "methodology", { picked: "text" }),
    initiatives: R("text", "trend"),
    next_steps: R("text", "trend"),
    assurance: R(null, "methodology", { picked: "text" }),
    verification: R(null, "methodology", { picked: "text" }),
    annex: R(null, "annexes", { picked: "section" }),
    back_cover: R("close", "always"),
    close: R("close", "always"),
  },
  sustainability: {
    cover: R("title", "summary"),
    contents: R(null, "summary", { skip: true }),
    leadership: R(null, "summary", { picked: "text" }),
    about: R(null, "summary", { picked: "text" }),
    highlights: R("highlights", "summary", { highlights: true }),
    materiality: R(null, "summary", { picked: "text" }),
    chapter: R(null, "annexes", { picked: "section" }),
    climate: R("chart", "environment"),
    energy_water: R("chart", "environment"),
    waste: R(null, "environment", { picked: "chart" }),
    targets: R("chart", "environment"),
    people: R("highlights", "social"),
    safety: R("highlights", "social"),
    quote: R(null, "social", { picked: "text" }),
    governance: R("highlights", "governance"),
    back_cover: R("close", "always"),
  },
};

/** Chapters of the "Pages to include" picker, per kind, in order. */
const CHAPTERS: Record<string, Array<{ id: string; label: string }>> = {
  ghg: [
    { id: "summary", label: "Summary" },
    { id: "scope12", label: "Scope 1 and 2" },
    { id: "scope3", label: "Scope 3" },
    { id: "trend", label: "Trend" },
    { id: "methodology", label: "Methodology" },
    { id: "annexes", label: "Annexes" },
  ],
  sustainability: [
    { id: "summary", label: "Summary" },
    { id: "environment", label: "Environment" },
    { id: "social", label: "Social" },
    { id: "governance", label: "Governance" },
    { id: "annexes", label: "Annexes" },
  ],
};

/** Flow sections by type: the chapter they belong to (when the kind has it), or a contents list nobody needs in a copy. */
const FLOW_CHAPTERS: Record<string, string> = { scope3_categories: "scope3", ghg_factor_table: "methodology", methodology: "methodology" };
const SKIPPED_FLOWS = new Set(["toc"]);

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The role part of a page's `layoutId` (`ghg-inventory/scope3` → `scope3`). */
export const pageRole = (page: Json): string | null => {
  const id = typeof page.layoutId === "string" ? page.layoutId : "";
  if (!id) return null;
  const i = id.lastIndexOf("/");
  return i >= 0 ? id.slice(i + 1) : id;
};

const hasChip = (n: unknown): boolean => {
  if (!isObj(n)) return false;
  if (n.type === "data") return true;
  return Array.isArray(n.content) && n.content.some(hasChip);
};

/** True when an element carries a number: a binding or a data chip. */
export const isBound = (e: Json): boolean => isObj(e.props) && (isObj(e.props.binding) || hasChip(e.props.doc));

const TEXT_TYPES = new Set(["text", "callout"]);

/** An element's role for slot matching. `pageH` lets footer text count as decor. */
export function elementRole(e: Json, pageH: number): ElementRole {
  const p: Json = isObj(e.props) ? e.props : {};
  const slot = typeof e.id === "string" && e.id.includes(".") ? e.id.slice(e.id.lastIndexOf(".") + 1) : "";
  switch (e.type) {
    case "big_number":
    case "progress":
      return "hero_number";
    case "kpi_tile":
      return isObj(p.binding) && p.binding.source === "input" ? "fact" : "hero_number";
    case "chart":
      return "chart";
    case "table":
      return "table";
    case "callout":
      return "callout";
    case "image":
      return p.assetId ? "image" : "decor";
    case "frame":
      return p.assetId ? "image" : "decor";
    case "text": {
      const footer = slot.startsWith("foot") || (isObj(e.frame) && e.frame.y > pageH * 0.93);
      if (footer && !hasChip(p.doc)) return "decor";
      switch (p.style) {
        case "kicker":
          return "kicker";
        case "title":
          return "title";
        case "heading":
          return "heading";
        case "subheading":
          return "subtitle";
        case "caption":
        case "footnote":
          return "caption";
        default:
          return "body";
      }
    }
    default:
      return "decor";
  }
}

// ---------------------------------------------------------------------------
// Target layouts: slots in mm on a reference size, scaled to the target format
// ---------------------------------------------------------------------------

type Box = [number, number, number, number];

interface Slot {
  name: string;
  box: Box;
  accepts: ElementRole[];
  /** Text style the moved text takes (text elements only). */
  style?: string;
  align?: "left" | "center" | "right";
  /** Longest text the slot holds, in characters (a chip counts as CHIP_CHARS). */
  maxChars?: number;
  /** What to write when no element fits. */
  fallback?: "pageName" | "docTitle" | "subtitle";
  /** A big number placed here becomes a KPI tile card (a big number's type size doesn't shrink with its frame). */
  tile?: boolean;
}

interface TargetLayout {
  ref: [number, number];
  slots: Slot[];
  /** Plain shapes in the theme's primary colour. */
  bands?: Box[];
}

const DECK: [number, number] = [338.7, 190.5];
const A4: [number, number] = [210, 297];
const SQUARE: [number, number] = [285.75, 285.75];
const WIDE: [number, number] = [317.5, 166.1];

const kicker = (box: Box): Slot => ({ name: "kicker", box, accepts: ["kicker"], style: "kicker", maxChars: 60 });
const heading = (box: Box, maxChars = 80): Slot => ({ name: "heading", box, accepts: ["heading", "title"], style: "heading", maxChars, fallback: "pageName" });
const hero = (n: number, box: Box, tile = true): Slot => ({ name: `hero${n}`, box, accepts: ["hero_number"], tile });
const chart = (name: string, box: Box): Slot => ({ name, box, accepts: ["chart"] });
const body = (box: Box, maxChars: number, accepts: ElementRole[] = ["body", "callout"]): Slot => ({ name: "body", box, accepts, style: "body", maxChars });

export const TARGET_LAYOUTS: Record<TargetLayoutId, TargetLayout> = {
  title: {
    ref: DECK,
    bands: [[20, 60, 40, 3]],
    slots: [
      kicker([20, 68, 170, 8]),
      { name: "title", box: [20, 78, 170, 44], accepts: ["title", "heading"], style: "title", maxChars: 90, fallback: "docTitle" },
      { name: "subtitle", box: [20, 126, 170, 12], accepts: ["subtitle", "body"], style: "subheading", maxChars: 120, fallback: "subtitle" },
      hero(1, [20, 144, 170, 30], false),
      { name: "image", box: [200, 20, 118.7, 150.5], accepts: ["image"] },
    ],
  },
  highlights: {
    ref: DECK,
    slots: [
      kicker([20, 20, 298.7, 8]),
      heading([20, 30, 298.7, 18]),
      hero(1, [20, 54, 92, 42]),
      hero(2, [118, 54, 92, 42]),
      hero(3, [20, 100, 92, 42]),
      hero(4, [118, 100, 92, 42]),
      chart("chart", [218, 54, 100.7, 88]),
      body([20, 148, 298.7, 22], 220),
    ],
  },
  chart: {
    ref: DECK,
    slots: [
      kicker([20, 20, 298.7, 8]),
      heading([20, 30, 298.7, 18]),
      chart("chart", [20, 52, 190, 118]),
      hero(1, [220, 52, 98.7, 36]),
      hero(2, [220, 92, 98.7, 36]),
      body([220, 132, 98.7, 38], 160),
    ],
  },
  table: {
    ref: DECK,
    slots: [kicker([20, 20, 298.7, 8]), heading([20, 30, 298.7, 18]), { name: "table", box: [20, 52, 298.7, 118], accepts: ["table"] }],
  },
  text: {
    ref: DECK,
    slots: [
      kicker([20, 20, 298.7, 8]),
      heading([20, 30, 298.7, 18]),
      body([20, 52, 180, 118], 600, ["body"]),
      { name: "side1", box: [212, 52, 106.7, 36], accepts: ["callout", "fact", "hero_number", "image"], maxChars: 160, tile: true },
      { name: "side2", box: [212, 93, 106.7, 36], accepts: ["callout", "fact", "hero_number", "image"], maxChars: 160, tile: true },
      { name: "side3", box: [212, 134, 106.7, 36], accepts: ["callout", "fact", "hero_number", "image"], maxChars: 160, tile: true },
    ],
  },
  section: {
    ref: DECK,
    bands: [[20, 76, 40, 3]],
    slots: [kicker([20, 84, 298.7, 8]), { name: "title", box: [20, 94, 298.7, 30], accepts: ["title", "heading"], style: "title", maxChars: 80, fallback: "pageName" }],
  },
  full_report: {
    ref: DECK,
    bands: [[20, 60, 40, 3]],
    slots: [
      { name: "title", box: [20, 68, 298.7, 24], accepts: [], style: "title" },
      { name: "body", box: [20, 98, 298.7, 50], accepts: [], style: "body" },
    ],
  },
  close: {
    ref: DECK,
    bands: [[0, 0, 338.7, 6]],
    slots: [
      { name: "title", box: [20, 70, 298.7, 30], accepts: ["title", "heading"], style: "title", maxChars: 90, fallback: "docTitle" },
      { name: "caption", box: [20, 108, 298.7, 10], accepts: ["caption", "body"], style: "caption", maxChars: 160 },
    ],
  },
  one_page: {
    ref: A4,
    bands: [[0, 0, 210, 8]],
    slots: [
      kicker([16, 16, 178, 6]),
      { name: "title", box: [16, 24, 178, 20], accepts: [], style: "heading", maxChars: 90, fallback: "docTitle" },
      hero(1, [16, 50, 41.5, 32]),
      hero(2, [61.5, 50, 41.5, 32]),
      hero(3, [107, 50, 41.5, 32]),
      hero(4, [152.5, 50, 41.5, 32]),
      chart("chart1", [16, 88, 87, 72]),
      chart("chart2", [107, 88, 87, 72]),
      chart("chart3", [16, 166, 178, 60]),
      body([16, 232, 178, 44], 450),
      { name: "caption", box: [16, 280, 178, 8], accepts: ["caption"], style: "caption", maxChars: 140 },
    ],
  },
  social_square: {
    ref: SQUARE,
    bands: [[0, 0, 285.75, 8]],
    slots: [
      kicker([24, 26, 237.75, 10]),
      { name: "title", box: [24, 38, 237.75, 40], accepts: [], style: "heading", maxChars: 70, fallback: "docTitle" },
      hero(1, [24, 86, 237.75, 66], false),
      chart("chart", [24, 160, 237.75, 100]),
    ],
  },
  social_wide: {
    ref: WIDE,
    bands: [[0, 0, 317.5, 6]],
    slots: [
      kicker([20, 18, 140, 8]),
      { name: "title", box: [20, 28, 140, 40], accepts: [], style: "heading", maxChars: 70, fallback: "docTitle" },
      hero(1, [20, 76, 140, 62], false),
      chart("chart", [172, 18, 125.5, 128]),
    ],
  },
};

// ---------------------------------------------------------------------------
// Text: plain length, truncation, synthesised text
// ---------------------------------------------------------------------------

/** A data chip counts as this many characters when text is measured. */
export const CHIP_CHARS = 8;
const ELLIPSIS = "…";

/** Characters of a TipTap doc (chips count CHIP_CHARS). */
export function textLength(doc: unknown): number {
  if (!isObj(doc)) return 0;
  if (doc.type === "text") return typeof doc.text === "string" ? doc.text.length : 0;
  if (doc.type === "data") return CHIP_CHARS;
  return Array.isArray(doc.content) ? doc.content.reduce((n: number, c: unknown) => n + textLength(c), 0) : 0;
}

/** Plain text of a TipTap doc (chips as "[number]"), for AI prompts and lists. */
export function plainText(doc: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!isObj(n)) return;
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    else if (n.type === "data") out.push("[number]");
    else if (Array.isArray(n.content)) {
      n.content.forEach(walk);
      if (n.type === "paragraph" || n.type === "heading") out.push(" ");
    }
  };
  walk(doc);
  return out.join("").replace(/\s+/g, " ").trim();
}

/** Lists flatten to paragraphs ("• item") so a cut doc stays simple. */
function blocksOf(doc: Json): Json[] {
  const out: Json[] = [];
  const add = (n: Json, bullet: string | null) => {
    if (n.type === "bulletList" || n.type === "orderedList") {
      (n.content ?? []).forEach((li: Json, i: number) => add(li, n.type === "bulletList" ? "• " : `${i + 1}. `));
      return;
    }
    if (n.type === "listItem") {
      (n.content ?? []).forEach((c: Json, i: number) => add(c, i === 0 ? bullet : null));
      return;
    }
    const block = clone(n);
    if (bullet && block.type === "paragraph") block.content = [{ type: "text", text: bullet }, ...(block.content ?? [])];
    out.push(block);
  };
  (doc.content ?? []).forEach((n: Json) => add(n, null));
  return out;
}

/** Cuts `s` to at most `room` characters at a word boundary. */
function cutWords(s: string, room: number): string {
  if (s.length <= room) return s;
  const head = s.slice(0, Math.max(0, room));
  const sp = head.lastIndexOf(" ");
  return (sp > room * 0.5 ? head.slice(0, sp) : head).replace(/[\s,;:.–-]+$/, "");
}

/**
 * The doc cut to `maxChars` (ellipsis included) at a word boundary. Data chips
 * stay whole or go; marks stay on the text kept. `truncated` is false (and the
 * doc unchanged) when it already fits.
 */
export function truncateTextDoc(doc: Json, maxChars: number): { doc: Json; truncated: boolean } {
  if (textLength(doc) <= maxChars) return { doc, truncated: false };
  let room = Math.max(1, maxChars - ELLIPSIS.length);
  const blocks: Json[] = [];
  outer: for (const b of blocksOf(doc)) {
    const kept: Json[] = [];
    let done = false;
    for (const n of (b.content ?? []) as Json[]) {
      const len = textLength(n);
      if (len <= room) {
        kept.push(n);
        room -= len;
        continue;
      }
      if (n.type === "text" && room > 0) {
        const part = cutWords(n.text, room);
        if (part) kept.push({ ...n, text: part });
      }
      done = true;
      break;
    }
    if (kept.length || !done) blocks.push({ ...b, content: kept });
    if (done) break outer;
    room -= 1; // a block break counts as a space
    if (room <= 0) break;
  }
  // The ellipsis goes on the last text kept (or as its own text node).
  let last = blocks[blocks.length - 1];
  if (!last) {
    last = { type: "paragraph", content: [] };
    blocks.push(last);
  }
  const content: Json[] = last.content ?? [];
  const tail = content[content.length - 1];
  if (tail && tail.type === "text") content[content.length - 1] = { ...tail, text: tail.text.replace(/\s+$/, "") + ELLIPSIS };
  else content.push({ type: "text", text: ELLIPSIS });
  last.content = content;
  return { doc: { type: "doc", content: blocks.filter((b) => b.type === "hardBreak" || (b.content ?? []).length || b === last) }, truncated: true };
}

const paragraphDoc = (text: string, headingLevel?: number): Json => ({
  type: "doc",
  content: [headingLevel ? { type: "heading", attrs: { level: headingLevel }, content: [{ type: "text", text }] } : { type: "paragraph", content: [{ type: "text", text }] }],
});

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

export interface ResizeRequest {
  purpose: string;
  format: string;
  /** Source pages to include; omitted = the profile's defaults. */
  pageIds?: string[];
  title?: string;
  /** Page sizes in mm (PAGE_FORMAT_SIZES): the engine has no table of its own. */
  sizes: Record<string, { wMm: number; hMm: number }>;
  /** `source` on the copy (the server's values; the FE preview may pass zeros). */
  link: { docId: number; rev: number; dataHash: string };
}

export interface DroppedElement {
  pageId: string;
  pageName: string;
  elementId: string;
  type: string;
  label: string;
}

export interface TruncatedText {
  /** Page and element in the copy. */
  pageId: string;
  elementId: string;
  /** The source element it came from. */
  fromElementId: string;
  maxChars: number;
  chars: number;
  /** The full text before the cut (for an AI summary). */
  original: Json;
}

export interface OmittedPage {
  pageId: string;
  name: string;
  reason: "not_selected" | "flow" | "hidden" | "contents";
}

export interface ResizeReport {
  profile: ResizeProfile;
  /** Copy page → the source pages it was made from and its target layout. */
  pages: Array<{ pageId: string; layout: TargetLayoutId | "scaled" | "flow"; from: string[] }>;
  dropped: DroppedElement[];
  truncated: TruncatedText[];
  omitted: OmittedPage[];
}

export type ResizeResult = { ok: true; doc: Json; report: ResizeReport } | { ok: false; error: "FORMAT_INVALID" | "UNSUPPORTED" | "PAGES_UNKNOWN"; detail: string };

export interface ChapterChoice {
  id: string;
  label: string;
  pageIds: string[];
  /** Included when the dialog opens. */
  defaultOn: boolean;
}

interface Classified {
  page: Json;
  role: string | null;
  rule: RoleRule;
  chapter: string;
}

const unknownRule = (page: Json, pageH: number, kind: string): RoleRule => {
  if (page.kind === "flow") {
    const ch = FLOW_CHAPTERS[page.flowType];
    const known = (CHAPTERS[kind] ?? []).some((c) => c.id === ch);
    return { deck: null, chapter: ch && known ? ch : "annexes", skip: SKIPPED_FLOWS.has(page.flowType) };
  }
  const roles = (page.elements ?? []).map((e: Json) => elementRole(e, pageH));
  const heroes = roles.filter((r: ElementRole) => r === "hero_number").length;
  const deck: TargetLayoutId = roles.includes("chart") ? "chart" : heroes >= 2 ? "highlights" : roles.includes("table") ? "table" : "text";
  // A page someone added is in by default when it shows numbers.
  return { deck: (page.elements ?? []).some(isBound) ? deck : null, picked: deck, chapter: "summary" };
};

function classify(doc: Json, sizes: ResizeRequest["sizes"]): Classified[] {
  const pageH = sizes[doc.format]?.hMm ?? 297;
  const rules = ROLE_RULES[doc.kind] ?? {};
  let chapter = "summary";
  return (doc.pages ?? []).map((page: Json) => {
    const role = page.kind === "freeform" ? pageRole(page) : null;
    const rule = (role && rules[role]) || unknownRule(page, pageH, doc.kind);
    // A chapter opener belongs to the chapter after it; flow sections are annexes.
    if (rule.chapter !== "always" && role !== "chapter") chapter = rule.chapter;
    return { page, role, rule, chapter: page.kind === "flow" ? rule.chapter : rule.chapter === "always" ? "always" : chapter };
  });
}

/** Chapters of a source doc for the picker (always-in pages such as the back cover are not listed). */
export function resizeChapters(doc: Json, sizes: ResizeRequest["sizes"] = {}): ChapterChoice[] {
  const cls = classify(doc, sizes);
  const defs = CHAPTERS[doc.kind] ?? CHAPTERS.ghg;
  const out = defs.map((c) => {
    const pages = cls.filter((x) => x.chapter === c.id && !x.rule.skip && !x.page.hidden);
    return { id: c.id, label: c.label, pageIds: pages.map((x) => String(x.page.id)), defaultOn: c.id !== "annexes" && pages.some((x) => x.rule.deck !== null) };
  });
  return out.filter((c) => c.pageIds.length > 0);
}

const isFreeform = (p: Json) => p.kind === "freeform";

/** "FY 2025–26" for FY 2026 (as the backend), else the year. */
const periodText = (meta: Json): string =>
  meta?.yearType === "FY" && typeof meta.year === "number" ? `FY ${meta.year - 1}–${String(meta.year).slice(-2)}` : String(meta?.year ?? "");

const scaleBox = (box: Box, ref: [number, number], size: { wMm: number; hMm: number }) => {
  const sx = size.wMm / ref[0];
  const sy = size.hMm / ref[1];
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(box[0] * sx), y: r(box[1] * sy), w: r(box[2] * sx), h: r(box[3] * sy), rotation: 0 };
};

const sig = (e: Json): string => (isObj(e.props?.binding) ? `${e.type}:${JSON.stringify(e.props.binding)}:${e.props.measure ?? ""}` : `el:${e.id}`);

function elementLabel(e: Json): string {
  const p: Json = isObj(e.props) ? e.props : {};
  if (typeof p.label === "string" && p.label) return p.label;
  if (typeof p.title === "string" && p.title) return p.title;
  if (isObj(p.doc)) return plainText(p.doc).slice(0, 80);
  if (isObj(p.binding)) {
    const b = p.binding;
    if (b.source === "ghg") return [b.metric, b.breakdown].filter(Boolean).join(" by ");
    if (b.source === "input") return String(b.key);
    if (b.source === "kpi") return (Array.isArray(b.kpis) ? b.kpis : []).map((k: Json) => (isObj(k) ? (k.code ?? k.id) : k)).join(", ");
    return "Typed data";
  }
  return e.type;
}

interface Builder {
  doc: Json;
  size: { wMm: number; hMm: number };
  report: ResizeReport;
  usedSigs: Set<string>;
}

/** One copy page from a target layout and a pool of source elements (in priority order). */
function fillLayout(
  b: Builder,
  layoutId: TargetLayoutId,
  pageId: string,
  name: string,
  pool: Array<{ el: Json; role: ElementRole; page: Json }>,
  texts: { pageName: string; docTitle: string; subtitle: string; overrides?: Record<string, string> },
): { page: Json; used: Set<Json> } {
  const layout = TARGET_LAYOUTS[layoutId];
  const elements: Json[] = [];
  const used = new Set<Json>();
  // The same figure appears once per page (the total may be on the title slide and on the highlights slide).
  b.usedSigs = new Set();
  let z = 1;
  (layout.bands ?? []).forEach((box, i) => {
    elements.push({ id: `${pageId}.band${i + 1}`, type: "shape", frame: scaleBox(box, layout.ref, b.size), z: z++, source: "auto", props: { shape: "rect" } });
  });
  for (const slot of layout.slots) {
    const id = `${pageId}.${slot.name}`;
    const frame = scaleBox(slot.box, layout.ref, b.size);
    const override = texts.overrides?.[slot.name];
    const pick = override === undefined ? pool.find((c) => !used.has(c.el) && slot.accepts.includes(c.role) && !b.usedSigs.has(sig(c.el))) : undefined;
    if (pick) {
      used.add(pick.el);
      if (isBound(pick.el)) b.usedSigs.add(sig(pick.el));
      const moved: Json = { ...clone(pick.el), id, frame, z: z++ };
      delete moved.groupId;
      delete moved.locked;
      delete moved.templateLocked;
      delete moved.hidden;
      if (slot.tile && moved.type === "big_number" && (!moved.props.measure || moved.props.measure === "value")) {
        const p = moved.props;
        moved.type = "kpi_tile";
        moved.props = { binding: p.binding, ...(p.label ? { label: p.label } : {}), showDelta: !!p.showDelta, showSparkline: false, variant: "card" };
      }
      if (moved.type === "text") {
        if (slot.style) moved.props.style = slot.style;
        if (slot.align) moved.props.align = slot.align;
      }
      if (TEXT_TYPES.has(moved.type) && slot.maxChars && isObj(moved.props.doc)) {
        const chars = textLength(moved.props.doc);
        const cut = truncateTextDoc(moved.props.doc, slot.maxChars);
        if (cut.truncated) {
          b.report.truncated.push({ pageId, elementId: id, fromElementId: String(pick.el.id), maxChars: slot.maxChars, chars, original: clone(pick.el.props.doc) });
          moved.props.doc = cut.doc;
        }
      }
      elements.push(moved);
      continue;
    }
    const text =
      override ?? (slot.fallback === "pageName" ? texts.pageName : slot.fallback === "docTitle" ? texts.docTitle : slot.fallback === "subtitle" ? texts.subtitle : undefined);
    if (text && slot.style) {
      const level = slot.style === "heading" ? 2 : undefined;
      const max = slot.maxChars ?? 400;
      const t = text.length > max ? cutWords(text, max - 1) + ELLIPSIS : text;
      elements.push({ id, type: "text", frame, z: z++, source: "auto", props: { doc: paragraphDoc(t, level), style: slot.style, align: slot.align ?? "left" } });
    }
  }
  return { page: { id: pageId, kind: "freeform", name: name.slice(0, 200), background: {}, elements }, used };
}

function dropUnused(b: Builder, pool: Array<{ el: Json; role: ElementRole; page: Json }>, used: Set<Json>) {
  for (const c of pool) {
    if (used.has(c.el) || !isBound(c.el)) continue;
    b.report.dropped.push({ pageId: String(c.page.id), pageName: String(c.page.name ?? ""), elementId: String(c.el.id), type: String(c.el.type), label: elementLabel(c.el) });
  }
}

const poolOf = (page: Json, pageH: number) =>
  (page.elements ?? [])
    .filter((e: Json) => !e.hidden)
    .slice()
    .sort((a: Json, b: Json) => (a.frame?.y ?? 0) - (b.frame?.y ?? 0) || (a.frame?.x ?? 0) - (b.frame?.x ?? 0))
    .map((el: Json) => ({ el, role: elementRole(el, pageH), page }));

const pad = (n: number) => String(n).padStart(2, "0");

/** The source doc as a linked copy in another format (see the file header). */
export function resizeDocument(source: Json, req: ResizeRequest): ResizeResult {
  const profile = resizeTargetFor(req.purpose, req.format);
  if (!profile) return { ok: false, error: "FORMAT_INVALID", detail: `${req.purpose} can't be made in ${req.format}` };
  const size = req.sizes[req.format];
  const srcSize = req.sizes[source.format];
  if (!size || !srcSize) return { ok: false, error: "FORMAT_INVALID", detail: "unknown page size" };
  const pages: Json[] = Array.isArray(source.pages) ? source.pages : [];
  const known = new Set(pages.map((p) => String(p.id)));
  const unknown = (req.pageIds ?? []).filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, error: "PAGES_UNKNOWN", detail: unknown.join(", ") };

  const report: ResizeReport = { profile, pages: [], dropped: [], truncated: [], omitted: [] };
  const b: Builder = { doc: source, size, report, usedSigs: new Set() };
  const cls = classify(source, req.sizes);
  const picked = req.pageIds ? new Set(req.pageIds) : null;
  const samePurpose = source.purpose === req.purpose;
  const title = (req.title ?? source.meta?.title ?? "").slice(0, 200) || "Untitled";
  const subtitle = [source.meta?.subtitle, periodText(source.meta)].find((s) => typeof s === "string" && s.trim()) ?? "";
  const docTitle = String(source.meta?.title ?? title);
  const pageH = srcSize.hMm;

  // Which source pages go in.
  const included: Classified[] = [];
  for (const c of cls) {
    const id = String(c.page.id);
    if (c.page.hidden) {
      report.omitted.push({ pageId: id, name: String(c.page.name ?? ""), reason: "hidden" });
      continue;
    }
    if (c.rule.skip && profile !== "booklet") {
      report.omitted.push({ pageId: id, name: String(c.page.name ?? ""), reason: "contents" });
      continue;
    }
    const inByDefault = profile === "booklet" || samePurpose || c.rule.chapter === "always" || c.rule.deck !== null || (profile !== "deck" && isFreeform(c.page));
    const isIn = picked ? picked.has(id) || c.rule.chapter === "always" : inByDefault;
    if (!isIn) {
      report.omitted.push({ pageId: id, name: String(c.page.name ?? ""), reason: c.page.kind === "flow" ? "flow" : "not_selected" });
      continue;
    }
    included.push(c);
  }

  const out: Json[] = [];

  if (profile === "booklet") {
    const sx = size.wMm / srcSize.wMm;
    const sy = size.hMm / srcSize.hMm;
    if (Math.abs(sx / sy - 1) > 0.1) return { ok: false, error: "UNSUPPORTED", detail: "A booklet keeps the page shape: pick a format of the same proportions." };
    const r = (n: number) => Math.round(n * 100) / 100;
    for (const c of included) {
      const page = clone(c.page);
      if (isFreeform(page)) {
        page.elements = (page.elements ?? []).map((e: Json) => {
          const f = e.frame;
          const next: Json = { ...e, frame: { x: r(f.x * sx), y: r(f.y * sy), w: r(f.w * sx), h: r(f.h * sy), rotation: f.rotation ?? 0 } };
          if (e.type === "line") next.props = { ...e.props, x1: r(e.props.x1 * sx), y1: r(e.props.y1 * sy), x2: r(e.props.x2 * sx), y2: r(e.props.y2 * sy) };
          if (isObj(e.props?.crop)) next.props = { ...next.props, crop: { x: r(e.props.crop.x * sx), y: r(e.props.crop.y * sy), w: r(e.props.crop.w * sx), h: r(e.props.crop.h * sy) } };
          return next;
        });
        delete page.guides;
      }
      out.push(page);
      report.pages.push({ pageId: String(page.id), layout: isFreeform(page) ? "scaled" : "flow", from: [String(c.page.id)] });
    }
  } else if (profile === "deck") {
    const freeform = included.filter((c) => isFreeform(c.page));
    const flows = included.filter((c) => !isFreeform(c.page));
    const close = freeform.filter((c) => c.rule.deck === "close");
    const body = freeform.filter((c) => c.rule.deck !== "close");
    let n = 0;
    const add = (layout: TargetLayoutId, page: Json | null, name: string, from: string[], overrides?: Record<string, string>) => {
      n += 1;
      const pageId = `r${pad(n)}-${layout}`;
      const pool = page ? poolOf(page, pageH) : [];
      const made = fillLayout(b, layout, pageId, name, pool, { pageName: name, docTitle, subtitle, overrides });
      if (page && typeof page.notes === "string" && page.notes) made.page.notes = page.notes;
      if (page) dropUnused(b, pool, made.used);
      out.push(made.page);
      report.pages.push({ pageId, layout, from });
    };
    if (!body.some((c) => (c.rule.deck ?? c.rule.picked) === "title")) add("title", null, "Title", []);
    for (const c of body) {
      const layout = c.rule.deck ?? c.rule.picked ?? "text";
      add(layout, c.page, String(c.page.name || layout), [String(c.page.id)]);
    }
    // Flow sections (and pages left out by default) become one "See the full report" slide.
    const leftOut = picked ? [] : report.omitted.filter((o) => o.reason === "flow" || o.reason === "not_selected");
    const mentioned = [...flows.map((c) => ({ pageId: String(c.page.id), name: String(c.page.name ?? "") })), ...leftOut];
    if (mentioned.length) {
      const all = Array.from(new Set(mentioned.map((m) => m.name).filter(Boolean)));
      const names = all.length > 8 ? [...all.slice(0, 8), "and more"] : all;
      const from = mentioned.filter((m) => cls.some((c) => String(c.page.id) === m.pageId && c.page.kind === "flow")).map((m) => m.pageId);
      add("full_report", null, "See the full report", from, {
        title: "See the full report",
        body: names.length ? `The full report also covers: ${names.join(", ")}.` : "The full report has the detail behind these numbers.",
      });
    }
    for (const c of close) add("close", c.page, String(c.page.name || "Close"), [String(c.page.id)]);
  } else {
    // summary and social: one page filled from every included page, highlights first.
    const freeform = included.filter((c) => isFreeform(c.page));
    if (!freeform.some((c) => (c.page.elements ?? []).some((e: Json) => ["hero_number", "chart"].includes(elementRole(e, pageH)))))
      return { ok: false, error: "UNSUPPORTED", detail: "This design has no numbers or charts to put on a card." };
    const ordered = [...freeform.filter((c) => c.rule.highlights), ...freeform.filter((c) => !c.rule.highlights)];
    const pool = ordered.flatMap((c) => poolOf(c.page, pageH)).filter((x) => x.role !== "title" && x.role !== "heading");
    const layout: TargetLayoutId = profile === "summary" ? "one_page" : req.format === "square" ? "social_square" : "social_wide";
    const pageId = `r01-${layout}`;
    const made = fillLayout(b, layout, pageId, profile === "summary" ? "Summary" : "Social card", pool, { pageName: docTitle, docTitle, subtitle });
    dropUnused(b, pool, made.used);
    out.push(made.page);
    report.pages.push({ pageId, layout, from: freeform.map((c) => String(c.page.id)) });
    for (const c of included.filter((x) => !isFreeform(x.page))) report.omitted.push({ pageId: String(c.page.id), name: String(c.page.name ?? ""), reason: "flow" });
  }

  const doc: Json = {
    ...clone(source),
    purpose: req.purpose,
    format: req.format,
    meta: { ...clone(source.meta), title },
    pages: out,
    source: { docId: req.link.docId, rev: req.link.rev, dataHash: req.link.dataHash },
  };
  return { ok: true, doc, report };
}
