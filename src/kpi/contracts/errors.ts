/**
 * KPI contracts (KPI-0) §4: error codes, in the `src/imports/errors.ts` shape.
 * API errors are `{ code, message, details? }` with the HTTP status below.
 * Never put SQL, a stack trace, another company's names or a value a user
 * typed in `message` or `details`.
 *
 * The first block is 01-contracts §4 verbatim. The second block holds the
 * plumbing codes every KPI route needs (bad request, not found, role) — the
 * same job `SCOPE3_VALIDATION` / `SCOPE3_NOT_FOUND` do for Scope 3.
 */
import type { Response } from "express";

export const KPI_ERRORS = {
  KPI_TRACKING_OFF: { status: 403, message: "KPI tracking isn't switched on for this client." },
  KPI_SETUP_INCOMPLETE: { status: 409, message: "Finish KPI setup first." },
  KPI_NOT_SELECTED: { status: 422, message: "This KPI isn't selected for your company." },
  KPI_NOT_ASSIGNED: { status: 403, message: "This KPI or site isn't assigned to you." },
  KPI_UNIT_NOT_ALLOWED: { status: 422, message: "This KPI doesn't take that unit." },
  KPI_VALUE_INVALID: { status: 422, message: "This value doesn't fit the KPI." },
  KPI_AUTO_READ_ONLY: { status: 409, message: "This KPI is filled from your data or calculated, so it can't be typed." },
  KPI_PERIOD_LOCKED: { status: 409, message: "This period is closed. Ask your manager to reopen it." },
  KPI_PERIOD_INCOMPLETE: { status: 422, message: "Some values in this period are missing or not approved yet." },
  KPI_NOT_DRAFT: { status: 409, message: "Only draft values can be changed or submitted." },
  KPI_EVIDENCE_REQUIRED: { status: 422, message: "Attach evidence before submitting this value." },
  KPI_FORMULA_INVALID: { status: 422, message: "The formula names an unknown KPI, loops back on itself, or mixes units." },
  KPI_REASON_REQUIRED: { status: 400, message: "Give a reason." },
  // Plumbing (not in 01-contracts §4; added by KPI-0 for every route).
  KPI_VALIDATION: { status: 400, message: "The request isn't valid." },
  KPI_NOT_FOUND: { status: 404, message: "Not found." },
  KPI_FORBIDDEN: { status: 403, message: "Your role can't do this." },
  KPI_COMPANY_REQUIRED: { status: 400, message: "Choose a client (company_id)." },
  KPI_CODE_TAKEN: { status: 409, message: "That code is already used." },
} as const;

export type KpiErrorCode = keyof typeof KPI_ERRORS;
export const KPI_ERROR_CODES = Object.keys(KPI_ERRORS) as KpiErrorCode[];

export interface KpiErrorBody {
  code: KpiErrorCode;
  message: string;
  details?: unknown;
}

/** Thrown by KPI services; `sendKpiError` (or the router's handler) maps it to a response. */
export class KpiError extends Error {
  readonly code: KpiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: KpiErrorCode, details?: unknown, message?: string) {
    super(message ?? KPI_ERRORS[code].message);
    this.name = "KpiError";
    this.code = code;
    this.status = KPI_ERRORS[code].status;
    this.details = details;
  }

  toBody(): KpiErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** Sends a KPI error as `{ code, message, details? }` with its status. */
export const sendKpiError = (res: Response, err: KpiError) => res.status(err.status).json(err.toBody());

/** zod issues → KPI_VALIDATION details (paths and messages only, never the input). */
export const kpiValidationError = (issues: Array<{ path: PropertyKey[]; message: string }>) =>
  new KpiError("KPI_VALIDATION", { issues: issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
