/**
 * Review check ids (docs/scope3/01-contracts.md §8). Stand-in written by
 * S3-15 ahead of S3-0: when S3-0 lands `src/scope3/contracts/checks.ts`,
 * its file wins and S3-15 rebases onto it.
 */
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

export type CheckId = (typeof CHECK_IDS)[number];

/** Stored on `emission.checks`. Ready = nothing held. */
export interface RowChecks {
  ready: boolean;
  held: CheckId[];
}
