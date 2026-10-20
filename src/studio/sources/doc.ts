/**
 * DS-2 (RS-2 `tokens.ts`) · resolving a whole ReportDoc: what DS-5 auto-build,
 * DS-11 finals (`data_snapshot`), DS-12 checks and DS-13 drift call.
 *
 *   collectTokens(doc)          every data chip in the doc (text elements and flow sections), in page order
 *   docBindings(doc)            element bindings only (contracts `collectBindings` also returns chip bindings)
 *   resolveDoc(caller, doc, …)  the doc's year, CY/FY, sites and kind → ResolveResponse (same resolver as /resolve)
 */
import type { DataToken, ReportDoc } from "../contracts";
import { DataTokenSchema, type Binding } from "../contracts";
import type { StudioCaller } from "../guard";
import { buildContext, loadersFor, resolveAll } from "./resolve";
import type { ResolveResponse } from "./types";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Every `data` text node of the doc, validated (malformed chips are skipped; the schema already rejects them on save). */
export function collectTokens(doc: ReportDoc): DataToken[] {
  const out: DataToken[] = [];
  const walk = (n: unknown) => {
    if (!isObj(n)) return;
    if (n.type === "data") {
      const t = DataTokenSchema.safeParse({ type: "data", attrs: n.attrs });
      if (t.success) out.push(t.data);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  for (const page of doc.pages) {
    if (page.kind === "flow") {
      walk(page.content);
      continue;
    }
    for (const e of page.elements) {
      const props = e.props as Json;
      if (isObj(props.doc)) walk(props.doc);
    }
  }
  return out;
}

/** Element bindings (charts, tables, big numbers, tiles), in page order. */
export function docBindings(doc: ReportDoc): Binding[] {
  const out: Binding[] = [];
  for (const page of doc.pages) {
    if (page.kind === "flow") continue;
    for (const e of page.elements) {
      const props = e.props as Json;
      if (isObj(props.binding)) out.push(props.binding as Binding);
    }
  }
  return out;
}

/** Resolves every binding and chip of a doc in its own scope (meta.year, yearType, sites; kind). */
export async function resolveDoc(caller: StudioCaller, doc: ReportDoc, opts: { docId?: number } = {}): Promise<ResolveResponse> {
  const L = loadersFor(caller.companyId, doc.meta.yearType);
  const { ctx } = await buildContext(caller, { kind: doc.kind, year: doc.meta.year, yearType: doc.meta.yearType, sites: doc.meta.sites, ...(opts.docId ? { docId: opts.docId } : {}) }, L);
  return resolveAll(L, ctx, docBindings(doc), collectTokens(doc));
}
