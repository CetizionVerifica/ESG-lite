/**
 * DS-5 · the auto-build, pure parts (no DB): from a template doc and the
 * new-design choices to a ReportDoc v2. The service (service.ts) loads the
 * template, resolves the data through DS-2 and stores the result.
 *
 *   periodLabel(yearType, year)        "FY 2025–26" / "2025"
 *   assembleDoc(template, choices)     template doc + meta/design from the choices (placeholders still in)
 *   fillPlaceholders(doc, ctx)         {{company.name}}, {{meta.*}}, {{input:key}} in every text (docs.ts PLACEHOLDER_PATTERN)
 *   pageDataSlots(doc)                 per page, the indexes of its bindings and chips in docBindings/collectTokens order
 *   emptyDataPages(doc, resolved)      pages whose GHG/KPI data all resolved to nothing
 *   dropEmptyPages(doc, hints, empty)  removes them unless `keepEmpty` (or `requires: 'none'`)
 *   stampElements(doc, hash)           `basedOnHash` on every data-bound element and text with chips
 *   mergeRebuild(current, fresh, ids)  a rebuild that keeps people's edits (RS-4 step 6)
 */
import type { Binding, ReportDoc, ReportInputKey, ReportInputs, ReportKind, TemplatePageHint, YearType } from "../contracts";
import { FRAMEWORKS_BY_KIND, PLACEHOLDER_PATTERN, REPORT_INPUT_KEYS } from "../contracts";
import { collectTokens, docBindings } from "../sources/doc";
import { inputDisplay } from "../sources/inputs";
import type { ResolvedBinding, ResolveResponse } from "../sources/types";
import type { TemplateRow } from "./template";

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** "FY 2025–26" for FY 2026 (April 2025 – March 2026); "2025" for a calendar year. */
export function periodLabel(yearType: YearType, year: number): string {
  if (yearType === "CY") return String(year);
  return `FY ${year - 1}–${String(year).slice(-2)}`;
}

export interface BuildChoices {
  kind: ReportKind;
  year: number;
  yearType: YearType;
  sites: "all" | number[];
  frameworks: string[];
  compareYear?: number;
  title?: string;
}

/** The default title: "<template name> <period>", e.g. "Inventory (GHG Protocol) FY 2025–26". */
export const defaultTitle = (template: Pick<TemplateRow, "name">, c: Pick<BuildChoices, "year" | "yearType">) => `${template.name} ${periodLabel(c.yearType, c.year)}`.slice(0, 200);

/**
 * The template's doc with the doc-level fields set from the template row and
 * the choices: kind, purpose, format, meta, design (templateId/version, the
 * template theme), assets. Frameworks not of the kind are dropped; an empty
 * list gets the kind's first framework (GHGP, GRI).
 */
export function assembleDoc(template: TemplateRow, templateDoc: Json, c: BuildChoices): Json {
  const doc = clone(templateDoc);
  const allowed = FRAMEWORKS_BY_KIND[c.kind] as readonly string[];
  const frameworks = c.frameworks.filter((f) => allowed.includes(f));
  const tdMeta = isObj(doc.meta) ? doc.meta : {};
  const tdDesign = isObj(doc.design) ? doc.design : {};
  const theme = isObj(tdDesign.theme) && Object.keys(tdDesign.theme).length ? tdDesign.theme : template.theme;
  const meta: Json = {
    title: (c.title ?? defaultTitle(template, c)).slice(0, 200),
    year: c.year,
    yearType: c.yearType,
    sites: c.sites,
    frameworks: frameworks.length ? frameworks : [allowed[0]],
    language: "en",
  };
  if (typeof tdMeta.subtitle === "string" && tdMeta.subtitle) meta.subtitle = tdMeta.subtitle;
  if (c.compareYear !== undefined) meta.compareYear = c.compareYear;
  const design: Json = { templateId: template.id ? String(template.id) : "blank", templateVersion: template.version, theme: theme ?? {} };
  if (typeof tdDesign.styleId === "string") design.styleId = tdDesign.styleId;
  return {
    schemaVersion: 2,
    kind: c.kind,
    purpose: template.purpose,
    format: template.format,
    meta,
    design,
    pages: Array.isArray(doc.pages) ? doc.pages : [],
    assets: Array.isArray(doc.assets) ? doc.assets : [],
  };
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

export interface PlaceholderContext {
  companyName: string;
  title: string;
  year: number;
  yearType: YearType;
  compareYear?: number;
  /** "All sites" or "Plant A, Plant B". */
  sitesText: string;
  frameworksText: string;
  inputs: ReportInputs;
  /** Text for `{{meta.period}}` (the reporting period input when set, else the year in words). */
  periodText: string;
}

const INPUT_LABELS: Record<ReportInputKey, string> = {
  consolidation_approach: "Consolidation approach",
  responsible_person: "Responsible person",
  reporting_period: "Reporting period",
  base_year: "Base year",
  recalculation_policy: "Recalculation policy",
  significance_threshold_pct: "Significance threshold",
  gwp_set: "GWP values",
  exclusions: "Exclusions",
  scope2_instruments: "Scope 2 instruments",
  uncertainty_statement: "Uncertainty",
  verification: "Verification",
  conformance: "Conformance",
  revenue: "Revenue",
  revenue_ppp_rate: "PPP rate",
  output_units: "Output",
  employees: "Employees",
  leadership_message: "Leadership message",
  about_company: "About the company",
};

/** "[Responsible person: add it in Report details]": an unfilled input stays visible (DS-12 flags it). */
export const missingInputText = (key: ReportInputKey) => `[${INPUT_LABELS[key]}: add it in Report details]`;

export function placeholderValue(token: string, ctx: PlaceholderContext): string {
  switch (token) {
    case "company.name":
      return ctx.companyName;
    case "meta.title":
      return ctx.title;
    case "meta.year":
      return String(ctx.year);
    case "meta.period":
      return ctx.periodText;
    case "meta.periodShort":
      return periodLabel(ctx.yearType, ctx.year);
    case "meta.compareYear":
      return ctx.compareYear !== undefined ? periodLabel(ctx.yearType, ctx.compareYear) : periodLabel(ctx.yearType, ctx.year - 1);
    case "meta.sites":
      return ctx.sitesText;
    case "meta.frameworks":
      return ctx.frameworksText;
  }
  const key = token.slice("input:".length) as ReportInputKey;
  if (!(REPORT_INPUT_KEYS as readonly string[]).includes(key)) return `{{${token}}}`;
  const value = ctx.inputs[key]?.value;
  const text = value === undefined || value === null ? "" : inputDisplay(key, value);
  return text.trim() ? text : missingInputText(key);
}

export const fillText = (text: string, ctx: PlaceholderContext): string =>
  text.replace(new RegExp(PLACEHOLDER_PATTERN.source, "g"), (_m, token: string) => placeholderValue(token.trim(), ctx));

/** Fills a TipTap doc's text nodes in place; a node left empty becomes an em dash (text nodes may not be empty). */
function fillTextDoc(node: unknown, ctx: PlaceholderContext): void {
  if (!isObj(node)) return;
  if (node.type === "text" && typeof node.text === "string") {
    const filled = fillText(node.text, ctx);
    node.text = filled.length ? filled : "—";
  }
  if (Array.isArray(node.content)) node.content.forEach((c) => fillTextDoc(c, ctx));
}

const STRING_PROPS = ["title", "subtitle", "caption", "label", "hint", "alt"] as const;

/** Fills every placeholder in the doc (meta title/subtitle, page names, text, labels, flow content); mutates and returns `doc`. */
export function fillPlaceholders(doc: Json, ctx: PlaceholderContext): Json {
  if (isObj(doc.meta)) {
    if (typeof doc.meta.title === "string") doc.meta.title = fillText(doc.meta.title, ctx).slice(0, 200) || ctx.title;
    if (typeof doc.meta.subtitle === "string") doc.meta.subtitle = fillText(doc.meta.subtitle, ctx).slice(0, 300);
  }
  for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
    if (!isObj(page)) continue;
    if (typeof page.name === "string") page.name = fillText(page.name, ctx).slice(0, 200);
    if (page.kind === "flow") {
      fillTextDoc(page.content, ctx);
      continue;
    }
    for (const e of Array.isArray(page.elements) ? page.elements : []) {
      if (!isObj(e) || !isObj(e.props)) continue;
      fillTextDoc(e.props.doc, ctx);
      for (const k of STRING_PROPS) if (typeof e.props[k] === "string") e.props[k] = fillText(e.props[k], ctx);
      if (Array.isArray(e.props.rows)) e.props.rows = e.props.rows.map((r: unknown) => (Array.isArray(r) ? r.map((c) => (typeof c === "string" ? fillText(c, ctx) : c)) : r));
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Empty data pages
// ---------------------------------------------------------------------------

/** Per page id, the indexes of its element bindings and chips in `docBindings` / `collectTokens` order. */
export function pageDataSlots(doc: ReportDoc): Map<string, { bindings: number[]; tokens: number[]; sources: Binding["source"][] }> {
  const out = new Map<string, { bindings: number[]; tokens: number[]; sources: Binding["source"][] }>();
  let b = 0;
  let t = 0;
  for (const page of doc.pages) {
    const one = { ...doc, pages: [page] } as ReportDoc;
    const bindings = docBindings(one);
    const tokens = collectTokens(one);
    out.set(page.id, {
      bindings: bindings.map((_, i) => b + i),
      tokens: tokens.map((_, i) => t + i),
      sources: [...bindings.map((x) => x.source), ...tokens.map((x) => x.attrs.binding.source)],
    });
    b += bindings.length;
    t += tokens.length;
  }
  return out;
}

/**
 * A GHG or KPI figure with something to show: a value, or a series with at
 * least one value. GHG figures read 0 when no approved row is in scope
 * (computeGhgTables sums nothing to 0), so for the `ghg` source only a
 * non-zero figure counts; a KPI value of 0 is a reported value.
 */
export function hasData(r: ResolvedBinding | undefined): boolean {
  if (!r || r.unavailable) return false;
  const counts = (v: number | null | undefined) => v !== null && v !== undefined && (r.source !== "ghg" || v !== 0);
  if (counts(r.value)) return true;
  return (r.series ?? []).some((s) => s.values.some((p) => counts(p.value)));
}

const isDataSource = (s: Binding["source"]) => s === "ghg" || s === "kpi";

/**
 * Pages that need data and have none: every GHG/KPI binding and chip on the
 * page resolved unavailable or empty. Pages without GHG/KPI data (covers,
 * text, input-only pages) are never empty.
 */
export function emptyDataPages(doc: ReportDoc, resolved: Pick<ResolveResponse, "values" | "tokens">): Set<string> {
  const slots = pageDataSlots(doc);
  const bindings = docBindings(doc);
  const tokens = collectTokens(doc);
  const empty = new Set<string>();
  for (const [pageId, s] of slots) {
    const data = [
      ...s.bindings.filter((i) => isDataSource(bindings[i].source)).map((i) => resolved.values[i]),
      ...s.tokens.filter((i) => isDataSource(tokens[i].attrs.binding.source)).map((i) => resolved.tokens[i]),
    ];
    if (data.length && !data.some(hasData)) empty.add(pageId);
  }
  return empty;
}

const EMPTY_SUFFIX = ".empty";

/**
 * Leaves out empty data pages unless their hint says `keepEmpty` or
 * `requires: 'none'`. A kept empty page with `emptyText` writes it into its
 * text elements whose id ends with ".empty". Returns the pages left out.
 */
export function dropEmptyPages(doc: Json, hints: Map<string, TemplatePageHint>, empty: Set<string>): Array<{ pageId: string; name: string; reason: string }> {
  const dropped: Array<{ pageId: string; name: string; reason: string }> = [];
  doc.pages = (doc.pages as Json[]).filter((p) => {
    if (!empty.has(p.id)) return true;
    const h = hints.get(p.id) ?? {};
    if (h.requires === "none") return true;
    if (h.keepEmpty) {
      if (h.emptyText && Array.isArray(p.elements)) {
        for (const e of p.elements) {
          if (e?.type === "text" && typeof e.id === "string" && e.id.endsWith(EMPTY_SUFFIX) && isObj(e.props)) {
            e.props.doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: h.emptyText }] }] };
          }
        }
      }
      return true;
    }
    dropped.push({ pageId: String(p.id), name: String(p.name ?? p.id), reason: "No approved data for this page in the period" });
    return false;
  });
  return dropped;
}

/** Sets `basedOnHash` on every element with a binding or chips (RS-4 step 5); text without data is left alone. */
export function stampElements(doc: Json, hash: string): Json {
  for (const page of doc.pages as Json[]) {
    if (page.kind !== "freeform") continue;
    for (const e of page.elements as Json[]) {
      const props = e.props ?? {};
      const hasBinding = isObj(props.binding);
      const hasChip = isObj(props.doc) && JSON.stringify(props.doc).includes('"type":"data"');
      if (hasBinding || hasChip) e.basedOnHash = hash;
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

const sameFrame = (a: Json | undefined, b: Json | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.rotation === b.rotation;

/**
 * POST /docs/:id/rebuild: pages in `pageIds` (all when absent) that the
 * fresh build also has are replaced by the fresh page, keeping people's work:
 * elements the user added (`source: 'user'`), AI text a person reviewed, and
 * any template element whose frame was moved or resized. Pages that are only
 * in the current doc (added by people) stay as they are; the page order and
 * hidden flags of the current doc are kept.
 */
export function mergeRebuild(current: Json, fresh: Json, pageIds?: string[]): { doc: Json; rebuilt: string[] } {
  const want = pageIds ? new Set(pageIds) : null;
  const freshById = new Map<string, Json>((fresh.pages as Json[]).map((p) => [p.id, p]));
  const rebuilt: string[] = [];
  const pages = (current.pages as Json[]).map((cur) => {
    const next = freshById.get(cur.id);
    if (!next || (want && !want.has(cur.id)) || next.kind !== cur.kind) return cur;
    rebuilt.push(cur.id);
    if (cur.kind !== "freeform") return { ...next, hidden: cur.hidden, name: cur.name };
    const oldById = new Map<string, Json>((cur.elements as Json[]).map((e) => [e.id, e]));
    const elements = (next.elements as Json[]).map((e) => {
      const old = oldById.get(e.id);
      if (!old) return e;
      if (old.reviewed || old.source === "user" || !sameFrame(old.frame, e.frame)) return old;
      return e;
    });
    const freshIds = new Set(elements.map((e) => e.id));
    for (const old of cur.elements as Json[]) if (!freshIds.has(old.id) && (old.source === "user" || old.reviewed)) elements.push(old);
    return { ...next, elements, hidden: cur.hidden, name: cur.name, notes: cur.notes, guides: cur.guides };
  });
  return { doc: { ...current, pages }, rebuilt };
}
