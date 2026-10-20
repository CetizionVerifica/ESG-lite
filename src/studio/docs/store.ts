/**
 * DS-5 · `report_doc` and `report_doc_version` rows (raw SQL, as the rest of
 * src/studio). Every read filters by the caller's company; a doc of another
 * company, a deleted one or an unknown id answers 404 DS_DOC_NOT_FOUND. A doc
 * whose sites the caller can't all read is also 404 (a site-scoped Manager
 * never sees a company-wide design: rule 1 and RS "company-wide needs all sites").
 *
 *   loadDocRow(caller, id)              the row, tenant + kind + site checked
 *   listDocs(caller, filters)           GET /docs rows (readable, not deleted; sustainability only with KPI tracking)
 *   insertDoc / updateDraft / softDelete
 *   addVersion / autosaveIfDue / pruneAutosaves (D16)
 *   presence(docId, userId)             in-memory heartbeat: other users seen in the last 45 s (R15)
 */
import { AppDataSource } from "../../config/data-source";
import { assertKind, type StudioCaller } from "../guard";
import { DsError, type BuildProgress, type DocResponse, type DocSummary, type ReportKind, type ReportStatus, type VersionKind } from "../contracts";
import { readableSites } from "../sources/resolve";

type Row = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export interface DocRow {
  id: number;
  companyId: number;
  kind: ReportKind;
  status: ReportStatus;
  title: string;
  year: number;
  yearType: "CY" | "FY";
  rev: number;
  draft: Row;
  inputs: Row;
  templateId: number | null;
  sourceDocId: number | null;
  dataHash: string | null;
  build: BuildProgress | null;
  createdAt: string;
  updatedAt: string;
}

const toDocRow = (r: Row): DocRow => ({
  id: Number(r.id),
  companyId: Number(r.company_id),
  kind: r.kind as ReportKind,
  status: (r.status ?? "draft") as ReportStatus,
  title: String(r.title ?? ""),
  year: Number(r.year),
  yearType: r.year_type === "FY" ? "FY" : "CY",
  rev: Number(r.rev),
  draft: (r.draft ?? {}) as Row,
  inputs: (r.inputs ?? {}) as Row,
  templateId: r.template_id === null || r.template_id === undefined ? null : Number(r.template_id),
  sourceDocId: r.source_doc_id === null || r.source_doc_id === undefined ? null : Number(r.source_doc_id),
  dataHash: r.data_hash ?? null,
  build: (r.build ?? null) as BuildProgress | null,
  createdAt: iso(r.created_at) as string,
  updatedAt: iso(r.updated_at) as string,
});

const COLS = `id, company_id, kind, status, title, year, year_type, rev, draft, inputs, template_id, source_doc_id, data_hash, build, created_at, updated_at`;

/** The doc's sites as stored in the draft. */
export const docSites = (draft: Row): "all" | number[] => {
  const s = draft?.meta?.sites;
  return Array.isArray(s) ? s.map(Number).filter((n) => Number.isInteger(n) && n > 0) : "all";
};

/** Whether the caller can read every site the doc covers ('all' needs every company site). */
export async function canReadSites(caller: StudioCaller, sites: "all" | number[]): Promise<boolean> {
  const { readable, all } = await readableSites(caller);
  if (sites === "all") return all;
  return sites.every((s) => readable.includes(s));
}

export async function loadDocRow(caller: StudioCaller, id: number, opts: { kindCheck?: boolean } = {}): Promise<DocRow> {
  const [r]: Row[] = await AppDataSource.query(`SELECT ${COLS} FROM report_doc WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`, [id, caller.companyId]);
  if (!r) throw new DsError("DS_DOC_NOT_FOUND");
  const row = toDocRow(r);
  if (opts.kindCheck !== false) assertKind(caller, row.kind);
  if (!(await canReadSites(caller, docSites(row.draft)))) throw new DsError("DS_DOC_NOT_FOUND");
  return row;
}

export const docResponse = (row: DocRow): DocResponse => ({
  id: row.id,
  doc: row.draft,
  rev: row.rev,
  status: row.status,
  title: row.title,
  dataHash: row.dataHash,
  updatedAt: row.updatedAt,
  build: row.build,
});

export async function listDocs(caller: StudioCaller, filters: { kind?: ReportKind; year?: number }): Promise<DocSummary[]> {
  const params: unknown[] = [caller.companyId];
  let where = `d.company_id = $1 AND d.deleted_at IS NULL`;
  if (filters.kind) {
    params.push(filters.kind);
    where += ` AND d.kind = $${params.length}`;
  }
  if (!caller.kpiEnabled) where += ` AND d.kind <> 'sustainability'`;
  if (filters.year) {
    params.push(filters.year);
    where += ` AND d.year = $${params.length}`;
  }
  const rows: Row[] = await AppDataSource.query(
    `SELECT d.id, d.kind, d.purpose, d.format, d.title, d.year, d.year_type, d.status, d.rev, d.template_id, d.source_doc_id, d.created_at, d.updated_at,
            d.draft -> 'meta' -> 'sites' AS sites, COALESCE(jsonb_array_length(d.draft -> 'pages'), 0) AS page_count, d.build ->> 'state' AS build_state,
            TRIM(CONCAT(COALESCE(u.name, ''), ' ', COALESCE(u.last_name, ''))) AS updated_by_name,
            (SELECT MAX(v.n) FROM report_doc_version v WHERE v.doc_id = d.id AND v.kind = 'final') AS final_n
       FROM report_doc d LEFT JOIN "user" u ON u.user_id = d.updated_by
      WHERE ${where}
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT 200`,
    params,
  );
  const { readable, all } = await readableSites(caller);
  const visible = rows.filter((r) => (Array.isArray(r.sites) ? r.sites.every((s: unknown) => readable.includes(Number(s))) : all));
  return visible.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    purpose: r.purpose,
    format: r.format,
    title: r.title,
    year: Number(r.year),
    yearType: r.year_type === "FY" ? "FY" : "CY",
    status: r.status,
    rev: Number(r.rev),
    pageCount: Number(r.page_count) || 0,
    templateId: r.template_id === null ? null : Number(r.template_id),
    sourceDocId: r.source_doc_id === null ? null : Number(r.source_doc_id),
    finalVersion: r.final_n === null ? null : Number(r.final_n),
    buildState: r.build_state ?? null,
    createdAt: iso(r.created_at) as string,
    updatedAt: iso(r.updated_at) as string,
    updatedBy: r.updated_by_name || null,
    thumbnailUrl: null,
  }));
}

export interface NewDoc {
  companyId: number;
  kind: ReportKind;
  purpose: string;
  format: string;
  title: string;
  year: number;
  yearType: "CY" | "FY";
  draft: Row;
  inputs: Row;
  templateId: number | null;
  sourceDocId?: number | null;
  dataHash?: string | null;
  build?: BuildProgress | null;
  userId: number;
}

export async function insertDoc(d: NewDoc): Promise<number> {
  const [r]: Row[] = await AppDataSource.query(
    `INSERT INTO report_doc (company_id, kind, purpose, format, title, year, year_type, status, draft, rev, inputs, template_id, source_doc_id, data_hash, build, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8::jsonb, 1, $9::jsonb, $10, $11, $12, $13::jsonb, $14, $14) RETURNING id`,
    [
      d.companyId,
      d.kind,
      d.purpose,
      d.format,
      d.title,
      d.year,
      d.yearType,
      JSON.stringify(d.draft),
      JSON.stringify(d.inputs ?? {}),
      d.templateId,
      d.sourceDocId ?? null,
      d.dataHash ?? null,
      d.build ? JSON.stringify(d.build) : null,
      d.userId || null,
    ],
  );
  return Number(r.id);
}

/** Saves the build progress (no rev change: polling only). */
export const saveBuild = (id: number, build: BuildProgress) => AppDataSource.query(`UPDATE report_doc SET build = $1::jsonb WHERE id = $2`, [JSON.stringify(build), id]);

/**
 * Writes a new draft when `rev` is current: rev + 1, title and the doc-level
 * columns from the draft. DS_VERSION_CONFLICT `{rev}` otherwise.
 */
export async function updateDraft(caller: StudioCaller, id: number, rev: number, draft: Row, extra: { title: string; dataHash?: string | null; build?: BuildProgress | null }): Promise<number> {
  const params: unknown[] = [JSON.stringify(draft), extra.title, draft.meta?.year, draft.meta?.yearType, draft.purpose, draft.format, caller.userId || null, id, caller.companyId, rev];
  let set = `draft = $1::jsonb, title = $2, year = $3, year_type = $4, purpose = $5, format = $6, updated_by = $7, rev = rev + 1, updated_at = now()`;
  if (extra.dataHash !== undefined) {
    params.push(extra.dataHash);
    set += `, data_hash = $${params.length}`;
  }
  if (extra.build !== undefined) {
    params.push(extra.build ? JSON.stringify(extra.build) : null);
    set += `, build = $${params.length}::jsonb`;
  }
  const res = await AppDataSource.query(`UPDATE report_doc SET ${set} WHERE id = $8 AND company_id = $9 AND rev = $10 AND deleted_at IS NULL RETURNING rev`, params);
  const rows: Row[] = Array.isArray(res[0]) ? res[0] : res;
  if (!rows.length) {
    const [cur]: Row[] = await AppDataSource.query(`SELECT rev FROM report_doc WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`, [id, caller.companyId]);
    if (!cur) throw new DsError("DS_DOC_NOT_FOUND");
    throw new DsError("DS_VERSION_CONFLICT", { rev: Number(cur.rev) });
  }
  return Number(rows[0].rev);
}

/** Soft delete; a doc with a final version can't be deleted (finals are immutable). */
export async function softDelete(caller: StudioCaller, row: DocRow): Promise<void> {
  const [f]: Row[] = await AppDataSource.query(`SELECT 1 FROM report_doc_version WHERE doc_id = $1 AND kind = 'final' LIMIT 1`, [row.id]);
  if (row.status === "final" || f) throw new DsError("DS_FINAL_IMMUTABLE");
  await AppDataSource.query(`UPDATE report_doc SET deleted_at = now(), updated_by = $1 WHERE id = $2 AND company_id = $3`, [caller.userId || null, row.id, caller.companyId]);
  await AppDataSource.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('report_doc', $1, 'delete', $2, NULL, $3)`,
    [row.id, JSON.stringify({ deleted: { old: false, new: true }, title: { old: row.title, new: row.title } }), caller.userId || null],
  );
}

// ---------------------------------------------------------------------------
// Versions (D16): autosaves every 10 minutes of editing, kept 90 days or the newest 200
// ---------------------------------------------------------------------------

export const AUTOSAVE_EVERY_MS = 10 * 60 * 1000;
export const AUTOSAVE_KEEP_DAYS = 90;
export const AUTOSAVE_KEEP_LAST = 200;

export async function addVersion(docId: number, kind: VersionKind, v: { doc: Row; rev: number; dataHash: string | null; designVersion: number | null; note?: string | null; userId: number }): Promise<number> {
  // n is unique per doc; two writers racing get a unique-violation retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [r]: Row[] = await AppDataSource.query(
        `INSERT INTO report_doc_version (doc_id, n, kind, rev, doc, data_hash, design_version, page_count, note, created_by)
         SELECT $1, COALESCE(MAX(n), 0) + 1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9 FROM report_doc_version WHERE doc_id = $1 RETURNING n`,
        [docId, kind, v.rev, JSON.stringify(v.doc), v.dataHash, v.designVersion, Array.isArray(v.doc.pages) ? v.doc.pages.length : null, v.note ?? null, v.userId || null],
      );
      return Number(r.n);
    } catch (err) {
      if ((err as { code?: string }).code !== "23505" || attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

/** Pure: whether an autosave is due, given the newest autosave's time. */
export const autosaveDue = (lastAt: Date | null, now: Date = new Date()) => !lastAt || now.getTime() - lastAt.getTime() >= AUTOSAVE_EVERY_MS;

/** Adds an `autosave` version when the newest is 10 minutes old (or none exists), then prunes. Returns its n, or null. */
export async function autosaveIfDue(docId: number, v: { doc: Row; rev: number; dataHash: string | null; designVersion: number | null; userId: number }): Promise<number | null> {
  const [last]: Row[] = await AppDataSource.query(`SELECT MAX(created_at) AS at FROM report_doc_version WHERE doc_id = $1 AND kind = 'autosave'`, [docId]);
  if (!autosaveDue(last?.at ? new Date(last.at) : null)) return null;
  const n = await addVersion(docId, "autosave", v);
  await pruneAutosaves(docId);
  return n;
}

/** Deletes autosaves older than 90 days that are not among the newest 200 (snapshots, review and final versions are never pruned). */
export const pruneAutosaves = (docId: number) =>
  AppDataSource.query(
    `DELETE FROM report_doc_version WHERE doc_id = $1 AND kind = 'autosave' AND created_at < now() - ($2 || ' days')::interval
       AND id NOT IN (SELECT id FROM report_doc_version WHERE doc_id = $1 AND kind = 'autosave' ORDER BY n DESC LIMIT $3)`,
    [docId, String(AUTOSAVE_KEEP_DAYS), AUTOSAVE_KEEP_LAST],
  );

// ---------------------------------------------------------------------------
// Presence (R15): best effort, in memory, per process
// ---------------------------------------------------------------------------

export const PRESENCE_TTL_MS = 45_000;
const seen = new Map<number, Map<number, number>>();

/** Records `userId` on `docId` and returns how many other users were seen in the last 45 s. */
export function presence(docId: number, userId: number, now = Date.now()): number {
  const users = seen.get(docId) ?? new Map<number, number>();
  seen.set(docId, users);
  users.set(userId, now);
  let others = 0;
  for (const [u, at] of users) {
    if (now - at > PRESENCE_TTL_MS) users.delete(u);
    else if (u !== userId) others++;
  }
  return others;
}
export const resetPresence = () => seen.forEach((_value, key) => seen.delete(key));
