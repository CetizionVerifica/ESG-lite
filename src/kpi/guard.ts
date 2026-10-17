/**
 * KPI-1 · the switch and the caller's KPI context (layer rules 1–3).
 *
 *   kpiCompanyFor(req)   which company a request is about:
 *                          - Superadmin: `company_id` (query or body) is required and must exist;
 *                          - everyone else: their own company. A `company_id` naming a company
 *                            where they have no site answers 404, like an id that doesn't exist.
 *   requireKpiTracking   403 KPI_TRACKING_OFF when that company's switch is off; on, it sets
 *                        `req.kpi = {companyId, userId, role, sites}`. Applied to the whole /kpi
 *                        router except GET /kpi/status and /kpi/library/* (Superadmin).
 *   kpiStatus            GET /kpi/status → {enabled, setup_completed}; answers when off.
 */
import type { NextFunction, Response } from "express";
import { AppDataSource } from "../config/data-source";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { UserRole } from "../types/type";
import { accessibleSiteIds, resolveUserCompanyId } from "../utils/companyScope";
import { KpiError } from "./contracts/errors";
import { handle } from "./http";

export interface KpiCaller {
  companyId: number;
  userId: number;
  role: string;
  /** Site ids the caller may read; null = every site (Superadmin). */
  sites: Set<number> | null;
}

export type KpiRequest = AuthRequest & { kpi?: KpiCaller };

const toId = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

export async function kpiCompanyFor(req: AuthRequest): Promise<number> {
  const requested = toId((req.query as any)?.company_id ?? req.body?.company_id);
  if (Number.isNaN(requested)) throw new KpiError("KPI_NOT_FOUND");
  const role = req.user?.role;

  if (role === UserRole.SUPERADMIN) {
    if (requested === null) throw new KpiError("KPI_COMPANY_REQUIRED");
    const rows: unknown[] = await AppDataSource.query(`SELECT 1 FROM company WHERE company_id = $1`, [requested]);
    if (!rows.length) throw new KpiError("KPI_NOT_FOUND");
    return requested as number;
  }

  const userId = Number(req.user?.userId);
  if (requested === null) {
    const own = await resolveUserCompanyId(userId);
    if (!own) throw new KpiError("KPI_NOT_FOUND");
    return own;
  }
  // Internal accounts can have sites at several clients: any site of the requested company is enough.
  const sites = await accessibleSiteIds(userId, role);
  const ids = sites ? [...sites] : [];
  const rows: unknown[] = ids.length
    ? await AppDataSource.query(`SELECT 1 FROM site WHERE company_id = $1 AND site_id = ANY($2::int[]) LIMIT 1`, [requested, ids])
    : [];
  if (!rows.length) throw new KpiError("KPI_NOT_FOUND");
  return requested as number;
}

export const kpiTrackingEnabled = async (companyId: number): Promise<boolean> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT kpi_tracking_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows[0]?.on === true;
};

/** The caller's sites inside `companyId` (null = all of them, Superadmin). */
const callerSites = async (userId: number, role: string, companyId: number): Promise<Set<number> | null> => {
  const sites = await accessibleSiteIds(userId, role);
  if (!sites) return null;
  if (!sites.size) return sites;
  const rows: Array<{ site_id: number }> = await AppDataSource.query(`SELECT site_id FROM site WHERE company_id = $1 AND site_id = ANY($2::int[])`, [companyId, [...sites]]);
  return new Set(rows.map((r) => Number(r.site_id)));
};

export const requireKpiTracking = async (req: KpiRequest, res: Response, next: NextFunction) => {
  try {
    const companyId = await kpiCompanyFor(req);
    if (!(await kpiTrackingEnabled(companyId))) throw new KpiError("KPI_TRACKING_OFF");
    const userId = Number(req.user?.userId) || 0;
    const role = String(req.user?.role ?? "");
    req.kpi = { companyId, userId, role, sites: await callerSites(userId, role, companyId) };
    next();
  } catch (err) {
    if (err instanceof KpiError) return res.status(err.status).json(err.toBody());
    console.error(`[kpi] switch check failed (user ${req.user?.userId}):`, (err as Error)?.message);
    return res.status(500).json({ message: "Internal server error" });
  }
};

/** The context requireKpiTracking set (routes behind the guard only). */
export const kpiCaller = (req: KpiRequest): KpiCaller => {
  if (!req.kpi) throw new Error("requireKpiTracking did not run");
  return req.kpi;
};

/** Library routes: Superadmin only, whatever any client's switch says. */
export const requireKpiSuperadmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== UserRole.SUPERADMIN) return res.status(403).json(new KpiError("KPI_FORBIDDEN").toBody());
  next();
};

/** Whether the company finished KPI setup. TODO(KPI-3): read company_kpi_settings.setup_completed_at. */
export const kpiSetupCompleted = async (_companyId: number): Promise<boolean> => false;

/** GET /kpi/status: any role of the company; answers even when the switch is off. */
export const kpiStatus = handle("status", async (req, res) => {
  const companyId = await kpiCompanyFor(req);
  const enabled = await kpiTrackingEnabled(companyId);
  res.json({ enabled, setup_completed: enabled ? await kpiSetupCompleted(companyId) : false });
});
