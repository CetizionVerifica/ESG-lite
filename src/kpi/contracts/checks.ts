/**
 * KPI contracts (KPI-0) §5: review check ids. KPI-8 runs them and stores the
 * result in `kpi_value.checks`; a value is Ready when no check holds it.
 * `KPI_UNIT_CONVERTED` is informational and never holds a value.
 */
import { z } from "zod";

export const KPI_CHECK_IDS = [
  "KPI_EVIDENCE",
  "KPI_CHANGE_LIMIT",
  "KPI_BREAKDOWN_SUM",
  "KPI_UNIT_CONVERTED",
  "KPI_ESTIMATE",
  "KPI_AUTO_STALE",
] as const;
export const KpiCheckIdSchema = z.enum(KPI_CHECK_IDS);
export type KpiCheckId = z.infer<typeof KpiCheckIdSchema>;

/** When each check holds a value (§5), for code and logs; screen labels are in `labels.ts`. */
export const KPI_CHECK_RULES: Record<KpiCheckId, string> = {
  KPI_EVIDENCE: "No evidence on a KPI that needs it (BRSR Core, or the company's setting).",
  KPI_CHANGE_LIMIT: "Changes from the same period last year by more than the company's change limit.",
  KPI_BREAKDOWN_SUM: "The breakdown parts don't add up to the total (±0.5 %).",
  KPI_UNIT_CONVERTED: "Entered in a unit other than the canonical one (informational).",
  KPI_ESTIMATE: "Marked as an estimate.",
  KPI_AUTO_STALE: "An auto value whose source rows changed since it was read.",
};

/** Checks that never hold a value. */
export const KPI_INFO_CHECKS: readonly KpiCheckId[] = ["KPI_UNIT_CONVERTED"];

/** Breakdown parts may differ from the total by this fraction (±0.5 %). */
export const BREAKDOWN_TOLERANCE = 0.005;

/** `kpi_value.checks` (KPI-8). */
export const KpiValueChecksSchema = z.object({
  ready: z.boolean(),
  held: z.array(KpiCheckIdSchema),
  info: z.array(KpiCheckIdSchema).optional(),
  /**
   * What a held check found, for the reason chips ("3× last September"):
   * KPI_CHANGE_LIMIT `{previous, change_pct, ratio, limit_pct}`, KPI_BREAKDOWN_SUM `{parts, total, difference_pct}`.
   * Numbers and ids only.
   */
  details: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  checked_at: z.string().optional(),
});
export type KpiValueChecks = z.infer<typeof KpiValueChecksSchema>;
