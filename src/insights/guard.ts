/**
 * IN-0 · the Insights switch and the caller's context (layer rule 1, I1, I2).
 *
 *   insightsCompanyFor(req)  which company a request is about, decided as the
 *                            KPI guard does (kpiCompanyFor): a Superadmin names
 *                            `company_id` (query or body; 400 IN_COMPANY_REQUIRED
 *                            without it); everyone else gets their own company,
 *                            and a `company_id` naming another one answers 404
 *                            IN_SITE_NOT_FOUND, like an id that doesn't exist.
 *   requireInsights          403 IN_OFF while `company.insights_enabled` is off,
 *                            then 403 IN_FORBIDDEN for Users (I1). Sets
 *                            `req.insights`. Applied to the whole /insights
 *                            router after GET /status.
 *   insightsScope(req)       the context requireInsights set:
 *                            {companyId, userId, role, siteIds, allSites, kpiOn}.
 *                            `siteIds` are the company's sites the caller may
 *                            read (a Manager's own; every site for an Admin or
 *                            Superadmin), sorted. IN-1's scope.ts narrows them
 *                            with the `sites` query (404 IN_SITE_NOT_FOUND).
 *   insightsStatus           GET /insights/status → {enabled, kpi_tracking};
 *                            any role of the company, answers while off (nav).
 */
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../middlewares/auth.middleware";
import { AppDataSource } from "../config/data-source";
import { callerSites, kpiCompanyFor, kpiTrackingEnabled } from "../kpi/guard";
import { KpiError } from "../kpi/contracts/errors";
import { INSIGHTS_ROLES } from "./contracts/enums";
import { InError } from "./contracts/errors";
import type { InsightsStatus } from "./contracts/panels";
import { handle } from "./http";

export interface InsightsCaller {
  companyId: number;
  userId: number;
  role: string;
  /** The company's sites the caller may read, sorted. */
  siteIds: number[];
  /** The caller reaches every site of the company (Admin, Superadmin, or a Manager of all of them). */
  allSites: boolean;
  /** KPI tracking is on: KPI panels answer `availability: 'kpi_off'` otherwise. */
  kpiOn: boolean;
}

export type InsightsRequest = AuthRequest & { insights?: InsightsCaller };

/** kpiCompanyFor with IN codes: KPI_COMPANY_REQUIRED → IN_COMPANY_REQUIRED, KPI_NOT_FOUND → IN_SITE_NOT_FOUND. */
export async function insightsCompanyFor(req: AuthRequest): Promise<number> {
  try {
    return await kpiCompanyFor(req);
  } catch (err) {
    if (err instanceof KpiError) throw new InError(err.code === "KPI_COMPANY_REQUIRED" ? "IN_COMPANY_REQUIRED" : "IN_SITE_NOT_FOUND");
    throw err;
  }
}

export const insightsEnabled = async (companyId: number): Promise<boolean> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT insights_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows[0]?.on === true;
};

export const isInsightsRole = (role: string) => (INSIGHTS_ROLES as readonly string[]).includes(role);

const companySiteIds = async (companyId: number): Promise<number[]> => {
  const rows: Array<{ site_id: number }> = await AppDataSource.query(`SELECT site_id FROM site WHERE company_id = $1 ORDER BY site_id`, [companyId]);
  return rows.map((r) => Number(r.site_id));
};

const fail = (req: AuthRequest, res: Response, err: unknown) => {
  if (err instanceof InError) return res.status(err.status).json(err.toBody());
  console.error(`[insights] guard failed (user ${req.user?.userId}):`, (err as Error)?.message);
  return res.status(500).json({ message: "Internal server error" });
};

export const requireInsights = async (req: InsightsRequest, res: Response, next: NextFunction) => {
  try {
    const companyId = await insightsCompanyFor(req);
    if (!(await insightsEnabled(companyId))) throw new InError("IN_OFF");
    const role = String(req.user?.role ?? "");
    if (!isInsightsRole(role)) throw new InError("IN_FORBIDDEN");
    const userId = Number(req.user?.userId) || 0;
    const all = await companySiteIds(companyId);
    const mine = await callerSites(userId, role, companyId);
    const siteIds = mine === null ? all : all.filter((id) => mine.has(id));
    req.insights = { companyId, userId, role, siteIds, allSites: siteIds.length === all.length, kpiOn: await kpiTrackingEnabled(companyId) };
    next();
  } catch (err) {
    return fail(req, res, err);
  }
};

/** The context requireInsights set (routes behind the guard only). */
export const insightsScope = (req: InsightsRequest): InsightsCaller => {
  if (!req.insights) throw new Error("requireInsights did not run");
  return req.insights;
};

/** GET /insights/status: any role of the company (Users too, so the nav can hide itself); answers when off. */
export const insightsStatus = handle("status", async (req, res) => {
  const companyId = await insightsCompanyFor(req);
  const enabled = await insightsEnabled(companyId);
  const body: InsightsStatus = { enabled, kpi_tracking: await kpiTrackingEnabled(companyId) };
  res.json(body);
});
