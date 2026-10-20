/**
 * DS-11 · render jobs (RS-5 §3, 01-contracts §7): rows, the request side and
 * downloads. The worker side is worker.ts.
 *
 *   createJob(caller, docId, body)   POST /docs/:id/jobs → 202 ReportJob (queued, then dispatched)
 *   getJob(caller, jobId)            GET /jobs/:id
 *   listJobs(caller, docId, kind?)   GET /docs/:id/jobs (newest 20; the Share dialog picks a proof)
 *   jobFile(caller, jobId)           GET /jobs/:id/file (the stored bytes, never a URL or a key)
 *
 * Roles (01-contracts §4): proof, png, print, thumbnail = R; final = M.
 * A job renders the draft at `rev` as stored when it was asked for, so later
 * edits never change a job in flight. A final runs the final gate first
 * (gate.ts), refuses with DS_JOB_RUNNING while another final is in flight, and
 * needs a note when a final already exists (R10).
 */
import { AppDataSource } from "../../config/data-source";
import { CreateJobBodySchema, DsError, ReportDocSchema, dsDocInvalid, type JobKind, type JobOptions, type ReportDoc, type ReportJob } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { loadDocRow, type DocRow } from "../docs/store";
import { finalGate } from "./gate";
import { getOutput, removeOutput } from "./storage";
import { dispatchJob } from "../../queues/studioRenderProducer";

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Proofs, prints, PNGs and thumbnails are kept 7 days (RS-5 §5); finals live in their version. */
export const OUTPUT_KEEP_DAYS = 7;

export const JOB_COLS = `id, company_id, doc_id, version_id, kind, status, rev, options, note, acknowledged_warnings, error_code, attempts, requested_by, started_at, finished_at, file_key, content_type, bytes, sha256, page_count, proof_expires_at, created_at`;

export interface JobRow {
  id: number;
  companyId: number;
  docId: number;
  versionId: number | null;
  kind: JobKind;
  status: ReportJob["status"];
  rev: number;
  options: JobOptions;
  note: string | null;
  errorCode: string | null;
  attempts: number;
  requestedBy: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  fileKey: string | null;
  contentType: string | null;
  bytes: number | null;
  pageCount: number | null;
  expiresAt: string | null;
  createdAt: string;
}

export const toJobRow = (r: Row): JobRow => ({
  id: Number(r.id),
  companyId: Number(r.company_id),
  docId: Number(r.doc_id),
  versionId: r.version_id === null || r.version_id === undefined ? null : Number(r.version_id),
  kind: r.kind,
  status: r.status,
  rev: Number(r.rev),
  options: (r.options ?? {}) as JobOptions,
  note: r.note ?? null,
  errorCode: r.error_code ?? null,
  attempts: Number(r.attempts ?? 0),
  requestedBy: r.requested_by === null || r.requested_by === undefined ? null : Number(r.requested_by),
  startedAt: iso(r.started_at),
  finishedAt: iso(r.finished_at),
  fileKey: r.file_key ?? null,
  contentType: r.content_type ?? null,
  bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
  pageCount: r.page_count === null || r.page_count === undefined ? null : Number(r.page_count),
  expiresAt: iso(r.proof_expires_at),
  createdAt: iso(r.created_at) as string,
});

/** "Acme-Ltd-GHG-Report-2025" (no user text beyond letters, digits and dashes). */
export function fileStem(company: string, kind: string, year: number): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);
  const label = kind === "sustainability" ? "Sustainability-Report" : "GHG-Report";
  return [slug(company) || "Report", label, String(year)].join("-");
}

export const JOB_SUFFIX: Record<JobKind, { suffix: string; ext: string; mime: string }> = {
  proof: { suffix: "proof", ext: "pdf", mime: "application/pdf" },
  print: { suffix: "print", ext: "pdf", mime: "application/pdf" },
  final: { suffix: "final", ext: "pdf", mime: "application/pdf" },
  png: { suffix: "pages", ext: "zip", mime: "application/zip" },
  thumbnail: { suffix: "thumbnail", ext: "png", mime: "image/png" },
};

async function companyName(companyId: number): Promise<string> {
  const [r]: Row[] = await AppDataSource.query(`SELECT COALESCE(b.name, c.name) AS name FROM company c LEFT JOIN brand b ON b.company_id = c.company_id WHERE c.company_id = $1`, [companyId]);
  return String(r?.name ?? "Report");
}

/** The download name of a job's file. */
export async function jobFileName(job: JobRow, doc: Pick<DocRow, "kind" | "year">, versionN: number | null): Promise<string> {
  const stem = fileStem(await companyName(job.companyId), doc.kind, doc.year);
  const s = JOB_SUFFIX[job.kind];
  return job.kind === "final" && versionN ? `${stem}-v${versionN}.${s.ext}` : `${stem}-${s.suffix}.${s.ext}`;
}

const isExpired = (job: JobRow, now = Date.now()) => !!job.expiresAt && Date.parse(job.expiresAt) <= now;

export async function jobResponse(job: JobRow, doc: Pick<DocRow, "kind" | "year">): Promise<ReportJob> {
  let versionN: number | null = null;
  if (job.versionId) {
    const [v]: Row[] = await AppDataSource.query(`SELECT n FROM report_doc_version WHERE id = $1 AND doc_id = $2`, [job.versionId, job.docId]);
    versionN = v ? Number(v.n) : null;
  }
  const ready = job.status === "done" && !!job.fileKey && !isExpired(job);
  return {
    id: job.id,
    docId: job.docId,
    versionId: job.versionId,
    versionN,
    kind: job.kind,
    status: job.status,
    errorCode: job.status === "failed" ? "DS_JOB_FAILED" : null,
    errorReason: job.status === "failed" ? job.errorCode : null,
    requestedBy: job.requestedBy,
    rev: job.rev,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    downloadUrl: ready ? `/studio/jobs/${job.id}/file` : null,
    fileName: ready ? await jobFileName(job, doc, versionN) : null,
    bytes: ready ? job.bytes : null,
    pageCount: job.pageCount,
    expiresAt: job.expiresAt,
    ...(Object.keys(job.options ?? {}).length ? { options: job.options } : {}),
  };
}

/** A job of the caller's company whose doc the caller can read; anything else is 404. */
export async function loadJob(caller: StudioCaller, jobId: number): Promise<{ job: JobRow; doc: DocRow }> {
  const [r]: Row[] = await AppDataSource.query(`SELECT ${JOB_COLS} FROM report_job WHERE id = $1 AND company_id = $2`, [jobId, caller.companyId]);
  if (!r) throw new DsError("DS_DOC_NOT_FOUND");
  const job = toJobRow(r);
  const doc = await loadDocRow(caller, job.docId);
  return { job, doc };
}

const validDoc = (draft: Row): ReportDoc => {
  const r = ReportDocSchema.safeParse(draft);
  if (!r.success) throw dsDocInvalid(r.error.issues);
  return r.data;
};

export async function createJob(caller: StudioCaller, docId: number, rawBody: unknown): Promise<ReportJob> {
  // The doc first: another company's id answers 404 whatever the body (layer rule 1).
  const row = await loadDocRow(caller, docId);
  const body = parse(CreateJobBodySchema, rawBody ?? {});
  if (body.kind === "final" && caller.roleClass !== "M") throw new DsError("DS_ROLE");
  if (row.build?.state === "running") throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev, building: true });
  if (body.rev !== row.rev) throw new DsError("DS_VERSION_CONFLICT", { rev: row.rev });
  const doc = validDoc(row.draft);
  const options: JobOptions = { ...(body.options ?? {}) };
  if (body.kind === "png") options.dpi = options.dpi ?? 144;
  if (body.kind === "print") options.cropMarks = options.cropMarks ?? false;
  if (body.kind === "thumbnail" && options.pageId && !doc.pages.some((p) => p.id === options.pageId)) {
    throw new DsError("DS_VALIDATION", { issues: [{ path: "options.pageId", message: "No page with that id" }] });
  }

  if (body.kind === "final") {
    const [running]: Row[] = await AppDataSource.query(`SELECT id FROM report_job WHERE doc_id = $1 AND kind = 'final' AND status IN ('queued', 'running') LIMIT 1`, [row.id]);
    if (running) throw new DsError("DS_JOB_RUNNING", { jobId: Number(running.id) });
    const [prior]: Row[] = await AppDataSource.query(`SELECT 1 FROM report_doc_version WHERE doc_id = $1 AND kind = 'final' LIMIT 1`, [row.id]);
    if (prior && !body.note) throw new DsError("DS_VALIDATION", { issues: [{ path: "note", message: "Say what changed since the last final" }] });
    await finalGate()({ caller, docId: row.id, rev: row.rev, doc, acknowledgedWarnings: body.acknowledgedWarnings ?? [] });
  }

  const [r]: Row[] = await AppDataSource.query(
    `INSERT INTO report_job (company_id, doc_id, kind, status, rev, options, doc, note, acknowledged_warnings, requested_by)
     VALUES ($1, $2, $3, 'queued', $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9) RETURNING ${JOB_COLS}`,
    [caller.companyId, row.id, body.kind, row.rev, JSON.stringify(options), JSON.stringify(doc), body.note ?? null, body.acknowledgedWarnings ? JSON.stringify(body.acknowledgedWarnings) : null, caller.userId || null],
  );
  const job = toJobRow(r);
  await dispatchJob(job.id);
  return jobResponse(job, row);
}

export async function getJob(caller: StudioCaller, jobId: number): Promise<ReportJob> {
  const { job, doc } = await loadJob(caller, jobId);
  return jobResponse(job, doc);
}

export async function listJobs(caller: StudioCaller, docId: number, kind?: JobKind): Promise<ReportJob[]> {
  const doc = await loadDocRow(caller, docId);
  const params: unknown[] = [doc.id, caller.companyId];
  let where = `doc_id = $1 AND company_id = $2`;
  if (kind) {
    params.push(kind);
    where += ` AND kind = $3`;
  }
  const rows: Row[] = await AppDataSource.query(`SELECT ${JOB_COLS} FROM report_job WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 20`, params);
  return Promise.all(rows.map((r) => jobResponse(toJobRow(r), doc)));
}

/** The stored file of a finished job; 404 while running, after expiry, or when the file is gone. */
export async function jobFile(caller: StudioCaller, jobId: number): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
  const { job, doc } = await loadJob(caller, jobId);
  if (job.status !== "done" || !job.fileKey) throw new DsError("DS_DOC_NOT_FOUND");
  if (isExpired(job)) {
    await removeOutput(job.fileKey).catch(() => undefined);
    throw new DsError("DS_DOC_NOT_FOUND", { reason: "expired" });
  }
  const bytes = await getOutput(job.fileKey);
  if (!bytes) throw new DsError("DS_DOC_NOT_FOUND");
  const res = await jobResponse(job, doc);
  return { bytes, contentType: job.contentType ?? JOB_SUFFIX[job.kind].mime, fileName: res.fileName ?? `report.${JOB_SUFFIX[job.kind].ext}` };
}
