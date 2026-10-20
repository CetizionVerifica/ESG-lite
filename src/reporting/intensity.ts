/**
 * Emissions intensity per unit of production, by site and month: the EDE
 * report's `intensityMonthly` (POST /user/reports/ede). Extracted unchanged
 * from `getEdeReport` in emission.controller.ts (DS-2) so the Design Studio's
 * `intensity_output` binding reads the same figures; the controller calls
 * `loadIntensityMonthly` and its output is byte-identical (ci/golden
 * snapshot, "EDE … (DS-2 intensity extraction)").
 *
 *   loadIntensityMonthly(base, siteIds, range)
 *     base     the caller's approved-emission query (alias `emission`, joined
 *              `site` and `category`, already filtered by status, sites,
 *              categories and dates); it is cloned, never changed
 *     returns  one row per site and month with emissions: emissions (tCO₂e,
 *              Scope 1 + 2 + 3), approved production overlapping the month
 *              (grouped by the month of its start date), intensity
 *              (emissions / production, 6 dp; 0 without production) and the
 *              production unit ("unit" when none)
 *   monthlyIntensity(emissionRows, productionRows)   the pure join of the two
 */
import type { SelectQueryBuilder } from "typeorm";
import { AppDataSource } from "../config/data-source";
import type { Emission } from "../entities/Emission";
import { ProductionData, ProductionDataStatus } from "../entities/ProductionData";

export interface IntensityMonth {
  siteId: number;
  siteName: string;
  month: string;
  emissions: number;
  production: number;
  intensity: number;
  unit: string;
}

type Row = Record<string, any>;

/** Pure: emissions per site-month joined to production per site-month. */
export function monthlyIntensity(intensityEmissionsRaw: Row[], monthlyProductionRaw: Row[]): IntensityMonth[] {
  const productionBySiteMonth = new Map<string, { production: number; unit: string }>();

  monthlyProductionRaw.forEach((r) => {
    const key = `${Number(r.siteId)}|${String(r.month)}`;
    productionBySiteMonth.set(key, {
      production: Number(r.production) || 0,
      unit: String(r.unit || "unit"),
    });
  });

  return intensityEmissionsRaw.map((r) => {
    const siteId = Number(r.siteId);
    const siteName = String(r.siteName);
    const month = String(r.month);
    const emissions = Number(r.emissions) || 0;

    const key = `${siteId}|${month}`;
    const prod = productionBySiteMonth.get(key);

    const production = prod?.production || 0;
    const unit = prod?.unit || "unit";

    const intensity = production > 0 ? Number((emissions / production).toFixed(6)) : 0;

    return {
      siteId,
      siteName,
      month,
      emissions,
      production,
      intensity,
      unit,
    };
  });
}

/** Approved production per site and month (start-date month) overlapping the range. */
export async function loadMonthlyProduction(siteIds: number[], range: { startDate: Date; endDate: Date }): Promise<Row[]> {
  const prodRepo = AppDataSource.getRepository(ProductionData);
  return prodRepo
    .createQueryBuilder("pd")
    .leftJoin("pd.site", "site")
    .select([
      `to_char(date_trunc('month', pd.start_date), 'YYYY-MM') AS "month"`,
      `site.site_id AS "siteId"`,
      `site.name AS "siteName"`,
      `COALESCE(SUM(pd.quantity), 0) AS "production"`,
      `MAX(pd.unit) AS "unit"`,
    ])
    .where("pd.status = :status", { status: ProductionDataStatus.APPROVED })
    .andWhere("site.site_id IN (:...siteIds)", { siteIds })
    .andWhere("pd.start_date <= :endDate AND pd.end_date >= :startDate", {
      startDate: range.startDate,
      endDate: range.endDate,
    })
    .groupBy(`to_char(date_trunc('month', pd.start_date), 'YYYY-MM')`)
    .addGroupBy("site.site_id")
    .addGroupBy("site.name")
    .orderBy(`to_char(date_trunc('month', pd.start_date), 'YYYY-MM')`, "ASC")
    .addOrderBy("site.name", "ASC")
    .getRawMany();
}

/** Scope 1 + 2 + 3 emissions per site and month from the caller's approved-emission query. */
export async function loadMonthlyEmissions(base: SelectQueryBuilder<Emission>): Promise<Row[]> {
  return base
    .clone()
    .select([
      `to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM') AS "month"`,
      `site.site_id AS "siteId"`,
      `site.name AS "siteName"`,
      `
      COALESCE(
        SUM(
          CASE
            WHEN category.scope IN ('Scope 1','Scope 2','Scope 3')
            THEN emission.total_emission
            ELSE 0
          END
        ),
      0) AS "emissions"
    `,
    ])
    .groupBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`)
    .addGroupBy("site.site_id")
    .addGroupBy("site.name")
    .orderBy(`to_char(date_trunc('month', emission.date_of_reporting), 'YYYY-MM')`, "ASC")
    .addOrderBy("site.name", "ASC")
    .getRawMany();
}

/** The EDE `intensityMonthly` for an approved-emission query and its sites and dates. */
export async function loadIntensityMonthly(
  base: SelectQueryBuilder<Emission>,
  siteIds: number[],
  range: { startDate: Date; endDate: Date },
): Promise<IntensityMonth[]> {
  const intensityEmissionsRaw = await loadMonthlyEmissions(base);
  const monthlyProductionRaw = await loadMonthlyProduction(siteIds, range);
  return monthlyIntensity(intensityEmissionsRaw, monthlyProductionRaw);
}
