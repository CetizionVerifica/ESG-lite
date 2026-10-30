import { Response, NextFunction } from "express";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "./auth.middleware";
import { UserRole } from "../types/type";
import { accessibleSiteIds, SITE_ACCESS_DENIED, userInCompany } from "../utils/companyScope";
import { strictId, strictIdList, strictIdsFrom } from "../utils/ids";

/**
 * Route guards that keep every /user/* request inside the caller's own
 * company and sites (audit findings F-01 and F-02). Handlers stay unchanged:
 * a guard either rejects the request or narrows it to the caller's sites.
 *
 * Not found and not yours look the same (404) for single records, so ids of
 * other clients' rows can't be probed.
 */

type Guard = (req: AuthRequest, res: Response, next: NextFunction) => unknown;

const NOT_FOUND = { message: "Not found" };
const INVALID_ID = { message: "Invalid id" };
const REVIEW_DENIED = { message: "Only a manager can approve or reject entries" };
const SELF_REVIEW = { message: "You can't approve or reject your own entries" };

/** People who review entries: Managers for their sites, Superadmins for any. */
const REVIEWER_ROLES = new Set<string>([UserRole.MANAGER, UserRole.SUPERADMIN]);

const allowedSites = (req: AuthRequest) => accessibleSiteIds(req.user?.userId, req.user?.role);

/** null when any id is malformed: the guard answers 400 (see utils/ids). */
const toIds = strictIdList;

const forbidden = (res: Response) => res.status(403).json(SITE_ACCESS_DENIED);
const invalidId = (res: Response) => res.status(400).json(INVALID_ID);

/** Replace req.query (a getter in Express 5) with a patched copy; an undefined value removes the key. */
const patchQuery = (req: AuthRequest, patch: Record<string, string | undefined>) => {
  const query: Record<string, unknown> = { ...(req.query as Record<string, unknown>), ...patch };
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete query[key];
  Object.defineProperty(req, "query", { value: query, writable: true, configurable: true, enumerable: true });
};

const wrap = (fn: Guard): Guard => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error("Scope guard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** Only Managers and Superadmins may approve, reject or manager-edit. */
export const requireReviewer: Guard = (req, res, next) => {
  if (!REVIEWER_ROLES.has(req.user?.role)) return res.status(403).json(REVIEW_DENIED);
  next();
};

/** Site ids in a path parameter (e.g. /site/:siteId) must be the caller's. */
export const guardSiteParam = (param: string): Guard =>
  wrap(async (req, res, next) => {
    const id = strictId(req.params[param]);
    if (id === null) return invalidId(res);
    const allowed = await allowedSites(req);
    if (allowed && !allowed.has(id)) return forbidden(res);
    next();
  });

/**
 * Site ids in the JSON body (`siteIds: number[]`, or a single `site_id`).
 * Foreign ids are refused; a missing list becomes the caller's own sites.
 */
export const guardBodySites = (field: "siteIds" | "site_id"): Guard =>
  wrap(async (req, res, next) => {
    req.body = req.body || {};
    const value = req.body[field];
    const requested = toIds(value);
    // site_id names one site ("1,2" is not an id).
    if (!requested || (field === "site_id" && requested.length > 1)) return invalidId(res);
    // The handler reads the ids checked here, as numbers, in the shape it was sent.
    if (requested.length) req.body[field] = field === "site_id" ? requested[0] : Array.isArray(value) ? requested : requested.join(",");
    const allowed = await allowedSites(req);
    if (!allowed) return next();
    if (requested.some((id) => !allowed.has(id))) return forbidden(res);
    if (!requested.length && field === "siteIds") req.body.siteIds = [...allowed];
    next();
  });

/** Every `entries[].site_id` of a bulk body must be the caller's. */
export const guardBodyEntrySites: Guard = wrap(async (req, res, next) => {
  const entries: Array<{ site_id?: unknown } | null> = Array.isArray(req.body?.entries) ? req.body.entries : [];
  // A missing site_id is the handler's to report (403 here for scoped callers); a malformed one is refused.
  const siteIds: Array<number | undefined> = [];
  for (const e of entries) {
    const ids = toIds(e?.site_id);
    if (!ids || ids.length > 1) return invalidId(res);
    if (e && ids.length) e.site_id = ids[0]; // the handler reads the id checked here
    siteIds.push(ids[0]);
  }
  const allowed = await allowedSites(req);
  if (!allowed) return next();
  if (siteIds.some((id) => id === undefined || !allowed.has(id))) return forbidden(res);
  next();
});

/**
 * Site ids in the query (`siteIds=1,2`, `siteId=1` or `site_id=1`). Foreign
 * ids are refused. Under `fillAs` the handler reads that key and lists every
 * site when it is missing or blank, so whenever it carries no checked id it is
 * filled: with the ids asked for under another key (`site_id=3`), or else with
 * the caller's sites. Blank and placeholder keys (`siteId=null`) are removed so
 * no handler reads them as a site.
 */
export const guardQuerySites = (fillAs?: "siteIds" | "siteId"): Guard =>
  wrap(async (req, res, next) => {
    const q = req.query as Record<string, unknown>;
    const patch: Record<string, string | undefined> = {};
    const requested: number[] = [];
    let filterOnFillKey = false;
    for (const key of ["siteIds", "siteId", "site_id"]) {
      const ids = toIds(q[key]);
      // siteId and site_id name one site ("1,2" is not an id).
      if (!ids || (key !== "siteIds" && ids.length > 1)) return invalidId(res);
      if (ids.length) patch[key] = ids.join(","); // the handler reads the ids checked here
      else if (fillAs && key in q) patch[key] = undefined;
      if (key === fillAs && ids.length) filterOnFillKey = true;
      requested.push(...ids);
    }
    if (Object.keys(patch).length) patchQuery(req, patch);
    const allowed = await allowedSites(req);
    if (!allowed) return next();
    if (requested.some((id) => !allowed.has(id))) return forbidden(res);
    if (fillAs && !filterOnFillKey) {
      const sites = requested.length ? [...new Set(requested)] : [...allowed];
      if (!sites.length) return res.status(200).json(fillAs === "siteIds" ? [] : { data: [] });
      if (fillAs === "siteIds") patchQuery(req, { siteIds: sites.join(",") });
      else if (sites.length === 1) patchQuery(req, { siteId: String(sites[0]) });
      else return res.status(400).json({ message: "siteId is required" });
    }
    next();
  });

/** A company id in a path parameter must be the caller's company. */
export const guardCompanyParam = (param: string): Guard =>
  wrap(async (req, res, next) => {
    const companyId = strictId(req.params[param]);
    if (companyId === null) return invalidId(res);
    if (req.user?.role === UserRole.SUPERADMIN) return next();
    // Any company the caller has a site in, not only their first site's (F-22, 22 Oct 2026).
    if (!(await userInCompany(req.user?.userId, companyId))) return forbidden(res);
    next();
  });

type Table = { table: string; key: string };
const EMISSION: Table = { table: "emission", key: "pk_id" };
const PRODUCTION: Table = { table: "production_data", key: "production_id" };

/** What the self-review rule needs to know about a row. `uploader_may_approve` is true only for an untouched row of a bulk upload. */
type ReviewFacts = { created_by: number | null; uploader_may_approve: boolean };
type ScopedRow = { id: number; site_id: number; status?: string } & ReviewFacts;

// A row of a bulk-upload batch (a plan with channel bulk_upload, or a batch
// with no plan: legacy bulk upload) that nobody edited after commit.
const UPLOADER_MAY_APPROVE = (alias: string) => `(${alias}.upload_batch_id IS NOT NULL
  AND COALESCE((${alias}.extra_data -> 'import' ->> 'edited') = 'true', false) = false
  AND COALESCE((SELECT ip.channel FROM import_plan ip WHERE ip.upload_batch_id = ${alias}.upload_batch_id LIMIT 1), 'bulk_upload') = 'bulk_upload')`;

async function rowsOf(t: Table, ids: number[]): Promise<ScopedRow[]> {
  if (!ids.length) return [];
  const may = t === EMISSION ? UPLOADER_MAY_APPROVE("e") : "false";
  return AppDataSource.query(
    `SELECT e.${t.key} AS id, e.site_id, e.created_by, e.status::text AS status, ${may} AS uploader_may_approve FROM ${t.table} e WHERE e.${t.key} = ANY($1::bigint[])`,
    [ids]
  );
}

/**
 * S3-15 part 2: a Draft belongs to whoever saved it. For anyone else (Manager,
 * Admin and Superadmin included) it doesn't exist: single-record routes answer
 * 404 and id lists drop it. A FERA twin carries its parent's status and
 * creator, so it follows the parent.
 */
const othersDraft = (req: AuthRequest, r: { status?: string; created_by: number | null }) =>
  r.status === "draft" && Number(r.created_by) !== Number(req.user?.userId);

/**
 * Nobody reviews their own entries (audit F-01/F-02). The one exception
 * (smart-import decision 6, Shyam 2026-10-14): the manager who uploaded a
 * bulk-upload file may APPROVE its rows, as long as nobody edited the row
 * after commit; the audit row then says "Approved by the uploader"
 * (audit.middleware). Rejecting their own rows, approving a row they or
 * anyone else edited, and rows of Claude or API batches stay blocked.
 */
type ReviewAction = "approve" | "reject";
const selfReview = (req: AuthRequest, rows: ReviewFacts[], action: ReviewAction) =>
  req.user?.role !== UserRole.SUPERADMIN &&
  rows.some((r) => Number(r.created_by) === Number(req.user?.userId) && !(action === "approve" && r.uploader_may_approve === true));

/**
 * Records named by `:param` or by `ids[]` in the body must sit on the
 * caller's sites. With `review`, the caller must also not be their creator
 * (uploaded rows excepted, see selfReview).
 */
const guardRecords = (t: Table, from: { param?: string; bodyIds?: boolean }, review: ReviewAction | false = false): Guard =>
  wrap(async (req, res, next) => {
    // A path names exactly one record ("7,8" is not an id).
    const ids = from.param ? strictIdsFrom(req.params[from.param], true) : toIds(req.body?.ids);
    // An id that isn't a positive whole number (e.g. "undefined", or "7x" in a
    // body list) names no record the guard could check: the handler would read
    // it differently (parseInt "7x" = 7), so the whole request is refused.
    if (!ids) return invalidId(res);
    if (!ids.length) return next(); // the handler reports the missing ids
    // The handler reads the ids checked here, as numbers.
    if (!from.param && Array.isArray(req.body?.ids)) req.body.ids = ids;
    let rows = await rowsOf(t, ids);
    if (t === EMISSION && rows.some((r) => othersDraft(req, r))) {
      if (from.param) return res.status(404).json(NOT_FOUND);
      // A list drops someone else's Draft as it drops an unknown id; nothing left reads as not found.
      const hidden = new Set(rows.filter((r) => othersDraft(req, r)).map((r) => Number(r.id)));
      const kept = ids.filter((id) => !hidden.has(id));
      if (!kept.length) return res.status(404).json(NOT_FOUND);
      req.body.ids = kept;
      rows = rows.filter((r) => !hidden.has(Number(r.id)));
    }
    const allowed = await allowedSites(req);
    const visible = rows.filter((r) => !allowed || allowed.has(Number(r.site_id)));
    if (from.param && !visible.length) return res.status(404).json(NOT_FOUND);
    if (visible.length < rows.length) return forbidden(res);
    if (review && selfReview(req, rows, review)) return res.status(403).json(SELF_REVIEW);
    next();
  });

export const guardEmissionParam = (param = "id") => guardRecords(EMISSION, { param });
export const guardEmissionIds = guardRecords(EMISSION, { bodyIds: true });
export const guardEmissionReview = (param = "id", action: ReviewAction = "reject") => guardRecords(EMISSION, { param }, action);
export const guardEmissionIdsReview = (action: ReviewAction = "reject") => guardRecords(EMISSION, { bodyIds: true }, action);
export const guardProductionParam = (param = "id") => guardRecords(PRODUCTION, { param });
export const guardProductionReview = (param = "id") => guardRecords(PRODUCTION, { param }, "reject");
export const guardProductionIdsReview = guardRecords(PRODUCTION, { bodyIds: true }, "reject");

/** Every row of an upload batch must be on the caller's sites. */
export const guardBatch = (review: ReviewAction | false = false): Guard =>
  wrap(async (req, res, next) => {
    const all: ({ site_id: number; status: string } & ReviewFacts)[] = await AppDataSource.query(
      `SELECT e.site_id, e.created_by, e.status::text AS status, ${UPLOADER_MAY_APPROVE("e")} AS uploader_may_approve FROM emission e WHERE e.upload_batch_id = $1`,
      [String(req.params.batchId)]
    );
    // S3-15 part 2: someone else's Draft in the batch doesn't exist for the caller (the handlers skip it too).
    const rows = all.filter((r) => !othersDraft(req, r));
    const allowed = await allowedSites(req);
    if (!rows.length || (allowed && rows.every((r) => !allowed.has(Number(r.site_id))))) {
      return res.status(404).json(NOT_FOUND);
    }
    if (allowed && rows.some((r) => !allowed.has(Number(r.site_id)))) return forbidden(res);
    if (review && selfReview(req, rows, review)) return res.status(403).json(SELF_REVIEW);
    next();
  });

const AUDITED: Record<string, Table> = { emission: EMISSION, production_data: PRODUCTION };

/** Audit history is readable only for records on the caller's sites. */
export const guardAuditEntity: Guard = wrap(async (req, res, next) => {
  const q = req.query as Record<string, unknown>;
  const table = AUDITED[String(q.entity_type)];
  if (!table) return next(); // handler validates entity_type
  // One record: the handler reads entity_id with parseInt, so "999,5" must not pass as 5.
  const entityIds = strictIdsFrom(q.entity_id, true);
  if (!entityIds) return invalidId(res);
  const [row] = await rowsOf(table, entityIds);
  const allowed = await allowedSites(req);
  if (allowed && (!row || !allowed.has(Number(row.site_id)))) return res.status(404).json(NOT_FOUND);
  if (table === EMISSION && row && othersDraft(req, row)) return res.status(404).json(NOT_FOUND);
  next();
});
