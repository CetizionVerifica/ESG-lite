/**
 * DS-13 · data drift (RS-10 §5, both sources): typed text written against
 * figures that have since changed.
 *
 *   GET /docs/:id/drift   R   DriftResponse {dataHash, changed[]}
 *
 * How (both GHG and KPI, through DS-2's resolver):
 *   1. resolve the doc as it is now (resolveDoc) → the current data hash and every figure's display;
 *   2. store those figures under that hash (`report_data_baseline`), so a later change can show "before";
 *   3. a text element is "about data" when it holds chips or typed digits on a page that shows figures;
 *      it was written against `basedOnHash` (DS-5 stamps chips' texts at build; "Mark as checked" stamps
 *      the current hash), else against the design's build hash (`report_doc.data_hash`);
 *   4. it has drifted when that hash isn't the current one and a figure on its page changed (or the
 *      figures under the old hash weren't recorded, so we can't tell).
 * Chips, tiles and charts refresh by themselves: only typed text is listed. DATA_CHANGED (a warning,
 * RS-10) is raised for each listed element by the checks provider, so a final needs it acknowledged
 * or marked as checked.
 */
import { AppDataSource } from "../../config/data-source";
import { CHECK_RULES, DsError, ReportDocSchema, type Check, type DriftFigure, type DriftItem, type DriftResponse, type ReportDoc } from "../contracts";
import type { StudioCaller } from "../guard";
import { loadDocRow } from "../docs/store";
import { resolveDoc } from "../sources/doc";
import type { ResolveResponse } from "../sources/types";
import { docIndex, type DocIndex } from "../checks/walk";

type Row = Record<string, any>;
type Json = Record<string, unknown>;

export interface Figure {
  key: string;
  pageId: string;
  elementId: string;
  label: string;
  display: string;
}

const TYPE_LABEL: Record<string, string> = { chart: "Chart", table: "Table", kpi_tile: "KPI tile", big_number: "Big number", progress: "Progress" };

/** Every figure of the doc with a stable key (element id; `<elementId>#<n>` for the n-th chip of a text). Pure. */
export function docFigures(doc: ReportDoc, res: Pick<ResolveResponse, "values" | "tokens">, ix: DocIndex = docIndex(doc)): Figure[] {
  const out: Figure[] = [];
  for (const b of ix.bindings) {
    const r = res.values[b.idx];
    if (!r || !b.elementId) continue;
    const p = b.element.props as Json;
    const label = String((typeof p.label === "string" && p.label) || (typeof p.title === "string" && p.title) || TYPE_LABEL[b.element.type] || "Figure");
    out.push({ key: b.elementId, pageId: b.pageId, elementId: b.elementId, label, display: r.display });
  }
  const seen = new Map<string, number>();
  for (const t of ix.tokens) {
    const r = res.tokens[t.idx];
    if (!r || !t.elementId) continue;
    const n = seen.get(t.elementId) ?? 0;
    seen.set(t.elementId, n + 1);
    out.push({ key: `${t.elementId}#${n}`, pageId: t.pageId, elementId: t.elementId, label: "Figure in text", display: r.display });
  }
  return out;
}

const DIGIT = /\d/;

/**
 * The drifted text elements (pure): `baselines` maps a data hash to the figures recorded under it.
 * `buildHash` is the design's own hash (texts without `basedOnHash` were written against it).
 */
export function driftItems(doc: ReportDoc, figures: Figure[], currentHash: string, buildHash: string | null, baselines: Map<string, Record<string, string>>, ix: DocIndex = docIndex(doc)): DriftItem[] {
  const byPage = new Map<string, Figure[]>();
  for (const f of figures) byPage.set(f.pageId, [...(byPage.get(f.pageId) ?? []), f]);
  const pageName = new Map(doc.pages.map((p) => [p.id, p.name]));
  const out: DriftItem[] = [];
  for (const t of ix.texts) {
    if (!t.element || !t.elementId || t.hidden) continue;
    const pageFigs = byPage.get(t.pageId) ?? [];
    const typed = t.paragraphs.join(" ").replace(/⁣/g, "");
    const aboutData = t.tokens.length > 0 || (DIGIT.test(typed) && pageFigs.length > 0);
    if (!aboutData) continue;
    const base = t.element.basedOnHash ?? buildHash;
    if (!base || base === currentHash) continue;
    const before = baselines.get(base);
    const figs: DriftFigure[] = pageFigs.map((f) => ({ elementId: f.elementId, label: f.label, before: before ? before[f.key] ?? null : null, after: f.display }));
    const changed = before ? figs.filter((f) => f.before !== f.after) : figs;
    if (before && !changed.length) continue; // the hash moved because of figures elsewhere
    const line = (pick: (f: DriftFigure) => string | null) => (changed.length ? changed.map((f) => `${f.label}: ${pick(f) ?? "not recorded"}`).join("; ") : null);
    out.push({
      elementId: t.elementId,
      pageId: t.pageId,
      pageName: pageName.get(t.pageId) ?? "",
      text: typed.trim().slice(0, 160),
      basedOnHash: base,
      before: before ? line((f) => f.before) : null,
      after: line((f) => f.after) ?? "",
      figures: changed,
    });
  }
  return out;
}

async function saveBaseline(docId: number, hash: string, figures: Figure[]): Promise<void> {
  const values = Object.fromEntries(figures.map((f) => [f.key, f.display]));
  await AppDataSource.query(`INSERT INTO report_data_baseline (doc_id, data_hash, values) VALUES ($1, $2, $3::jsonb) ON CONFLICT (doc_id, data_hash) DO NOTHING`, [docId, hash, JSON.stringify(values)]);
}

async function loadBaselines(docId: number, hashes: string[]): Promise<Map<string, Record<string, string>>> {
  if (!hashes.length) return new Map();
  const rows: Row[] = await AppDataSource.query(`SELECT data_hash, values FROM report_data_baseline WHERE doc_id = $1 AND data_hash = ANY($2::varchar[])`, [docId, hashes]);
  return new Map(rows.map((r) => [String(r.data_hash), (r.values ?? {}) as Record<string, string>]));
}

/**
 * The figures a design was built against (the after-build hook, DS-5 build/rebuild, duplicate and DS-10
 * resize). The build stamps `report_doc.data_hash` and texts' `basedOnHash` with the hash of the
 * template's bindings, which differs from the built design's own hash (pages without data are left
 * out), so without this baseline every text "about data" on a fresh design showed as DATA_CHANGED.
 * A copy first takes over its source's baselines, so drift since the source was written still shows.
 * [Wave 5 integrate]
 */
export async function recordBuiltBaseline(caller: StudioCaller, docId: number, fromDocId?: number): Promise<void> {
  const row = await loadDocRow(caller, docId);
  if (fromDocId) {
    await AppDataSource.query(
      `INSERT INTO report_data_baseline (doc_id, data_hash, values) SELECT $1, b.data_hash, b.values FROM report_data_baseline b JOIN report_doc d ON d.id = b.doc_id WHERE b.doc_id = $2 AND d.company_id = $3 ON CONFLICT (doc_id, data_hash) DO NOTHING`,
      [docId, fromDocId, caller.companyId],
    );
  }
  const parsed = ReportDocSchema.safeParse(row.draft);
  if (!parsed.success) return;
  const doc = parsed.data;
  const res = await resolveDoc(caller, doc, { docId });
  const figures = docFigures(doc, res);
  const hashes = new Set<string>([res.dataHash]);
  if (row.dataHash) hashes.add(row.dataHash);
  for (const h of hashes) await saveBaseline(docId, h, figures);
}

/** Drift of a doc already loaded and validated (the endpoint and the checks provider). */
export async function computeDrift(caller: StudioCaller, docId: number, doc: ReportDoc, buildHash: string | null): Promise<DriftResponse> {
  const res = await resolveDoc(caller, doc, { docId });
  const ix = docIndex(doc);
  const figures = docFigures(doc, res, ix);
  await saveBaseline(docId, res.dataHash, figures);
  const hashes = new Set<string>();
  for (const t of ix.texts) if (t.element?.basedOnHash) hashes.add(t.element.basedOnHash);
  if (buildHash) hashes.add(buildHash);
  hashes.delete(res.dataHash);
  const baselines = await loadBaselines(docId, [...hashes]);
  return { dataHash: res.dataHash, changed: driftItems(doc, figures, res.dataHash, buildHash, baselines, ix) };
}

export async function getDrift(caller: StudioCaller, docId: number): Promise<DriftResponse> {
  const row = await loadDocRow(caller, docId);
  const parsed = ReportDocSchema.safeParse(row.draft);
  if (!parsed.success) throw new DsError("DS_DOC_INVALID");
  return computeDrift(caller, row.id, parsed.data, row.dataHash);
}

/** DATA_CHANGED (warning) per drifted text and OPEN_TASK (info) per open task: the DS-13 checks provider. */
export function collabChecks(drift: DriftItem[], tasks: Array<{ id: number; pageId: string; elementId: string | null; body: string; assignee: string }>, pageIds: Set<string>): Check[] {
  const out: Check[] = [];
  for (const d of drift) {
    out.push({
      id: "DATA_CHANGED",
      severity: CHECK_RULES.DATA_CHANGED.severity,
      pageId: d.pageId,
      elementId: d.elementId,
      message: d.before ? `The data changed since this text was written (${d.before} → ${d.after}). Check the wording.` : `The data changed since this text was written (now ${d.after || "different"}). Check the wording.`,
      details: { basedOnHash: d.basedOnHash, figures: d.figures },
    });
  }
  for (const t of tasks) {
    out.push({
      id: "OPEN_TASK",
      severity: CHECK_RULES.OPEN_TASK.severity,
      ...(pageIds.has(t.pageId) ? { pageId: t.pageId } : {}),
      ...(t.elementId && pageIds.has(t.pageId) ? { elementId: t.elementId } : {}),
      message: `Open task for ${t.assignee}: ${t.body.length > 120 ? `${t.body.slice(0, 119)}…` : t.body}`,
      details: { commentId: t.id },
    });
  }
  return out;
}
