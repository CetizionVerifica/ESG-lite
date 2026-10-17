/**
 * Scope 3 contracts (S3-0) §7: error and warning codes. Copied from
 * docs/scope3/01-contracts.md §7, in the `src/imports/errors.ts` shape.
 *
 * API errors are `{ code, message, details? }` with the HTTP status below.
 * Never put SQL, a stack trace or another company's names in `message` or
 * `details`. Warnings never block a save; they travel with the row.
 */
import type { Response } from "express";

export const SCOPE3_ERRORS = {
  SCOPE_INVALID: { status: 400, message: "Scope must be Scope 1, Scope 2, Scope 3 or empty." },
  GHG_CATEGORY_INVALID: { status: 400, message: "The GHG Protocol category must be a number from 1 to 15." },
  GHG_CATEGORY_REQUIRED: { status: 422, message: "This Scope 3 category needs its GHG Protocol category number (1–15)." },
  EXCLUSION_REASON_REQUIRED: { status: 400, message: "Give a reason for excluding this category." },
  UNIT_REQUIRED: { status: 400, message: "This emission factor needs a unit." },
  METHOD_NOT_ALLOWED: { status: 400, message: "This calculation method isn't offered for this category." },
  CURRENCY_NOT_SUPPORTED: { status: 422, message: "This currency can't be converted yet." },
  SUPPLIER_FACTOR_BOUNDARY: { status: 422, message: "A supplier's figure must be cradle-to-gate." },
  PERIOD_LOCKED: { status: 409, message: "This month is closed. Reopen it with a reason to change its data." },
  UNLOCK_REASON_REQUIRED: { status: 400, message: "Give a reason for reopening this month." },
  NOT_DRAFT: { status: 409, message: "Only Draft entries can be submitted." },
  EXTRAPOLATION_BASIS_INVALID: { status: 400, message: "The extrapolation basis isn't valid." },
  PERIOD_INCOMPLETE: { status: 422, message: "Some sites or categories in this period aren't complete yet." },
  BASE_YEAR_NO_DATA: { status: 422, message: "The base year has no approved data." },
  RECALCULATION_REASON_REQUIRED: { status: 400, message: "Give a reason for the recalculation." },
  // S3-15 part 2: lock and "Nothing this month" exist only with company.review_workflow_v2 on (D9).
  REVIEW_WORKFLOW_OFF: { status: 403, message: "Drafts and month locks aren't switched on for this client." },
} as const;

export type Scope3ErrorCode = keyof typeof SCOPE3_ERRORS;
export const SCOPE3_ERROR_CODES = Object.keys(SCOPE3_ERRORS) as Scope3ErrorCode[];

export interface Scope3ErrorBody {
  code: Scope3ErrorCode;
  message: string;
  details?: unknown;
}

/** Thrown by Scope 3 services; the controller maps it to a response. */
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

  toBody(): Scope3ErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** Sends a Scope 3 error as `{ code, message, details? }` with its status. */
export const sendScope3Error = (res: Response, err: Scope3Error) => res.status(err.status).json(err.toBody());

/** Warnings (never block). `FACTOR_FALLBACK_YEAR` now applies to typed entries too. */
export const SCOPE3_WARNINGS = {
  FACTOR_FALLBACK_YEAR: "No factor for the reporting year; another year's factor was used.",
  FACTOR_TYPE_MISMATCH: "This factor's type is unusual for this category.",
  FERA_FACTOR_MISSING: "No fuel- and energy-related (FERA) factor was found for this row.",
  WTT_ALREADY_IN_FACTOR: "This transport factor already includes well-to-tank emissions.",
  FX_RATE_FALLBACK: "No exchange rate for that day; the nearest earlier rate was used.",
  NO_DEFLATOR: "No price deflator for that year; the amount was not deflated.",
  DEFLATOR_FALLBACK_YEAR: "No price index for the spend year yet; the latest published year's was used.",
  ESTIMATED_DISTANCE: "The distance is an estimate from the route helper.",
  TRANSPORT_PAID_BY_MISMATCH: "Who paid for this transport doesn't match the category.",
} as const;

export type Scope3WarningCode = keyof typeof SCOPE3_WARNINGS;
export const SCOPE3_WARNING_CODES = Object.keys(SCOPE3_WARNINGS) as Scope3WarningCode[];

export interface Scope3Warning {
  code: Scope3WarningCode;
  message: string;
  details?: unknown;
}

export const scope3Warning = (code: Scope3WarningCode, details?: unknown): Scope3Warning =>
  details === undefined ? { code, message: SCOPE3_WARNINGS[code] } : { code, message: SCOPE3_WARNINGS[code], details };
