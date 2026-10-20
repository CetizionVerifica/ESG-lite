/**
 * DS-12 · running the checks (RS-9 §4): `POST /studio/docs/:id/checks {rev, measurements?}`.
 *
 *   runChecks(caller, docId, body)   the stored draft at `rev` (DS_VERSION_CONFLICT otherwise):
 *                                    content, number and GHG/sustainability checks are always
 *                                    computed here; layout checks use the editor's live
 *                                    measurements when sent, else the last render of this rev
 *   evaluate(caller, docId, doc, m)  the pure check families on loaded data (the gate calls it)
 *   sortChecks(doc, checks)          errors, warnings, info; then page and element order
 */
import { AppDataSource } from "../../config/data-source";
import type { Measurement } from "../../reporting/studio/render/measure";
import { ChecksBodySchema, DsError, ReportDocSchema, SEVERITY_RANK, dsDocInvalid, type Check, type CheckId, type ChecksResponse, type ReportDoc } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { loadDocRow } from "../docs/store";
import { collectTokens, docBindings } from "../sources/doc";
import { buildContext, loadersFor, resolveAll } from "../sources/resolve";
import { contentChecks } from "./content";
import { loadGhgFacts, loadSustainabilityFacts } from "./facts";
import { ghgChecks } from "./ghg";
import { layoutChecks } from "./layout";
import { numberChecks } from "./numbers";
import type { CheckInput } from "./types";
import { docIndex, type DocIndex } from "./walk";

type Row = Record<string, any>;

export function sortChecks(doc: ReportDoc, checks: Check[], ix: DocIndex = docIndex(doc)): Check[] {
  const pageOf = (c: Check) => (c.pageId !== undefined ? ix.pageOrder.get(c.pageId) ?? -1 : -1);
  const elOf = (c: Check) => (c.elementId !== undefined ? ix.elementOrder.get(c.elementId) ?? -1 : -1);
  return [...checks].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Number(b.id === "GHG_PENDING_ENTRIES") - Number(a.id === "GHG_PENDING_ENTRIES") ||
      pageOf(a) - pageOf(b) ||
      elOf(a) - elOf(b),
  );
}

/** Every check family on an input already loaded (pure). */
export function runCheckFamilies(input: CheckInput): Check[] {
  return sortChecks(input.doc, [...contentChecks(input), ...numberChecks(input), ...layoutChecks(input.doc, input.measurements), ...ghgChecks(input)], input.ix);
}

// DS-13: check families that live elsewhere and need the database (collab: DATA_CHANGED drift, OPEN_TASK).
export type CheckProvider = (caller: StudioCaller, docId: number, doc: ReportDoc) => Promise<Check[]>;
const providers: CheckProvider[] = [];
export function registerCheckProvider(fn: CheckProvider): void {
  if (!providers.includes(fn)) providers.push(fn);
}

/** Loads what the checks need for `doc` (as the caller, in the doc's scope) and runs them. */
export async function evaluate(caller: StudioCaller, docId: number | null, doc: ReportDoc, measurements: Measurement[] | null): Promise<Check[]> {
  const L = loadersFor(caller.companyId, doc.meta.yearType);
  const { ctx } = await buildContext(caller, { kind: doc.kind, year: doc.meta.year, yearType: doc.meta.yearType, sites: doc.meta.sites, ...(docId ? { docId } : {}) }, L);
  const resolved = await resolveAll(L, ctx, docBindings(doc), collectTokens(doc));
  const input: CheckInput = { doc, ix: docIndex(doc), resolved, inputs: ctx.inputs, measurements };
  if (doc.kind === "ghg") input.ghg = await loadGhgFacts(caller, doc, ctx.siteIds, L.ghg);
  else input.sustainability = await loadSustainabilityFacts(caller, doc);
  const extra = docId ? (await Promise.all(providers.map((p) => p(caller, docId, doc)))).flat() : []; // DS-13
  return extra.length ? sortChecks(doc, [...runCheckFamilies(input), ...extra], input.ix) : runCheckFamilies(input);
}

/** The newest worker measurements of a render of this rev (proofs, prints and finals measure; PNGs don't). */
export async function storedMeasurements(docId: number, rev: number): Promise<Measurement[] | null> {
  const [r]: Row[] = await AppDataSource.query(
    `SELECT measurements FROM report_job WHERE doc_id = $1 AND rev = $2 AND measurements IS NOT NULL AND status IN ('done', 'failed') ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
    [docId, rev],
  ).catch(() => []);
  return r && Array.isArray(r.measurements) ? (r.measurements as Measurement[]) : null;
}

export const validDoc = (draft: Row): ReportDoc => {
  const r = ReportDocSchema.safeParse(draft);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return r.data;
};

/** The ids a final needs acknowledged: one per warning id. */
export const warningIds = (checks: Check[]): CheckId[] => [...new Set(checks.filter((c) => c.severity === "warning").map((c) => c.id))];

export async function runChecks(caller: StudioCaller, docId: number, rawBody: unknown): Promise<ChecksResponse> {
  const row = await loadDocRow(caller, docId);
  const body = parse(ChecksBodySchema, rawBody ?? {});
  if (body.rev !== row.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev });
  const doc = validDoc(row.draft);
  let measurements: Measurement[] | null = null;
  let layout: ChecksResponse["layout"] = "none";
  if (body.measurements) {
    measurements = body.measurements as Measurement[];
    layout = "live";
  } else {
    measurements = await storedMeasurements(row.id, row.rev);
    if (measurements) layout = "render";
  }
  const checks = await evaluate(caller, row.id, doc, measurements);
  return { checks, blocking: checks.some((c) => c.severity === "error"), warnings: warningIds(checks), layout, rev: row.rev };
}
