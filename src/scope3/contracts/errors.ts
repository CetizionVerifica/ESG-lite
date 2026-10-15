/**
 * Scope 3 error codes (docs/scope3/01-contracts.md §7), in the
 * `{ code, message, details? }` shape of src/imports/errors.ts.
 *
 * STAND-IN written by S3-1 ahead of S3-0 (ESG-lite #134), holding only the
 * codes S3-1 raises. S3-0 owns this file: when S3-0 merges, take S3-0's
 * version and keep the S3-1 imports (Scope3Error, SCOPE3_ERRORS) working.
 */
export const SCOPE3_ERRORS = {
  GHG_CATEGORY_INVALID: {
    status: 400,
    message: "A GHG Protocol category must be a number from 1 to 15, on a Scope 3 category only.",
  },
  GHG_CATEGORY_REQUIRED: {
    status: 400,
    message: "A new Scope 3 category needs its GHG Protocol category (1 to 15).",
  },
  EXCLUSION_REASON_REQUIRED: {
    status: 400,
    message: "Give a reason when a category is excluded or not relevant.",
  },
  SCOPE3_VALIDATION: { status: 400, message: "The request body is not valid." },
  SCOPE3_COMPANY_REQUIRED: { status: 400, message: "company_id is required for a Superadmin." },
  SCOPE3_FORBIDDEN: { status: 403, message: "You are not allowed to do that." },
  SCOPE3_NOT_FOUND: { status: 404, message: "Not found." },
} as const;

export type Scope3ErrorCode = keyof typeof SCOPE3_ERRORS;

export class Scope3Error extends Error {
  readonly code: Scope3ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: Scope3ErrorCode, details?: unknown, message?: string) {
    super(message ?? SCOPE3_ERRORS[code].message);
    this.name = "Scope3Error";
    this.code = code;
    this.status = SCOPE3_ERRORS[code].status;
    this.details = details;
  }

  toBody() {
    return { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}
