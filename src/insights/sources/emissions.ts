/**
 * IN-1 · emission figures for Insights, read through the function behind
 * GET /manager/overview (`computeManagerOverview`, extracted unchanged into
 * src/services/managerOverview.service.ts). Approved rows only, the Overview's
 * rules: net = Scope 1 + 2 + 3 − saved (null-scope rows), yearly batches count
 * for a whole year of their own type, tCO₂e rounded to 3 decimals.
 *
 *   overview(scope, period?)   the whole Overview body for a CY/FY of the scope's sites
 *   netGross(scope, period?)   {gross, net, saved, scope_1, scope_2, scope_3}
 *   byScope / bySite / byCategory / monthly(scope, period?)
 *   pendingCount(scope)        pending entries as the approvals list counts them
 *                              (kpis.pending_review_count)
 *   netByYear(scope, years)    net per reporting year (for series panels)
 *
 * Nothing here adds or divides a figure: it picks fields out of the Overview.
 */
import { computeManagerOverview, parseOverviewPeriod } from "../../services/managerOverview.service";
import type { Period } from "../contracts/enums";
import { once, overviewKey, type InsightsScope } from "../scope";

export type Overview = Awaited<ReturnType<typeof computeManagerOverview>>;

export const overview = (scope: InsightsScope, period: Period = scope.period): Promise<Overview> =>
  once(scope, `overview:${overviewKey(period)}`, () =>
    computeManagerOverview({ period: parseOverviewPeriod(overviewKey(period))!, siteIds: scope.siteIds, managed: scope.siteNames, categoryIds: [] }),
  );

export const netGross = async (scope: InsightsScope, period?: Period) => {
  const k = (await overview(scope, period)).kpis;
  return { gross: k.gross, net: k.net, saved: k.saved, scope_1: k.scope_1, scope_2: k.scope_2, scope_3: k.scope_3 };
};

export const byScope = async (scope: InsightsScope, period?: Period) => (await overview(scope, period)).by_scope;
export const bySite = async (scope: InsightsScope, period?: Period) => (await overview(scope, period)).by_site;
export const byCategory = async (scope: InsightsScope, period?: Period) => (await overview(scope, period)).by_category;
/** Approved monthly entries per month of the period (yearly batches left out, as Overview's by_month). */
export const monthly = async (scope: InsightsScope, period?: Period) => (await overview(scope, period)).by_month;
export const pendingCount = async (scope: InsightsScope, period?: Period) => (await overview(scope, period)).kpis.pending_review_count;

/** Net per reporting year; null for a year with no approved entry counted (missing, never 0). */
export async function netByYear(scope: InsightsScope, years: number[]): Promise<Array<number | null>> {
  const out: Array<number | null> = [];
  for (const year of years) {
    const o = await overview(scope, { year, yearType: scope.period.yearType });
    out.push(o.kpis.approved_count > 0 ? o.kpis.net : null);
  }
  return out;
}

/** Scope 1, 2 and 3 per reporting year (null when the year has no approved entry). */
export async function scopesByYear(scope: InsightsScope, years: number[]) {
  const out: Array<{ year: number; scope_1: number; scope_2: number; scope_3: number; net: number; saved: number } | null> = [];
  for (const year of years) {
    const o = await overview(scope, { year, yearType: scope.period.yearType });
    out.push(o.kpis.approved_count > 0 ? { year, scope_1: o.kpis.scope_1, scope_2: o.kpis.scope_2, scope_3: o.kpis.scope_3, net: o.kpis.net, saved: o.kpis.saved } : null);
  }
  return out;
}
