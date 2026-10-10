import { Response, NextFunction } from "express";
import { AppDataSource } from "../config/data-source";
import { AuthRequest } from "./auth.middleware";
import { UserRole } from "../types/type";
import { accessibleSiteIds, resolveUserCompanyId, SITE_ACCESS_DENIED } from "../utils/companyScope";

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
const REVIEW_DENIED = { message: "Only a manager can approve or reject entries" };
const SELF_REVIEW = { message: "You can't approve or reject your own entries" };

/** People who review entries: Managers for their sites, Superadmins for any. */
const REVIEWER_ROLES = new Set<string>([UserRole.MANAGER, UserRole.SUPERADMIN]);

const allowedSites = (req: AuthRequest) => accessibleSiteIds(req.user?.userId, req.user?.role);

const toIds = (value: unknown): number[] => {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((v) => Number(String(v).trim())).filter((n) => Number.isInteger(n) && n > 0);
};

const forbidden = (res: Response) => res.status(403).json(SITE_ACCESS_DENIED);

/** Replace req.query (a getter in Express 5) with a patched copy. */
const patchQuery = (req: AuthRequest, patch: Record<string, string>) => {
  const query = { ...(req.query as Record<string, unknown>), ...patch };
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
    const allowed = await allowedSites(req);
    const id = Number(req.params[param]);
    if (allowed && !allowed.has(id)) return forbidden(res);
    next();
  });

/**
 * Site ids in the JSON body (`siteIds: number[]`, or a single `site_id`).
 * Foreign ids are refused; a missing list becomes the caller's own sites.
 */
export const guardBodySites = (field: "siteIds" | "site_id"): Guard =>
  wrap(async (req, res, next) => {
    const allowed = await allowedSites(req);
    if (!allowed) return next();
    req.body = req.body || {};
    const requested = toIds(req.body[field]);
    if (requested.some((id) => !allowed.has(id))) return forbidden(res);
    if (!requested.length && field === "siteIds") req.body.siteIds = [...allowed];
    next();
  });

/** Every `entries[].site_id` of a bulk body must be the caller's. */
export const guardBodyEntrySites: Guard = wrap(async (req, res, next) => {
  const allowed = await allowedSites(req);
  if (!allowed) return next();
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (entries.some((e: { site_id?: unknown }) => !allowed.has(Number(e?.site_id)))) return forbidden(res);
  next();
});

/**
 * Site ids in the query (`siteIds=1,2`, `siteId=1` or `site_id=1`). Foreign
 * ids are refused; when none is given the query is narrowed to the caller's
 * sites under `fillAs`.
 */
export const guardQuerySites = (fillAs?: "siteIds" | "siteId"): Guard =>
  wrap(async (req, res, next) => {
    const allowed = await allowedSites(req);
    if (!allowed) return next();
    const q = req.query as Record<string, unknown>;
    const requested = [...toIds(q.siteIds), ...toIds(q.siteId), ...toIds(q.site_id)];
    if (requested.some((id) => !allowed.has(id))) return forbidden(res);
    if (!requested.length && fillAs) {
      if (!allowed.size) return res.status(200).json(fillAs === "siteIds" ? [] : { data: [] });
      if (fillAs === "siteIds") patchQuery(req, { siteIds: [...allowed].join(",") });
      else if (allowed.size === 1) patchQuery(req, { siteId: String([...allowed][0]) });
      else return res.status(400).json({ message: "siteId is required" });
    }
    next();
  });

/** A company id in a path parameter must be the caller's company. */
export const guardCompanyParam = (param: string): Guard =>
  wrap(async (req, res, next) => {
    if (req.user?.role === UserRole.SUPERADMIN) return next();
    const own = await resolveUserCompanyId(req.user?.userId);
    if (!own || own !== Number(req.params[param])) return forbidden(res);
    next();
  });

type Table = { table: string; key: string };
const EMISSION: Table = { table: "emission", key: "pk_id" };
const PRODUCTION: Table = { table: "production_data", key: "production_id" };

async function rowsOf(t: Table, ids: number[]) {
  if (!ids.length) return [];
  return AppDataSource.query(
    `SELECT ${t.key} AS id, site_id, created_by FROM ${t.table} WHERE ${t.key} = ANY($1::int[])`,
    [ids]
  ) as Promise<{ id: number; site_id: number; created_by: number | null }[]>;
}

/**
 * Records named by `:param` or by `ids[]` in the body must sit on the
 * caller's sites. With `review`, the caller must also not be their creator.
 */
const guardRecords = (t: Table, from: { param?: string; bodyIds?: boolean }, review = false): Guard =>
  wrap(async (req, res, next) => {
    const ids = from.param ? toIds(req.params[from.param]) : toIds(req.body?.ids);
    if (!ids.length) return next(); // the handler reports the missing ids
    const rows = await rowsOf(t, ids);
    const allowed = await allowedSites(req);
    const visible = rows.filter((r) => !allowed || allowed.has(Number(r.site_id)));
    if (from.param && !visible.length) return res.status(404).json(NOT_FOUND);
    if (visible.length < rows.length) return forbidden(res);
    if (review && req.user?.role !== UserRole.SUPERADMIN && rows.some((r) => Number(r.created_by) === Number(req.user?.userId))) {
      return res.status(403).json(SELF_REVIEW);
    }
    next();
  });

export const guardEmissionParam = (param = "id") => guardRecords(EMISSION, { param });
export const guardEmissionIds = guardRecords(EMISSION, { bodyIds: true });
export const guardEmissionReview = (param = "id") => guardRecords(EMISSION, { param }, true);
export const guardEmissionIdsReview = guardRecords(EMISSION, { bodyIds: true }, true);
export const guardProductionParam = (param = "id") => guardRecords(PRODUCTION, { param });
export const guardProductionReview = (param = "id") => guardRecords(PRODUCTION, { param }, true);
export const guardProductionIdsReview = guardRecords(PRODUCTION, { bodyIds: true }, true);

/** Every row of an upload batch must be on the caller's sites. */
export const guardBatch = (review = false): Guard =>
  wrap(async (req, res, next) => {
    const rows: { site_id: number; created_by: number | null }[] = await AppDataSource.query(
      `SELECT site_id, created_by FROM emission WHERE upload_batch_id = $1`,
      [String(req.params.batchId)]
    );
    const allowed = await allowedSites(req);
    if (!rows.length || (allowed && rows.every((r) => !allowed.has(Number(r.site_id))))) {
      return res.status(404).json(NOT_FOUND);
    }
    if (allowed && rows.some((r) => !allowed.has(Number(r.site_id)))) return forbidden(res);
    if (review && req.user?.role !== UserRole.SUPERADMIN && rows.some((r) => Number(r.created_by) === Number(req.user?.userId))) {
      return res.status(403).json(SELF_REVIEW);
    }
    next();
  });

const AUDITED: Record<string, Table> = { emission: EMISSION, production_data: PRODUCTION };

/** Audit history is readable only for records on the caller's sites. */
export const guardAuditEntity: Guard = wrap(async (req, res, next) => {
  const q = req.query as Record<string, unknown>;
  const table = AUDITED[String(q.entity_type)];
  if (!table) return next(); // handler validates entity_type
  const [row] = await rowsOf(table, toIds(q.entity_id));
  const allowed = await allowedSites(req);
  if (allowed && (!row || !allowed.has(Number(row.site_id)))) return res.status(404).json(NOT_FOUND);
  next();
});
