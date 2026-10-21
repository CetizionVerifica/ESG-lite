/**
 * IN-1 · KPI figures for Insights, read through the KPI services unchanged
 * (approved values only, KPI D14):
 *
 *   esg(scope)        GET /kpi/esg's body (`src/kpi/esg/service.ts`) for the period year and the
 *                     scope's sites; `pillar` narrows trends, movers and pending as there.
 *   dashboard(scope)  GET /kpi/dashboard's body (`src/kpi/dashboard/service.ts`): coverage per
 *                     framework, gaps, cards, pending_not_in.
 *   coverage / gaps   picked out of `dashboard`.
 *
 * Each answers null when KPI tracking is off or KPI setup isn't finished
 * (the services' 409 KPI_SETUP_INCOMPLETE): KPI panels show `kpi_off` or
 * `setup_incomplete` instead. The year is read in the company's KPI year type
 * (as /kpi/esg does), with the period's year number.
 */
import { AppDataSource } from "../../config/data-source";
import { dashboard as kpiDashboard } from "../../kpi/dashboard/service";
import { esg as kpiEsg } from "../../kpi/esg/service";
import { setupCompleted } from "../../kpi/setup/settings";
import { kpiCallerOf, once, type InsightsScope } from "../scope";

export type Esg = Awaited<ReturnType<typeof kpiEsg>>;
export type KpiDashboard = Awaited<ReturnType<typeof kpiDashboard>>;

export const kpiSetupDone = (scope: InsightsScope): Promise<boolean> =>
  once(scope, "kpi-setup", () => (scope.kpiOn ? setupCompleted(AppDataSource.manager, scope.companyId) : Promise.resolve(false)));

export const esg = (scope: InsightsScope, year: number = scope.period.year): Promise<Esg | null> =>
  once(scope, `esg:${year}:${scope.query.pillar ?? ""}`, async () => {
    if (!(await kpiSetupDone(scope)) || !scope.siteIds.length) return null;
    return kpiEsg(kpiCallerOf(scope), { year, ...(scope.query.pillar ? { pillar: scope.query.pillar } : {}) });
  });

export const dashboard = (scope: InsightsScope, year: number = scope.period.year): Promise<KpiDashboard | null> =>
  once(scope, `kpi-dashboard:${year}`, async () => {
    if (!(await kpiSetupDone(scope)) || !scope.siteIds.length) return null;
    return kpiDashboard(kpiCallerOf(scope), { year });
  });

export const coverage = async (scope: InsightsScope) => (await dashboard(scope))?.coverage ?? null;
export const gaps = async (scope: InsightsScope) => (await dashboard(scope))?.gaps ?? null;
