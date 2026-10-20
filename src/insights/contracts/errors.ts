/**
 * Insights contracts (IN-0) §7: error codes, in the KPI/DS shape
 * (src/kpi/contracts/errors.ts, src/studio/contracts/errors.ts). API errors are
 * `{ code, message, details? }` with the HTTP status below. Never put SQL, a
 * stack trace or another company's names in `message` or `details`.
 *
 * IN_VALIDATION and IN_COMPANY_REQUIRED are plumbing every route needs (as
 * KPI-0 and DS-0 added theirs): a bad panel query, and a Superadmin who didn't
 * name the client.
 */
import type { Response } from "express";

export const IN_ERRORS = {
  // 01-contracts §7
  IN_OFF: { status: 403, message: "Insights isn't turned on for your company." },
  IN_FORBIDDEN: { status: 403, message: "Your role can't open Insights." },
  IN_SITE_NOT_FOUND: { status: 404, message: "Not found." },
  IN_EVENT_NOT_FOUND: { status: 404, message: "That event wasn't found." },
  IN_EVENT_INVALID: { status: 400, message: "The event isn't valid." },
  IN_SCORES_INVALID: { status: 400, message: "Scores must be between 0 and 10 for a material topic." },
  IN_AI_BUDGET: { status: 429, message: "This month's AI wording budget is used up; cards show their standard text." },
  IN_SNAPSHOT_TIMEOUT: { status: 504, message: "The PDF snapshot took too long. Try again with fewer sites." },
  // Plumbing
  IN_VALIDATION: { status: 400, message: "The request isn't valid." },
  IN_COMPANY_REQUIRED: { status: 400, message: "Choose a client (company_id)." },
} as const;

export type InErrorCode = keyof typeof IN_ERRORS;
export const IN_ERROR_CODES = Object.keys(IN_ERRORS) as InErrorCode[];

export interface InErrorBody {
  code: InErrorCode;
  message: string;
  details?: unknown;
}

/** Thrown by insights code; `handle` (src/insights/http.ts) maps it to a response. */
export class InError extends Error {
  readonly code: InErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: InErrorCode, details?: unknown, message?: string) {
    super(message ?? IN_ERRORS[code].message);
    this.name = "InError";
    this.code = code;
    this.status = IN_ERRORS[code].status;
    this.details = details;
  }

  toBody(): InErrorBody {
    return this.details === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, details: this.details };
  }
}

export const sendInError = (res: Response, err: InError) => res.status(err.status).json(err.toBody());

/** zod issues → `details.issues` (paths and messages only, never the input). */
export const issueList = (issues: Array<{ path: PropertyKey[]; message: string }>) => issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
