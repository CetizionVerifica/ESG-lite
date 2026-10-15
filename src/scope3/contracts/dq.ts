/**
 * Scope 3 contracts (S3-0) §3: data quality. Copied from
 * docs/scope3/01-contracts.md §3. The 1–3 scale is the same as PCF DQR (D2),
 * so the two can be compared. The automatic defaults are S3-3's
 * (`src/scope3/dq/defaults.ts`); this file only holds the shapes and the
 * overall score.
 */
import { z } from "zod";

/** 1 = good, 2 = fair, 3 = poor. */
export const DqScoreSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type DqScore = z.infer<typeof DqScoreSchema>;

export const DQ_INDICATORS = ["technology", "geography", "time", "completeness", "reliability"] as const;
export type DqIndicator = (typeof DQ_INDICATORS)[number];

export const DqSourceSchema = z.enum(["auto", "manual"]);
export type DqSource = z.infer<typeof DqSourceSchema>;

export const DqSchema = z.object({
  technology: DqScoreSchema,
  geography: DqScoreSchema,
  time: DqScoreSchema,
  completeness: DqScoreSchema,
  reliability: DqScoreSchema,
  /** The rounded mean of the five indicators (`overallOf`). */
  overall: DqScoreSchema,
  source: DqSourceSchema,
});
export type Dq = z.infer<typeof DqSchema>;

export const DataTypeSchema = z.enum(["primary", "secondary"]);
export type DataType = z.infer<typeof DataTypeSchema>;

/** The overall score: the mean of the five indicators, rounded to the nearest whole score. */
export const overallOf = (dq: Pick<Dq, DqIndicator>): DqScore => {
  const mean = DQ_INDICATORS.reduce((sum, k) => sum + dq[k], 0) / DQ_INDICATORS.length;
  return Math.min(3, Math.max(1, Math.round(mean))) as DqScore;
};
