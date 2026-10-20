/**
 * Design Studio contracts (DS-0) §5: error codes, in the KPI shape
 * (src/kpi/contracts/errors.ts). API errors are `{ code, message, details? }`
 * with the HTTP status below. Never put SQL, a stack trace, another company's
 * names or report text in `message` or `details`.
 *
 * Blocks: the DS codes of 01-contracts §5; the RS codes renamed RS_* → DS_*
 * (rs-base/01-contracts §5, same meaning); plumbing every route needs.
 * RS_NEEDS_KPI has no DS twin: the GHG kind needs only the studio switch (D4),
 * so turning the studio on never needs KPI tracking.
 */
import type { Response } from "express";

export const DS_ERRORS = {
  // 01-contracts §5 (new or changed)
  DS_STUDIO_OFF: { status: 403, message: "Design Studio isn't turned on for this company." },
  DS_KIND_OFF: { status: 403, message: "Sustainability reports need KPI tracking, which isn't turned on for this company." },
  DS_FORMAT_INVALID: { status: 422, message: "That page format isn't available here." },
  DS_SOURCE_UNAVAILABLE: { status: 422, message: "That data isn't recorded, so it can't be linked." },
  DS_SHARE_EXPIRED: { status: 410, message: "This link has expired or was turned off." },
  DS_APPROVAL_PENDING: { status: 409, message: "This design is waiting for approval." },
  DS_RESIZE_UNSUPPORTED: { status: 422, message: "This design can't be resized to that format." },
  // RS codes, renamed (rs-base/01-contracts §5)
  DS_ROLE: { status: 403, message: "Your role can't do this." },
  DS_SITES_SCOPE: { status: 403, message: "You need access to every site for a company-wide report." },
  DS_DOC_NOT_FOUND: { status: 404, message: "Not found." },
  DS_VERSION_CONFLICT: { status: 409, message: "Someone else changed this design. Reload to see their changes." },
  DS_FINAL_IMMUTABLE: { status: 409, message: "A final version can't be changed." },
  DS_DOC_INVALID: { status: 422, message: "The design isn't valid." },
  DS_DOC_TOO_LARGE: { status: 413, message: "The design is too large (over 2 MB)." },
  DS_BINDING_INVALID: { status: 422, message: "That data link isn't valid for this company." },
  DS_LAYOUT_NOT_FOUND: { status: 404, message: "That template or layout wasn't found." },
  DS_ASSET_TYPE: { status: 415, message: "Upload a JPG, PNG, WebP or SVG image." },
  DS_ASSET_TOO_LARGE: { status: 413, message: "Images can be up to 10 MB." },
  DS_YEAR_NOT_LOCKED: { status: 409, message: "Lock the year's KPI values before making a final." },
  DS_CHECKS_BLOCKING: { status: 409, message: "Fix the errors (and acknowledge the warnings) before making a final." },
  DS_JOB_RUNNING: { status: 409, message: "A final is already being made for this design." },
  DS_JOB_FAILED: { status: 500, message: "The PDF couldn't be made." },
  DS_AI_UNAVAILABLE: { status: 503, message: "AI suggestions aren't available right now. Try again." },
  DS_AI_BUDGET_EXCEEDED: { status: 429, message: "This design has used today's AI budget." },
  DS_AI_OUTPUT_INVALID: { status: 502, message: "The AI suggestion couldn't be used. Try again." },
  // Plumbing (not in 01-contracts; added by DS-0 for every route, as KPI-0 did)
  DS_VALIDATION: { status: 400, message: "The request isn't valid." },
  DS_COMPANY_REQUIRED: { status: 400, message: "Choose a client (company_id)." },
} as const;

export type DsErrorCode = keyof typeof DS_ERRORS;
export const DS_ERROR_CODES = Object.keys(DS_ERRORS) as DsErrorCode[];

/** `details.reason` of DS_JOB_FAILED (RS §5). */
export const JOB_FAILURE_REASONS = ["timeout", "font", "chromium", "measure"] as const;

export interface DsErrorBody {
  code: DsErrorCode;
  message: string;
  details?: unknown;
}

/** Thrown by studio services; `handle` (src/studio/http.ts) maps it to a response. */
export class DsError extends Error {
  readonly code: DsErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: DsErrorCode, details?: unknown, message?: string) {
    super(message ?? DS_ERRORS[code].message);
    this.name = "DsError";
    this.code = code;
    this.status = DS_ERRORS[code].status;
    this.details = details;
  }

  toBody(): DsErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export const sendDsError = (res: Response, err: DsError) => res.status(err.status).json(err.toBody());

/** zod issues → `details.issues` (paths and messages only, never the input). */
const issueList = (issues: Array<{ path: PropertyKey[]; message: string }>) => issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
export const dsValidationError = (issues: Array<{ path: PropertyKey[]; message: string }>) => new DsError("DS_VALIDATION", { issues: issueList(issues) });
/** A doc that failed ReportDocSchema (422). */
export const dsDocInvalid = (issues: Array<{ path: PropertyKey[]; message: string }>) => new DsError("DS_DOC_INVALID", { issues: issueList(issues) });
