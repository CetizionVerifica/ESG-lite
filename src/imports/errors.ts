/**
 * Import error codes (IM0). See docs/mcp-import/01-contracts.md §2 and §5.
 *
 * API errors are `{ code, message, details? }` with the HTTP status below.
 * Never put SQL, a stack trace or another company's names in `message` or
 * `details`. The MCP server (IM6) turns these into tool errors
 * (`isError: true`, `structuredContent: { code, details }`).
 */
import type { Response } from "express";
import { CLIENT_INACTIVE_CODE, CLIENT_INACTIVE_MESSAGE } from "../services/clientStatus";

export const IMPORT_ERRORS = {
  IMPORT_PLAN_NOT_FOUND: { status: 404, message: "Import plan not found." },
  IMPORT_PLAN_EXPIRED: { status: 410, message: "This import plan has expired. Start a new plan." },
  IMPORT_PLAN_NOT_DRAFT: { status: 409, message: "This import plan is no longer a draft." },
  IMPORT_PLAN_VERSION_CONFLICT: {
    status: 409,
    message: "The plan changed since you last read it. Reload it and send the current version.",
  },
  IMPORT_PLAN_HAS_ISSUES: {
    status: 422,
    message: "Some rows still have issues. Fix or skip them, or commit with skip_rows_with_issues.",
  },
  IMPORT_TOO_MANY_ROWS: { status: 413, message: "Too many rows. Send fewer rows per request or per plan." },
  IMPORT_TOO_MANY_PLANS: { status: 429, message: "Too many open draft plans. Commit or cancel one first." },
  IMPORT_DUPLICATE_ROW_REF: { status: 422, message: "Every row_ref must be unique within a plan." },
  IMPORT_COMPANY_REQUIRED: { status: 400, message: "company_id is required for a Superadmin." },
  IMPORT_VALIDATION: { status: 400, message: "The request body is not valid." },
  MCP_SUPERADMIN_ONLY: { status: 403, message: "Only Superadmin accounts can use Claude imports." },
  IMPORT_FORBIDDEN: { status: 403, message: "You are not allowed to do that." },
  MCP_DISABLED_FOR_CLIENT: { status: 403, message: "Claude imports are switched off for this client." },
  AI_IMPORT_DISABLED_FOR_CLIENT: { status: 403, message: "Smart import is switched off for this client." },
  // S3-15 part 2: a row falls in a closed (locked) site-month; `details.row_refs` names them.
  PERIOD_LOCKED: { status: 409, message: "Some rows fall in a closed month. Reopen it with a reason, or leave those rows out." },
  [CLIENT_INACTIVE_CODE]: { status: 403, message: CLIENT_INACTIVE_MESSAGE },
} as const;

export type ImportErrorCode = keyof typeof IMPORT_ERRORS;

export const IMPORT_ERROR_CODES = Object.keys(IMPORT_ERRORS) as ImportErrorCode[];

export interface ImportErrorBody {
  code: ImportErrorCode;
  message: string;
  details?: unknown;
}

/** Thrown by services; the controller or tool layer maps it to a response. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ImportErrorCode, details?: unknown, message?: string) {
    super(message ?? IMPORT_ERRORS[code].message);
    this.name = "ImportError";
    this.code = code;
    this.status = IMPORT_ERRORS[code].status;
    this.details = details;
  }

  toBody(): ImportErrorBody {
    const body: ImportErrorBody = { code: this.code, message: this.message };
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

export const isImportError = (err: unknown): err is ImportError =>
  err instanceof ImportError || (typeof err === "object" && err !== null && (err as any).name === "ImportError");

/** Send a contract error. `details` is optional and must never carry SQL or a stack. */
export const importError = (res: Response, code: ImportErrorCode, details?: unknown, message?: string) => {
  const err = new ImportError(code, details, message);
  return res.status(err.status).json(err.toBody());
};

/** Row issue codes (§2). `severity` is fixed per code. */
export const ROW_ISSUE_CODES = {
  SITE_NOT_ALLOWED: "error",
  CATEGORY_NOT_ASSIGNED: "error",
  NO_FORM: "error",
  UNKNOWN_ACTIVITY: "error",
  NO_FACTOR_FOR_YEAR: "error",
  UNIT_NOT_CONVERTIBLE: "error",
  MISSING_VALUE: "error",
  NON_POSITIVE_VALUE: "error",
  FIELD_REQUIRED: "error",
  FIELD_INVALID: "error",
  PERIOD_INVALID: "error",
  MODE_LOCK: "error",
  DUPLICATE_EXISTING: "error",
  DUPLICATE_IN_PLAN: "warning",
  DISTANCE_REQUIRED: "error",
  FACTOR_FALLBACK_YEAR: "warning",
  CLIENT_TOTAL_IGNORED: "warning",
  // Smart Excel import (XI0). SITE_NOT_ALLOWED above is also the code for a
  // sheet row that names a site other than the one chosen for the upload.
  NOT_IN_CONTEXT: "error",
  LOW_CONFIDENCE_MATCH: "warning",
  PIVOT_EMPTY_CELL: "info",
  // Scope 3 engine integrity (S3-4, docs/scope3/01-contracts.md §7).
  UNIT_REQUIRED: "error",
  FERA_FACTOR_MISSING: "warning",
  // Scope 3 Category 3 split (S3-7, docs/scope3/01-contracts.md §7). Never block.
  FACTOR_TYPE_MISMATCH: "warning",
  WTT_ALREADY_IN_FACTOR: "warning",
  // Spend-based rows (S3-5). A currency without a rate blocks the row; a rate
  // from another day or no price deflator only warn.
  CURRENCY_NOT_SUPPORTED: "error",
  FX_RATE_FALLBACK: "warning",
  NO_DEFLATOR: "warning",
  DEFLATOR_FALLBACK_YEAR: "warning",
  // S3-3: the row named a method the form does not offer.
  METHOD_NOT_ALLOWED: "error",
  // Transport and distribution (S3-8). Never block.
  ESTIMATED_DISTANCE: "warning",
  TRANSPORT_PAID_BY_MISMATCH: "warning",
  // S3-15 part 2: the row's site and month are closed (period_lock, review workflow v2).
  PERIOD_LOCKED: "error",
} as const;

export type RowIssueCode = keyof typeof ROW_ISSUE_CODES;
export type RowIssueSeverity = (typeof ROW_ISSUE_CODES)[RowIssueCode];

export const ROW_ISSUE_CODE_LIST = Object.keys(ROW_ISSUE_CODES) as RowIssueCode[];

export const rowIssueSeverity = (code: RowIssueCode): RowIssueSeverity => ROW_ISSUE_CODES[code];
