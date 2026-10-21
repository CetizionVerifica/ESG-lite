/**
 * IN-1 · a panel request's scope (layer rule 1): the caller from requireInsights
 * plus the parsed query.
 *
 *   resolveScope(req, schema)  parses the query (400 IN_VALIDATION), narrows the
 *                              caller's sites with `sites` (a site outside them,
 *                              or another company's, → 404 IN_SITE_NOT_FOUND),
 *                              and works out the period's dates.
 *   periodRange(period)        CY 2026 = Jan–Dec 2026; FY 2026 = Apr 2025–Mar 2026
 *                              (the KPI convention, src/kpi/values/period.ts, so the
 *                              ESG figures and the emission figures read the same year).
 *   overviewKey(period)        the GET /manager/overview period for it ("2026", "FY2025-26").
 *   once(scope, key, load)     memoises a source call for the life of one request, so
 *                              panels that read the same overview twice query once.
 *   kpiCallerOf(scope)         the KpiCaller the KPI services take, limited to the
 *                              scope's sites.
 */
import type { ZodType } from "zod";
import { AppDataSource } from "../config/data-source";
import type { KpiCaller } from "../kpi/guard";
import { FY_START_MONTH } from "../reporting/ghg-data";
import type { Period, SiteFilter } from "./contracts/enums";
import { InError } from "./contracts/errors";
import { InsightsQuerySchema, type InsightsQuery } from "./contracts/schemas";
import { insightsScope, type InsightsCaller, type InsightsRequest } from "./guard";
import { parse } from "./http";

export interface InsightsScope<Q extends InsightsQuery = InsightsQuery> {
  caller: InsightsCaller;
  companyId: number;
  role: string;
  kpiOn: boolean;
  query: Q;
  period: Period;
  /** ISO dates, inclusive. */
  range: { start: string; end: string };
  /** The `sites` filter as asked ('all' or ids). */
  sites: SiteFilter;
  /** The sites read: the caller's, or the ones asked for. Sorted. */
  siteIds: number[];
  siteNames: Map<number, string>;
  /** "CY 2026 · All sites" */
  label: string;
  memo: Map<string, Promise<unknown>>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** CY: Jan–Dec of `year`; FY: the twelve months ending in `year` (Apr year−1 – Mar year). */
export const periodRange = (p: Period): { start: string; end: string } => {
  if (p.yearType === "CY") return { start: `${p.year}-01-01`, end: `${p.year}-12-31` };
  const endMonth = FY_START_MONTH - 1; // FY_START_MONTH is April: the FY ends in March
  return { start: `${p.year - 1}-${pad(FY_START_MONTH)}-01`, end: `${p.year}-${pad(endMonth)}-${pad(lastDay(p.year, endMonth))}` };
};

/** The /manager/overview `period` key for a CY or FY. */
export const overviewKey = (p: Period): string => (p.yearType === "CY" ? String(p.year) : `FY${p.year - 1}-${pad(p.year % 100)}`);

/** 'YYYY-MM' of every month of the period. */
export const periodMonths = (p: Period): string[] => {
  const { start } = periodRange(p);
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};

export const periodLabel = (p: Period, sites: SiteFilter, names: Map<number, string>): string => {
  const where = sites === "all" ? "All sites" : sites.length === 1 ? names.get(sites[0]) ?? "1 site" : `${sites.length} sites`;
  return `${p.yearType} ${p.year} · ${where}`;
};

export async function resolveScope<Q extends InsightsQuery = InsightsQuery>(req: InsightsRequest, schema: ZodType<Q> = InsightsQuerySchema as unknown as ZodType<Q>): Promise<InsightsScope<Q>> {
  const caller = insightsScope(req);
  const query = parse(schema, req.query ?? {});
  const sites = query.sites;
  if (sites !== "all" && sites.some((id) => !caller.siteIds.includes(id))) throw new InError("IN_SITE_NOT_FOUND");
  const siteIds = sites === "all" ? [...caller.siteIds] : [...sites];
  const rows: Array<{ site_id: number; name: string }> = siteIds.length
    ? await AppDataSource.query(`SELECT site_id, name FROM site WHERE company_id = $1 AND site_id = ANY($2::int[])`, [caller.companyId, siteIds])
    : [];
  const siteNames = new Map(rows.map((r) => [Number(r.site_id), String(r.name)]));
  const period: Period = { year: query.year, yearType: query.yearType };
  return {
    caller,
    companyId: caller.companyId,
    role: caller.role,
    kpiOn: caller.kpiOn,
    query,
    period,
    range: periodRange(period),
    sites,
    siteIds,
    siteNames,
    label: periodLabel(period, sites, siteNames),
    memo: new Map(),
  };
}

/** One call per key for the life of the request. */
export const once = <T>(scope: Pick<InsightsScope, "memo">, key: string, load: () => Promise<T>): Promise<T> => {
  if (!scope.memo.has(key)) scope.memo.set(key, load());
  return scope.memo.get(key) as Promise<T>;
};

/** The KPI services' caller, limited to the scope's sites (company-level KPIs stay in). */
export const kpiCallerOf = (scope: InsightsScope): KpiCaller => ({
  companyId: scope.companyId,
  userId: scope.caller.userId,
  role: scope.role,
  sites: new Set(scope.siteIds),
});

/** The same scope one or more years earlier (sources that read a series of years). */
export const shiftYear = (p: Period, by: number): Period => ({ year: p.year + by, yearType: p.yearType });
