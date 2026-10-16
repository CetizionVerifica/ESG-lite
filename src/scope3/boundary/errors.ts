/**
 * Request errors for the S3-1 endpoints that the §7 Scope 3 codes don't
 * cover (validation, company, role, not found), in the same
 * `{ code, message, details? }` shape as contracts/errors.ts.
 */
export const BOUNDARY_ERRORS = {
  SCOPE3_VALIDATION: { status: 400, message: "The request body is not valid." },
  SCOPE3_COMPANY_REQUIRED: { status: 400, message: "company_id is required for a Superadmin." },
  SCOPE3_FORBIDDEN: { status: 403, message: "You are not allowed to do that." },
  SCOPE3_NOT_FOUND: { status: 404, message: "Not found." },
} as const;

export type BoundaryErrorCode = keyof typeof BOUNDARY_ERRORS;

export class BoundaryError extends Error {
  readonly code: BoundaryErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: BoundaryErrorCode, details?: unknown) {
    super(BOUNDARY_ERRORS[code].message);
    this.name = "BoundaryError";
    this.code = code;
    this.status = BOUNDARY_ERRORS[code].status;
    this.details = details;
  }

  toBody() {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}
