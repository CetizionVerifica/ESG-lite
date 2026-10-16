/**
 * S3-12 · the one error the screening endpoints raise that is neither a §7
 * Scope 3 code nor an S3-1 request error: `DUPLICATE_EXISTING` (the import
 * row issue code, src/imports/errors.ts) for a second pending proxy row of
 * the same category, site, year and basis, with the existing row's id.
 */
import type { RowIssueCode } from "../../imports/errors";

const SCREENING_ERRORS = {
  DUPLICATE_EXISTING: {
    status: 409,
    message: "An extrapolated row for this category, site, year and basis is already waiting for review. Approve or reject it first.",
  },
} as const satisfies Partial<Record<RowIssueCode, { status: number; message: string }>>;

export type ScreeningErrorCode = keyof typeof SCREENING_ERRORS;

export class ScreeningError extends Error {
  readonly code: ScreeningErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ScreeningErrorCode, details?: unknown) {
    super(SCREENING_ERRORS[code].message);
    this.name = "ScreeningError";
    this.code = code;
    this.status = SCREENING_ERRORS[code].status;
    this.details = details;
  }

  toBody() {
    return this.details === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, details: this.details };
  }
}
