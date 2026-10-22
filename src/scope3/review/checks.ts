/**
 * S3-15 review checks (docs/scope3/01-contracts.md §8): pure, no database.
 * `service.ts` loads the context for a set of rows and stores the result on
 * `emission.checks`; the approvals list splits pending rows into "Ready" and
 * "Needs attention" on it.
 */
import { CHECK_IDS, type CheckId, type RowChecks } from "../contracts/checks";
import { canonicalUnit, getConversionFactor } from "../../services/emissionWrite/units";
import { targetYearFor } from "../../services/emissionWrite/resolve";

export interface CheckRow {
  date_of_reporting: string | Date;
  reporting_period: "monthly" | "yearly";
  activity_data_unit: string | null;
  emission_factor_snapshot: { year: number; denominator_unit: string } | null;
}

export interface CheckContext {
  /** An emission_document is linked to the row or to its FERA partner. */
  hasEvidence: boolean;
  /** Another non-rejected row with the same site, category, date and activity identity. */
  duplicateOf: number | null;
  /** Company change limit in percent (emission_threshold, default 5). */
  thresholdPct: number;
  /** Sum of the activity's non-rejected rows in the row's month (same site, category, emission_category). */
  monthTotal: number | null;
  /** The same sum for the previous month; null or 0 when there is nothing to compare with. */
  previousMonthTotal: number | null;
  /** The XI5 attention rule matched (low-confidence or edited smart-import row). */
  importNeedsAttention: boolean;
  /**
   * For a row saved before factor snapshots existed (a total but no snapshot): the site's factor
   * library has a factor for the row's target year and activity. A row with no snapshot and no
   * total had no factor applied and stays held. Ignored when the row has a snapshot (F-15).
   */
  factorInLibrary?: boolean;
}

export const DEFAULT_THRESHOLD_PCT = 5;

/** Percent change from the previous month, or null when there is no previous month to compare with. */
export const monthChangePct = (monthTotal: number | null, previousMonthTotal: number | null): number | null => {
  if (monthTotal === null || previousMonthTotal === null || !(previousMonthTotal > 0)) return null;
  return (Math.abs(monthTotal - previousMonthTotal) / previousMonthTotal) * 100;
};

const passes: Record<CheckId, (row: CheckRow, ctx: CheckContext) => boolean> = {
  // The snapshot factor is for the row's target year: no factor, or an older year's (FACTOR_FALLBACK_YEAR), holds it.
  // A row saved before snapshots existed has none; the factor library decides for it (F-15).
  FACTOR_FOUND: (row, ctx) =>
    row.emission_factor_snapshot
      ? Number(row.emission_factor_snapshot.year) === targetYearFor(row.date_of_reporting)
      : ctx.factorInLibrary === true,
  // A unit is given and matches or converts to the factor's unit. Without a factor only the unit's presence counts.
  UNIT_OK: (row) => {
    const unit = (row.activity_data_unit ?? "").trim();
    if (!unit) return false;
    const factorUnit = row.emission_factor_snapshot?.denominator_unit;
    if (!factorUnit) return true;
    return canonicalUnit(unit) === canonicalUnit(factorUnit) || getConversionFactor(unit, factorUnit) !== null;
  },
  EVIDENCE_ATTACHED: (_row, ctx) => ctx.hasEvidence,
  // Yearly rows and activities with no previous month pass.
  WITHIN_THRESHOLD: (row, ctx) => {
    if (row.reporting_period !== "monthly") return true;
    const change = monthChangePct(ctx.monthTotal, ctx.previousMonthTotal);
    return change === null || change <= ctx.thresholdPct;
  },
  NO_DUPLICATE: (_row, ctx) => ctx.duplicateOf === null,
  IMPORT_MATCH_SURE: (_row, ctx) => !ctx.importNeedsAttention,
  // Not applicable until S3-3 stores method and DQ on rows.
  METHOD_GIVEN: () => true,
  DQ_ACCEPTABLE: () => true,
};

export const computeChecks = (row: CheckRow, ctx: CheckContext): RowChecks => {
  const held = CHECK_IDS.filter((id) => !passes[id](row, ctx));
  return { ready: held.length === 0, held };
};
