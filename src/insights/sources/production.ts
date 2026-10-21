/**
 * IN-1 · production and emission intensity for Insights, read through the
 * function behind GET /user/emission-intensity/comparison
 * (`emissionIntensityComparison`, extracted unchanged into
 * src/services/emissionIntensity.service.ts): per site, approved emissions with
 * a scope dated in the range over approved production overlapping it.
 *
 *   intensityBySite(scope, period?)  [{siteId, totalEmissions, totalProduction, emissionIntensity}]
 *   productionUnits(scope, period?)  [{site_id, unit}] of the approved production in the range
 *   outputBySiteYear(scope, years)   per year and site: production and its unit
 *   pendingProduction(scope)         production rows of the period waiting for approval
 *
 * The combined intensity (Σ emissions ÷ Σ production, and whether units mix)
 * is a new figure, so it lives in derive/ (`combinedIntensity`).
 */
import { AppDataSource } from "../../config/data-source";
import { emissionIntensityComparison } from "../../services/emissionIntensity.service";
import type { Period } from "../contracts/enums";
import { once, periodRange, type InsightsScope } from "../scope";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export type SiteIntensity = Awaited<ReturnType<typeof emissionIntensityComparison>>[number];

export const intensityBySite = (scope: InsightsScope, period: Period = scope.period): Promise<SiteIntensity[]> => {
  const r = periodRange(period);
  return once(scope, `intensity:${r.start}`, () => (scope.siteIds.length ? emissionIntensityComparison(scope.siteIds, { startDate: day(r.start), endDate: day(r.end) }) : Promise.resolve([])));
};

export const productionUnits = (scope: InsightsScope, period: Period = scope.period): Promise<Array<{ site_id: number; unit: string }>> => {
  const r = periodRange(period);
  return once(scope, `units:${r.start}`, async () =>
    scope.siteIds.length
      ? (
          await AppDataSource.query(
            `SELECT DISTINCT pd.site_id, pd.unit FROM production_data pd JOIN site s ON s.site_id = pd.site_id
              WHERE s.company_id = $1 AND pd.site_id = ANY($2::int[]) AND pd.status = 'approved' AND pd.start_date <= $4 AND pd.end_date >= $3
              ORDER BY pd.site_id, pd.unit`,
            [scope.companyId, scope.siteIds, r.start, r.end],
          )
        ).map((x: { site_id: number; unit: string }) => ({ site_id: Number(x.site_id), unit: String(x.unit) }))
      : [],
  );
};

/** Per year: each site's approved production (0 = none) and its unit(s). */
export async function outputBySiteYear(scope: InsightsScope, years: number[]) {
  const out: Array<{ year: number; sites: Array<{ site_id: number; production: number; emissions: number; units: string[] }> }> = [];
  for (const year of years) {
    const period: Period = { year, yearType: scope.period.yearType };
    const [rows, units] = await Promise.all([intensityBySite(scope, period), productionUnits(scope, period)]);
    out.push({
      year,
      sites: rows.map((r) => ({
        site_id: Number(r.siteId),
        production: r.totalProduction,
        emissions: r.totalEmissions,
        units: units.filter((u) => u.site_id === Number(r.siteId)).map((u) => u.unit),
      })),
    });
  }
  return out;
}

/** Production rows of the period waiting for approval on the scope's sites (the approvals queue's production part). */
export const pendingProduction = (scope: InsightsScope): Promise<number> =>
  once(scope, "pending-production", async () => {
    if (!scope.siteIds.length) return 0;
    const [row] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS n FROM production_data pd JOIN site s ON s.site_id = pd.site_id
        WHERE s.company_id = $1 AND pd.site_id = ANY($2::int[]) AND pd.status = 'pending' AND pd.start_date <= $4 AND pd.end_date >= $3`,
      [scope.companyId, scope.siteIds, scope.range.start, scope.range.end],
    );
    return Number(row?.n ?? 0);
  });
