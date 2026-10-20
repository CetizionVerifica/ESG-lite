/**
 * DS-11 · view links (D15, 01-contracts §4 "shares" and "/s/:token").
 *
 *   createShare(caller, docId, body, base)   POST /docs/:id/shares (M) → 201 ReportShare with `url` (shown once)
 *   listShares(caller, docId)                GET /docs/:id/shares (M) → ReportShare[] (no url, no token)
 *   revokeShare(caller, shareId)             DELETE /shares/:id (M) → 204
 *   openShare(token)                         the public side: the link's row, or 404 / 410
 *
 * Safe by default:
 *   - the token is 32 random bytes (base64url); only its sha256 is stored, so
 *     a database read can't open a link and a lost link can't be shown again;
 *   - a link points at a stored PDF only (a final version, or a finished proof
 *     job, whose own 7-day expiry caps the link's), never at live data;
 *   - expiry defaults to 14 days, at most 90; revoked or expired → 410;
 *   - a link stops (410) when its design is deleted, the studio is switched
 *     off, or a sustainability design loses KPI tracking;
 *   - create, view and revoke are written to audit_log (`report_share`).
 */
import { createHash, randomBytes } from "crypto";
import { AppDataSource } from "../../config/data-source";
import { CreateShareBodySchema, DsError, type ReportShare } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { loadDocRow } from "../docs/store";

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const DAY_MS = 86_400_000;

export const AUDIT_ENTITY = "report_share";

/** A new token: 32 random bytes, base64url (43 characters). */
export const newToken = (): string => randomBytes(32).toString("base64url");
export const tokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Where links point: SHARE_BASE_URL, else FRONTEND_URL (the app's /s/:token page), else this API. */
export function shareBase(apiOrigin: string): string {
  return (process.env.SHARE_BASE_URL || process.env.FRONTEND_URL || apiOrigin).replace(/\/+$/, "");
}

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const shareLabel = (r: Row): string => (r.version_n !== null && r.version_n !== undefined ? `${r.version_kind === "final" ? "Final" : "Version"} v${Number(r.version_n)}` : `Proof · ${fmtDay(new Date(r.job_created_at ?? r.created_at))}`);

export function shareState(r: { revoked_at?: unknown; expires_at?: unknown }, now = Date.now()): ReportShare["state"] {
  if (r.revoked_at) return "revoked";
  return new Date(r.expires_at as string).getTime() <= now ? "expired" : "active";
}

const SCOLS = `s.id, s.doc_id, s.version_id, s.job_id, s.expires_at, s.revoked_at, s.views, s.last_viewed_at, s.created_at,
  v.n AS version_n, v.kind AS version_kind, j.created_at AS job_created_at,
  TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.last_name, ''))) AS created_by_name`;
const SFROM = `report_share s LEFT JOIN report_doc_version v ON v.id = s.version_id LEFT JOIN report_job j ON j.id = s.job_id LEFT JOIN "user" u ON u.user_id = s.created_by`;

const toShare = (r: Row): ReportShare => ({
  id: Number(r.id),
  docId: Number(r.doc_id),
  versionId: r.version_id === null ? null : Number(r.version_id),
  versionN: r.version_n === null || r.version_n === undefined ? null : Number(r.version_n),
  jobId: r.job_id === null ? null : Number(r.job_id),
  label: shareLabel(r),
  expiresAt: iso(r.expires_at) as string,
  revokedAt: iso(r.revoked_at),
  views: Number(r.views ?? 0),
  lastViewedAt: iso(r.last_viewed_at),
  createdAt: iso(r.created_at) as string,
  createdBy: r.created_by_name || null,
  state: shareState(r),
});

const audit = (id: number, action: string, fields: Record<string, unknown>, userId: number | null) =>
  AppDataSource.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, NULL, $5)`, [AUDIT_ENTITY, id, action, JSON.stringify(fields), userId]);

const requireM = (caller: StudioCaller) => {
  if (caller.roleClass !== "M") throw new DsError("DS_ROLE");
};

export async function createShare(caller: StudioCaller, docId: number, rawBody: unknown, apiOrigin: string): Promise<ReportShare> {
  const doc = await loadDocRow(caller, docId);
  requireM(caller);
  const body = parse(CreateShareBodySchema, rawBody ?? {});
  let expires = new Date(Date.now() + body.expiresInDays * DAY_MS);
  if (body.versionId !== undefined) {
    const [v]: Row[] = await AppDataSource.query(`SELECT id, pdf_r2_key FROM report_doc_version WHERE id = $1 AND doc_id = $2`, [body.versionId, doc.id]);
    if (!v) throw new DsError("DS_DOC_NOT_FOUND");
    if (!v.pdf_r2_key) throw new DsError("DS_VALIDATION", { issues: [{ path: "versionId", message: "That version has no stored PDF. Share a final or a proof." }] });
  } else {
    const [j]: Row[] = await AppDataSource.query(`SELECT id, kind, status, file_key, proof_expires_at FROM report_job WHERE id = $1 AND doc_id = $2 AND company_id = $3`, [body.jobId, doc.id, caller.companyId]);
    if (!j) throw new DsError("DS_DOC_NOT_FOUND");
    if (!["proof", "print"].includes(j.kind) || j.status !== "done" || !j.file_key) {
      throw new DsError("DS_VALIDATION", { issues: [{ path: "jobId", message: "Only a finished PDF proof can be shared" }] });
    }
    if (j.proof_expires_at) {
      const until = new Date(j.proof_expires_at);
      if (until.getTime() <= Date.now()) throw new DsError("DS_VALIDATION", { issues: [{ path: "jobId", message: "That proof has expired. Make a new one." }] });
      if (until < expires) expires = until;
    }
  }
  const token = newToken();
  const [r]: Row[] = await AppDataSource.query(
    `INSERT INTO report_share (company_id, doc_id, version_id, job_id, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [caller.companyId, doc.id, body.versionId ?? null, body.jobId ?? null, tokenHash(token), expires, caller.userId || null],
  );
  const id = Number(r.id);
  await audit(
    id,
    "create",
    { doc_id: { old: null, new: doc.id }, version_id: { old: null, new: body.versionId ?? null }, job_id: { old: null, new: body.jobId ?? null }, expires_at: { old: null, new: expires.toISOString() } },
    caller.userId || null,
  );
  const [row]: Row[] = await AppDataSource.query(`SELECT ${SCOLS} FROM ${SFROM} WHERE s.id = $1`, [id]);
  return { ...toShare(row), url: `${shareBase(apiOrigin)}/s/${token}` };
}

export async function listShares(caller: StudioCaller, docId: number): Promise<ReportShare[]> {
  const doc = await loadDocRow(caller, docId);
  requireM(caller);
  const rows: Row[] = await AppDataSource.query(`SELECT ${SCOLS} FROM ${SFROM} WHERE s.doc_id = $1 AND s.company_id = $2 ORDER BY s.created_at DESC, s.id DESC LIMIT 200`, [doc.id, caller.companyId]);
  return rows.map(toShare);
}

export async function revokeShare(caller: StudioCaller, shareId: number): Promise<void> {
  const [s]: Row[] = await AppDataSource.query(`SELECT id, doc_id, revoked_at FROM report_share WHERE id = $1 AND company_id = $2`, [shareId, caller.companyId]);
  if (!s) throw new DsError("DS_DOC_NOT_FOUND");
  await loadDocRow(caller, Number(s.doc_id));
  requireM(caller);
  if (s.revoked_at) return;
  await AppDataSource.query(`UPDATE report_share SET revoked_at = now(), revoked_by = $2, updated_at = now() WHERE id = $1`, [shareId, caller.userId || null]);
  await audit(shareId, "revoke", { revoked: { old: false, new: true } }, caller.userId || null);
}

// ---------------------------------------------------------------------------
// Public side (no session): /s/:token
// ---------------------------------------------------------------------------

export interface OpenShare {
  id: number;
  companyId: number;
  docId: number;
  title: string;
  company: string;
  logoUrl: string | null;
  label: string;
  expiresAt: string;
  pageCount: number | null;
  fileKey: string;
  kind: string;
  year: number;
}

/**
 * The live link for a token: 404 for an unknown or malformed token (nothing
 * about other links is revealed), 410 DS_SHARE_EXPIRED when revoked, expired,
 * or its design or studio is gone.
 */
export async function openShare(token: string): Promise<OpenShare> {
  if (!TOKEN_RE.test(token)) throw new DsError("DS_DOC_NOT_FOUND");
  const [r]: Row[] = await AppDataSource.query(
    `SELECT s.id, s.company_id, s.doc_id, s.expires_at, s.revoked_at, s.created_at,
            v.n AS version_n, v.kind AS version_kind, v.pdf_r2_key AS v_key, v.page_count AS v_pages,
            j.file_key AS j_key, j.page_count AS j_pages, j.created_at AS job_created_at, j.proof_expires_at, j.status AS j_status,
            d.title, d.kind, d.year, d.deleted_at, c.design_studio_enabled, c.kpi_tracking_enabled,
            COALESCE(b.name, c.name) AS company, b.logo_url
       FROM report_share s
       JOIN report_doc d ON d.id = s.doc_id AND d.company_id = s.company_id
       JOIN company c ON c.company_id = s.company_id
       LEFT JOIN brand b ON b.company_id = s.company_id
       LEFT JOIN report_doc_version v ON v.id = s.version_id AND v.doc_id = s.doc_id
       LEFT JOIN report_job j ON j.id = s.job_id AND j.doc_id = s.doc_id
      WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  if (!r) throw new DsError("DS_DOC_NOT_FOUND");
  const fileKey: string | null = r.v_key ?? (r.j_status === "done" ? r.j_key : null);
  const now = Date.now();
  const gone =
    shareState(r, now) !== "active" ||
    !!r.deleted_at ||
    r.design_studio_enabled !== true ||
    (r.kind === "sustainability" && r.kpi_tracking_enabled !== true) ||
    !fileKey ||
    (!r.v_key && r.proof_expires_at && new Date(r.proof_expires_at).getTime() <= now);
  if (gone) throw new DsError("DS_SHARE_EXPIRED");
  return {
    id: Number(r.id),
    companyId: Number(r.company_id),
    docId: Number(r.doc_id),
    title: String(r.title ?? "Report"),
    company: String(r.company ?? ""),
    logoUrl: r.logo_url ?? null,
    label: shareLabel(r),
    expiresAt: iso(r.expires_at) as string,
    pageCount: r.v_pages !== null && r.v_pages !== undefined ? Number(r.v_pages) : r.j_pages !== null && r.j_pages !== undefined ? Number(r.j_pages) : null,
    fileKey: fileKey as string,
    kind: String(r.kind),
    year: Number(r.year),
  };
}

/** Counts a view (the viewer page or its meta call) and audits it, without the viewer's identity. */
export async function countView(share: Pick<OpenShare, "id">): Promise<void> {
  const res = await AppDataSource.query(`UPDATE report_share SET views = views + 1, last_viewed_at = now() WHERE id = $1 RETURNING views`, [share.id]);
  const rows: Row[] = Array.isArray(res[0]) ? res[0] : res;
  const views = Number(rows[0]?.views ?? 0);
  await audit(share.id, "view", { views: { old: views - 1, new: views } }, null);
}
