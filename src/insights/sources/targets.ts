/**
 * IN-1 · targets for Insights.
 *
 *   sbtiSetup(scope)      the company's SBTi set-up: base year from `company_base_year` (the
 *                         S3-14 base year; Targets defaults to it), the near-term target year
 *                         (2030 kept 5–10 years from the base, SBTi near-term rule; else base + 10)
 *                         and the 1.5 °C rate 4.2 %/yr. null when no base year is set.
 *   sbtiNearTerm(scope)   POST /user/targets/tables for those inputs (`computeNearTermTables`,
 *                         extracted unchanged into src/services/sbtiTargets.service.ts); null
 *                         when it has nothing (no approved emissions in the base year).
 *   sbtiLongTerm(scope)   POST /user/targets/long-term-chart the same way.
 *   sbtiStatus(scope)     the period year's actual vs pathway row (table3) with the I6 status
 *                         (derive `pathwayStatus`); null without a set-up.
 *   kpiTargets(scope)     KPI-9's `targetsWithProgress` for the scope's sites (KPI on and set
 *                         up only; else []).
 */
import { AppDataSource } from "../../config/data-source";
import { setupCompleted } from "../../kpi/setup/settings";
import { targetsWithProgress } from "../../kpi/targets/service";
import { computeLongTermChart, computeNearTermTables, SbtiInputError } from "../../services/sbtiTargets.service";
import type { TargetStatus } from "../contracts/enums";
import { expectedProgress, pathwayStatus, targetStatus } from "../derive";
import { kpiCallerOf, once, type InsightsScope } from "../scope";

export const SBTI_RATE = 0.042;
export const SBTI_TARGET_YEAR = 2030;

export interface SbtiSetup {
  base_year: number;
  target_year: number;
  annual_rate: number;
}

/** The near-term target year for a base year: 2030 when 5–10 years away, else the nearest edge. */
export const nearTermTargetYear = (base: number): number => Math.min(base + 10, Math.max(base + 5, SBTI_TARGET_YEAR));

export const sbtiSetup = (scope: InsightsScope): Promise<SbtiSetup | null> =>
  once(scope, "sbti-setup", async () => {
    const rows: Array<{ base_year: number }> = await AppDataSource.query(
      `SELECT base_year FROM company_base_year WHERE company_id = $1 ORDER BY (scope = 'Scope 3') DESC, id LIMIT 1`,
      [scope.companyId],
    );
    if (!rows.length) return null;
    const base = Number(rows[0].base_year);
    return { base_year: base, target_year: nearTermTargetYear(base), annual_rate: SBTI_RATE };
  });

const orNull = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SbtiInputError) return null;
    throw err;
  }
};

export type NearTerm = Awaited<ReturnType<typeof computeNearTermTables>>;
export type LongTerm = Awaited<ReturnType<typeof computeLongTermChart>>;

export const sbtiNearTerm = (scope: InsightsScope): Promise<NearTerm | null> =>
  once(scope, "sbti-near", async () => {
    const setup = await sbtiSetup(scope);
    if (!setup || !scope.siteIds.length) return null;
    return orNull(() => computeNearTermTables({ siteIds: scope.siteIds, baseYear: setup.base_year, targetYear: setup.target_year, annualRate: setup.annual_rate }));
  });

export const sbtiLongTerm = (scope: InsightsScope): Promise<LongTerm | null> =>
  once(scope, "sbti-long", async () => {
    const setup = await sbtiSetup(scope);
    if (!setup || !scope.siteIds.length) return null;
    return orNull(() => computeLongTermChart({ siteIds: scope.siteIds, baseYear: setup.base_year }));
  });

export interface SbtiStatus {
  status: TargetStatus;
  /** (actual − pathway) ÷ pathway × 100 for the year; null without actual data. */
  gap_pct: number | null;
  target_year: number;
  base_year: number;
  year: number;
  actual: number | null;
  pathway: number | null;
}

/** The SBTi pathway status for the period's year (calendar years, as the Targets page). */
export const sbtiStatus = (scope: InsightsScope): Promise<SbtiStatus | null> =>
  once(scope, "sbti-status", async () => {
    const setup = await sbtiSetup(scope);
    if (!setup) return null;
    const near = await sbtiNearTerm(scope);
    const year = scope.period.year;
    const row = near?.tables.table3.find((r) => r.year === year);
    const hasData = !!row && row.status !== "No Data";
    const s = pathwayStatus(hasData ? row!.actualTotal : null, row ? row.targetTotal : null);
    return { ...s, target_year: setup.target_year, base_year: setup.base_year, year, actual: hasData ? row!.actualTotal : null, pathway: row ? row.targetTotal : null };
  });

export type KpiTargetRow = Awaited<ReturnType<typeof targetsWithProgress>>[number];

export const kpiTargets = (scope: InsightsScope): Promise<KpiTargetRow[]> =>
  once(scope, "kpi-targets", async () => {
    if (!scope.kpiOn || !(await setupCompleted(AppDataSource.manager, scope.companyId))) return [];
    return targetsWithProgress(AppDataSource.manager, kpiCallerOf(scope), {});
  });

/**
 * KPI targets with their I6 status (summary and target wall): expected = the straight line at
 * today; progress = KPI-9's progress_pct; a target KPI-9 calls achieved is `reached`; a
 * `maintain` target is on_track or off_track by KPI-9's ±5 % band.
 */
export const kpiTargetStatuses = (scope: InsightsScope): Promise<Array<{ target: KpiTargetRow; expected: number | null; progress: number | null; status: TargetStatus }>> =>
  once(scope, "kpi-target-statuses", async () =>
    (await kpiTargets(scope)).map((t) => {
      const expected = expectedProgress(Number(t.baseline_year), Number(t.target_year), new Date().toISOString().slice(0, 10));
      const progress = t.direction === "maintain" ? (t.progress.status === "no_data" ? null : t.progress.on_track ? 100 : 0) : t.progress.progress_pct;
      const status =
        t.direction === "maintain"
          ? t.progress.status === "no_data"
            ? "no_data"
            : t.progress.on_track
              ? "on_track"
              : "off_track"
          : t.progress.achieved
            ? "reached"
            : targetStatus(progress, expected);
      return { target: t, expected, progress, status };
    }),
  );
