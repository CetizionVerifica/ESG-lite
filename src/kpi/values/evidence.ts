/**
 * KPI-4 · evidence on a KPI value (01-contracts §2 `kpi_value_evidence`),
 * stored like emission documents (Cloudinary, or local files with
 * LOCAL_FILE_STORAGE). Add and remove: whoever may write the value (the owner,
 * or a Manager of its site). Once approved, only a Manager, Admin or the
 * Superadmin may change it (a contributor gets KPI_NOT_DRAFT), and a removal
 * after approval is audited as `evidence_removed_after_approval`. Changing
 * evidence in a locked period is allowed: it changes no figure. Audit rows
 * carry evidence ids, never file names or contents.
 */
import { Readable } from "stream";
import { AppDataSource } from "../../config/data-source";
import cloudinary from "../../config/cloudinary";
import { destroyStoredFile, uniqueFileName } from "../../utils/storedFiles";
import { KpiError } from "../contracts/errors";
import { KpiEvidenceLinkSchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { storeChecks } from "../review/checks";
import { assertCanWrite, auditValue, findKpi, holdKpiLease, isReviewer, loadVisibleValue } from "./service";

type Row = Record<string, any>;

/** KPI-8: evidence decides KPI_EVIDENCE, so a value in review gets its checks again. */
const recheck = async (m: import("typeorm").EntityManager, valueId: number) => {
  const [v]: Row[] = await m.query(`SELECT status, source FROM kpi_value WHERE id = $1`, [valueId]);
  if (v?.status === "pending" && v.source === "manual") await storeChecks(m, valueId);
};

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

const out = (e: Row) => ({ id: e.id, kpi_value_id: e.kpi_value_id, document_url: e.document_url, document_name: e.document_name, uploaded_by: e.uploaded_by, uploaded_at: e.uploaded_at });

const upload = (file: UploadedFile): Promise<{ url: string; public_id: string }> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "kpi_evidence", resource_type: "auto", public_id: `kpi_evidence/${uniqueFileName(file.originalname)}` },
      (error, result) => (error || !result ? reject(error ?? new Error("upload failed")) : resolve({ url: result.secure_url || result.url, public_id: result.public_id })),
    );
    Readable.from([file.buffer]).pipe(stream);
  });

/** Checks the caller may change this value's evidence; returns the value. */
async function assertEvidenceAccess(m: import("typeorm").EntityManager, caller: KpiCaller, valueId: number): Promise<Row> {
  const v = await loadVisibleValue(m, caller, valueId);
  const kpi = await findKpi(m, caller.companyId, { id: Number(v.kpi_definition_id) });
  await assertCanWrite(m, caller, kpi, v.site_id === null ? null : Number(v.site_id));
  if (v.status === "approved" && !isReviewer(caller.role)) throw new KpiError("KPI_NOT_DRAFT", { status: "approved" });
  return v;
}

export async function addEvidence(caller: KpiCaller, valueId: number, file: UploadedFile | undefined, body: unknown) {
  // Check first, so nothing is uploaded for a value the caller can't change.
  await AppDataSource.transaction((m) => assertEvidenceAccess(m, caller, valueId));
  let doc: { url: string; name: string; public_id: string | null };
  if (file) {
    const stored = await upload(file);
    doc = { url: stored.url, name: file.originalname.slice(0, 255), public_id: stored.public_id };
  } else {
    const link = parse(KpiEvidenceLinkSchema, body ?? {});
    doc = { url: link.document_url, name: link.document_name, public_id: null };
  }
  return AppDataSource.transaction(async (m) => {
    await holdKpiLease(m, caller.companyId);
    await assertEvidenceAccess(m, caller, valueId);
    const rows: Row[] = await m.query(
      `INSERT INTO kpi_value_evidence (kpi_value_id, document_url, document_name, public_id, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [valueId, doc.url, doc.name, doc.public_id, caller.userId || null],
    );
    await auditValue(m, valueId, "evidence_added", { evidence_id: { old: null, new: rows[0].id } }, caller.userId);
    await recheck(m, valueId);
    return out(rows[0]);
  });
}

export async function removeEvidence(caller: KpiCaller, valueId: number, evidenceId: number) {
  const removed = await AppDataSource.transaction(async (m) => {
    await holdKpiLease(m, caller.companyId);
    const v = await assertEvidenceAccess(m, caller, valueId);
    const rows: Row[] = await m.query(`SELECT * FROM kpi_value_evidence WHERE id = $1 AND kpi_value_id = $2`, [evidenceId, valueId]);
    if (!rows.length) throw new KpiError("KPI_NOT_FOUND");
    await m.query(`DELETE FROM kpi_value_evidence WHERE id = $1 AND kpi_value_id = $2`, [evidenceId, valueId]);
    await auditValue(m, valueId, v.status === "approved" ? "evidence_removed_after_approval" : "evidence_removed", { evidence_id: { old: evidenceId, new: null } }, caller.userId);
    await recheck(m, valueId);
    return rows[0];
  });
  if (removed.public_id) {
    try {
      await destroyStoredFile(cloudinary.uploader, removed.public_id);
    } catch (err) {
      console.error(`[kpi] evidence ${evidenceId} file not removed from storage:`, (err as Error)?.message);
    }
  }
  return { removed: evidenceId };
}
