/**
 * DS-11 · versions (01-contracts §4, RS-5 §4–5; DS-13 adds the history UI):
 *
 *   GET  /docs/:id/versions[?kind=]        ReportVersion[] (newest first; finals marked superseded)
 *   POST /docs/:id/versions {note}         a named snapshot of the current draft (kind 'snapshot')
 *   POST /docs/:id/versions/:n/restore     {rev} → the version's doc becomes the draft at rev + 1
 *   GET  /docs/:id/versions/:n/pdf         the stored PDF of a final, never a re-render
 *
 * Versions are never edited: a final keeps its doc, data snapshot, hashes and
 * PDF for good. Restoring copies a version into the draft (a new rev and an
 * autosave version noting where it came from).
 */
import { AppDataSource } from "../../config/data-source";
import { CreateVersionBodySchema, DsError, ReportDocSchema, RestoreVersionBodySchema, VersionsQuerySchema, dsDocInvalid, type ReportVersion, type VersionKind } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { addVersion, docResponse, loadDocRow, updateDraft } from "../docs/store";
import { checkSites, readableSites } from "../sources/resolve";
import { fileStem } from "./service";
import { getOutput } from "./storage";

type Row = Record<string, any>;

const VCOLS = `v.id, v.n, v.kind, v.rev, v.note, v.created_at, v.page_count, v.pdf_r2_key, v.pdf_sha256, v.data_hash, v.renderer_hash,
  TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.last_name, ''))) AS created_by_name`;

const toVersion = (docId: number, r: Row, newestFinal: number | null): ReportVersion => ({
  id: Number(r.id),
  n: Number(r.n),
  kind: r.kind as VersionKind,
  rev: r.rev === null ? null : Number(r.rev),
  note: r.note ?? null,
  createdAt: new Date(r.created_at).toISOString(),
  createdBy: r.created_by_name || null,
  pageCount: r.page_count === null ? null : Number(r.page_count),
  pdfUrl: r.pdf_r2_key ? `/studio/docs/${docId}/versions/${Number(r.n)}/pdf` : null,
  pdfSha256: r.pdf_sha256 ?? null,
  dataHash: r.data_hash ?? null,
  rendererHash: r.renderer_hash ?? null,
  superseded: r.kind === "final" && newestFinal !== null && Number(r.n) < newestFinal,
});

export async function listVersions(caller: StudioCaller, docId: number, query: unknown): Promise<ReportVersion[]> {
  const doc = await loadDocRow(caller, docId);
  const q = parse(VersionsQuerySchema, query ?? {});
  const params: unknown[] = [doc.id];
  let where = `v.doc_id = $1`;
  if (q.kind) {
    params.push(q.kind);
    where += ` AND v.kind = $2`;
  }
  const rows: Row[] = await AppDataSource.query(
    `SELECT ${VCOLS} FROM report_doc_version v LEFT JOIN "user" u ON u.user_id = v.created_by WHERE ${where} ORDER BY v.n DESC LIMIT 300`,
    params,
  );
  const [f]: Row[] = await AppDataSource.query(`SELECT MAX(n) AS n FROM report_doc_version WHERE doc_id = $1 AND kind = 'final'`, [doc.id]);
  const newestFinal = f?.n === null || f?.n === undefined ? null : Number(f.n);
  return rows.map((r) => toVersion(doc.id, r, newestFinal));
}

/** A version row of the caller's readable doc (404 otherwise). */
export async function loadVersion(caller: StudioCaller, docId: number, n: number): Promise<{ doc: Awaited<ReturnType<typeof loadDocRow>>; row: Row }> {
  const doc = await loadDocRow(caller, docId);
  const [row]: Row[] = await AppDataSource.query(`SELECT id, n, kind, rev, doc, note, pdf_r2_key, page_count, created_at FROM report_doc_version WHERE doc_id = $1 AND n = $2`, [doc.id, n]);
  if (!row) throw new DsError("DS_DOC_NOT_FOUND");
  return { doc, row };
}

export async function createSnapshot(caller: StudioCaller, docId: number, rawBody: unknown): Promise<ReportVersion> {
  const doc = await loadDocRow(caller, docId);
  const body = parse(CreateVersionBodySchema, rawBody ?? {});
  const n = await addVersion(doc.id, "snapshot", { doc: doc.draft, rev: doc.rev, dataHash: doc.dataHash, designVersion: Number(doc.draft?.design?.templateVersion) || null, note: body.note, userId: caller.userId });
  const rows: Row[] = await AppDataSource.query(`SELECT ${VCOLS} FROM report_doc_version v LEFT JOIN "user" u ON u.user_id = v.created_by WHERE v.doc_id = $1 AND v.n = $2`, [doc.id, n]);
  return toVersion(doc.id, rows[0], null);
}

export async function restoreVersion(caller: StudioCaller, docId: number, n: number, rawBody: unknown) {
  const { doc, row } = await loadVersion(caller, docId, n);
  const body = parse(RestoreVersionBodySchema, rawBody ?? {});
  if (doc.build?.state === "running") throw new DsError("DS_VERSION_CONFLICT", { rev: doc.rev, building: true });
  if (body.rev !== doc.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: doc.rev });
  const parsed = ReportDocSchema.safeParse(row.doc);
  if (!parsed.success) throw dsDocInvalid(parsed.error.issues);
  const restored = parsed.data;
  if (restored.kind !== doc.kind) throw dsDocInvalid([{ path: ["kind"], message: "A design's kind can't change" }]);
  if (restored.format !== (doc.draft.format ?? restored.format)) throw new DsError("DS_FORMAT_INVALID", { format: restored.format });
  const { readable, all } = await readableSites(caller);
  checkSites(restored.meta.sites, readable, all);
  const rev = await updateDraft(caller, doc.id, body.rev, restored as unknown as Row, { title: restored.meta.title });
  // A finalised design that is restored is a draft again (the final stays in its version).
  await AppDataSource.query(`UPDATE report_doc SET status = 'draft' WHERE id = $1 AND status = 'final'`, [doc.id]);
  await addVersion(doc.id, "autosave", { doc: restored as unknown as Row, rev, dataHash: doc.dataHash, designVersion: restored.design.templateVersion, note: `Restored from version ${n}`, userId: caller.userId });
  return docResponse(await loadDocRow(caller, doc.id));
}

/** The stored PDF of a version (finals); never a re-render. */
export async function versionPdf(caller: StudioCaller, docId: number, n: number): Promise<{ bytes: Buffer; fileName: string }> {
  const { doc, row } = await loadVersion(caller, docId, n);
  if (!row.pdf_r2_key) throw new DsError("DS_DOC_NOT_FOUND");
  const bytes = await getOutput(row.pdf_r2_key);
  if (!bytes) throw new DsError("DS_DOC_NOT_FOUND");
  const [c]: Row[] = await AppDataSource.query(`SELECT COALESCE(b.name, c.name) AS name FROM company c LEFT JOIN brand b ON b.company_id = c.company_id WHERE c.company_id = $1`, [caller.companyId]);
  return { bytes, fileName: `${fileStem(String(c?.name ?? "Report"), doc.kind, doc.year)}-v${Number(row.n)}.pdf` };
}
