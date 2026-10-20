/**
 * DS-4 · pure template composition (no DB): seed files → a template's
 * ReportDoc, and a template doc → a new doc's starting pages.
 *
 *   composeTemplateDoc(template, layouts, look)   the doc stored on report_template.doc: pages in
 *                                                 template order, each layout page re-id'd
 *                                                 (`p03-exec_summary`, elements `<pageId>.<slot>`),
 *                                                 FreeformPage.layoutId = `<family>/<role>`
 *   pageFromLayout(layout, family, pageId, text?) one layout as a page of a doc ("Add page")
 *   instantiateTemplate(doc, ctx)                 fills {{company}}, {{year}}, {{period}}, {{title}}
 *                                                 and sets meta (year, yearType, sites, frameworks);
 *                                                 narrows bindings on `sites: 'all'` to the doc's sites.
 *                                                 DS-5 calls it when it builds a doc from a template.
 */
import type { FrameworkCode, FreeformPage, Page, ReportDoc, Sites, TextDoc, TextNode, YearType } from "../contracts";
import type { LayoutSeed, TemplateSeed } from "./seeds/kit";

type Json = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Layout files carry their sort order. */
export interface LayoutFile extends LayoutSeed {
  sort: number;
}

/** The placeholder year of a template doc; instantiateTemplate replaces it. */
export const TEMPLATE_YEAR = 2025;

export const layoutSlug = (family: string, role: string) => `${family}/${role}`;
/** `<family>-<look>`; a family with one look is just `<family>`. */
export const templateSlug = (t: Pick<TemplateSeed, "family" | "looks">, look: string) => (t.looks.length > 1 ? `${t.family}-${look}` : t.family);

/** A text slot's doc with new text, keeping a leading heading's level. */
function replaceText(d: TextDoc, text: string): TextDoc {
  const first = d.content[0] as TextNode | undefined;
  const node: TextNode =
    first?.type === "heading" ? { type: "heading", attrs: { ...(first.attrs ?? {}) }, content: [{ type: "text", text }] } : { type: "paragraph", content: [{ type: "text", text }] };
  return { type: "doc", content: [node] };
}

/** One layout as a page with id `pageId`: element ids become `<pageId>.<slot>`. */
export function pageFromLayout(layout: Pick<LayoutSeed, "role" | "name" | "page">, family: string, pageId: string, opts: { name?: string; text?: Record<string, string> } = {}): FreeformPage {
  const page = clone(layout.page);
  const prefix = `${layout.page.id}.`;
  const elements = page.elements.map((e) => {
    const slot = e.id.startsWith(prefix) ? e.id.slice(prefix.length) : e.id;
    const next = { ...e, id: `${pageId}.${slot}` };
    const override = opts.text?.[slot];
    if (override !== undefined && next.type === "text") next.props = { ...next.props, doc: replaceText(next.props.doc, override) };
    return next;
  });
  return { ...page, id: pageId, name: opts.name ?? layout.name, layoutId: layoutSlug(family, layout.role), elements };
}

/** The template's doc for one look. Throws on a page naming a missing layout. */
export function composeTemplateDoc(t: TemplateSeed, layouts: LayoutSeed[], look: string): ReportDoc {
  const byRole = new Map(layouts.map((l) => [l.role, l]));
  const pages: Page[] = t.pages.map((entry, i) => {
    const n = String(i + 1).padStart(2, "0");
    if ("flow" in entry) {
      return { id: `p${n}-${entry.flow.flowType}`, kind: "flow", name: entry.flow.name, flowType: entry.flow.flowType, options: entry.flow.options ?? {} } as Page;
    }
    const layout = byRole.get(entry.layout);
    if (!layout) throw new Error(`${t.family}: page ${i + 1} names layout "${entry.layout}", which has no file`);
    return pageFromLayout(layout, t.family, `p${n}-${entry.layout}`, { name: entry.name, text: entry.text });
  });
  return {
    schemaVersion: 2,
    kind: t.kind,
    purpose: t.purpose,
    format: t.format,
    meta: {
      title: t.meta.title,
      ...(t.meta.subtitle ? { subtitle: t.meta.subtitle } : {}),
      year: TEMPLATE_YEAR,
      yearType: "CY",
      sites: "all",
      frameworks: t.meta.frameworks as FrameworkCode[],
      language: "en",
    },
    design: { templateId: templateSlug(t, look), templateVersion: t.version, theme: { look: look as "classic" | "light" | "night" } },
    pages,
    assets: [],
  };
}

export interface InstantiateContext {
  company: string;
  year: number;
  yearType: YearType;
  sites?: Sites;
  frameworks?: FrameworkCode[];
  compareYear?: number;
  title?: string;
}

/** "2025" for a calendar year, "FY 2025" for a financial year. */
export const periodLabel = (yearType: YearType, year: number) => (yearType === "FY" ? `FY ${year}` : String(year));

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));

/** Replaces placeholders in every string of a JSON tree and narrows `sites: 'all'` bindings. */
function walk(node: unknown, vars: Record<string, string>, sites: Sites | undefined): unknown {
  if (typeof node === "string") return fill(node, vars);
  if (Array.isArray(node)) return node.map((n) => walk(n, vars, sites));
  if (!isObj(node)) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) out[k] = walk(v, vars, sites);
  if (sites && sites !== "all" && (out.source === "ghg" || out.source === "kpi") && out.sites === "all") out.sites = sites;
  return out;
}

/** A template doc made ready for a company and period (DS-5 builds docs with it). Pure; the input is unchanged. */
export function instantiateTemplate(doc: ReportDoc, ctx: InstantiateContext): ReportDoc {
  const period = periodLabel(ctx.yearType, ctx.year);
  const vars = { company: ctx.company, year: String(ctx.year), period, title: "" };
  const title = ctx.title ?? fill(doc.meta.title, vars);
  vars.title = title;
  const pages = walk(doc.pages, vars, ctx.sites) as Page[];
  return {
    ...clone(doc),
    meta: {
      ...doc.meta,
      title: title.slice(0, 200),
      ...(doc.meta.subtitle ? { subtitle: fill(doc.meta.subtitle, vars) } : {}),
      year: ctx.year,
      yearType: ctx.yearType,
      sites: ctx.sites ?? doc.meta.sites,
      frameworks: ctx.frameworks ?? doc.meta.frameworks,
      ...(ctx.compareYear ? { compareYear: ctx.compareYear } : {}),
    },
    pages,
  };
}
