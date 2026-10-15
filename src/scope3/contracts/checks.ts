/**
 * Scope 3 contracts (S3-0) §8: review check ids. Copied from
 * docs/scope3/01-contracts.md §8. S3-15 runs them (`src/scope3/review/checks.ts`);
 * a row is Ready when every check passes. The UI shows a fixed label per id
 * (FE `src/lib/scope3/checks.ts`).
 */
import { z } from "zod";

export const CHECK_IDS = [
  "FACTOR_FOUND",
  "UNIT_OK",
  "EVIDENCE_ATTACHED",
  "WITHIN_THRESHOLD",
  "NO_DUPLICATE",
  "IMPORT_MATCH_SURE",
  "METHOD_GIVEN",
  "DQ_ACCEPTABLE",
] as const;
export const CheckIdSchema = z.enum(CHECK_IDS);
export type CheckId = z.infer<typeof CheckIdSchema>;

/** What each check means (§8), for code and logs; the screen labels live in the FE. */
export const CHECK_RULES: Record<CheckId, string> = {
  FACTOR_FOUND: "An emission factor was found for the row.",
  UNIT_OK: "The unit matches or converts to the factor's unit.",
  EVIDENCE_ATTACHED: "A document is attached.",
  WITHIN_THRESHOLD: "Within the company emission threshold of the previous month (same site, category and activity).",
  NO_DUPLICATE: "No other row for the same site, category, activity and period.",
  IMPORT_MATCH_SURE: "A smart-import match is 80 % sure or more.",
  METHOD_GIVEN: "A Scope 3 row says which calculation method it used.",
  DQ_ACCEPTABLE: "Overall data quality is 2 or better, or a note explains it.",
};

/** Smart-import confidence at or above which IMPORT_MATCH_SURE passes. */
export const IMPORT_MATCH_SURE_AT = 0.8;
/** Overall DQ at or below which DQ_ACCEPTABLE passes without a note. */
export const DQ_ACCEPTABLE_AT = 2;

/** `emission.checks` (S3-15). */
export const RowChecksSchema = z.object({
  ready: z.boolean(),
  held: z.array(CheckIdSchema),
});
export type RowChecks = z.infer<typeof RowChecksSchema>;
