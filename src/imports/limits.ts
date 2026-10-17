/**
 * Import limits (IM0). One place, imported everywhere: the plans API (IM2),
 * the MCP import tools (IM8) and the FE Bulk upload (IM11) all read these.
 * See docs/mcp-import/01-contracts.md §3.
 */
export const IMPORT_LIMITS = {
  /** Rows accepted by one plan or append request. */
  ROWS_PER_REQUEST: 2000,
  /** Rows one plan may hold in total. */
  ROWS_PER_PLAN: 20000,
  /** Open draft plans one user may have at a time. */
  DRAFT_PLANS_PER_USER: 10,
  /** A plan untouched for this long reads as expired. */
  PLAN_EXPIRY_HOURS: 24,
  /** Largest page of PlannedRows a read may return. */
  MAX_PAGE_SIZE: 200,
  /** Default page of PlannedRows. */
  DEFAULT_PAGE_SIZE: 50,
  /** Rows returned inline by plan_import / POST /imports/plans (issues first). */
  PLAN_PREVIEW_ROWS: 50,
  /** `notes` length on an ImportRow. */
  NOTES_MAX_CHARS: 500,
  /** `row_ref` length on an ImportRow. */
  ROW_REF_MAX_CHARS: 200,
  /** `activity_name` / `activity_unit` length. */
  ACTIVITY_TEXT_MAX_CHARS: 300,
  /** `source_name` length on a plan. */
  SOURCE_NAME_MAX_CHARS: 200,
  /** Suggestions listed in an UNKNOWN_ACTIVITY message. */
  ACTIVITY_SUGGESTIONS: 5,
  /** Matches returned by find_activity. */
  ACTIVITY_SEARCH_RESULTS: 10,
  /** Access token lifetime for MCP tokens (IM5), seconds. */
  MCP_ACCESS_TOKEN_SECONDS: 60 * 60,

  // Smart Excel import (XI0, docs/excel-import/01-contracts.md §6).
  /** Worksheets one workbook may carry into a mapping proposal. */
  MAPPING_SHEETS_PER_WORKBOOK: 20,
  /** Sample rows per sheet shown to the mapping model. */
  MAPPING_SAMPLE_ROWS_PER_SHEET: 15,
  /** Distinct values of a candidate column shown to the mapping model. */
  MAPPING_DISTINCT_VALUES_PER_COLUMN: 200,
  /** Prompt budget per sheet, tokens. */
  MAPPING_PROMPT_TOKENS_PER_SHEET: 8000,
  /** Model calls per sheet per propose request. */
  MAPPING_MODEL_CALLS_PER_SHEET: 1,
  /** `POST /v1/excel/propose` calls per user per window. */
  MAPPING_PROPOSE_PER_WINDOW: 10,
  /** The window for MAPPING_PROPOSE_PER_WINDOW, minutes. */
  MAPPING_PROPOSE_WINDOW_MINUTES: 10,
  /** A match below this confidence needs the user's confirmation (decision 4). */
  MAPPING_CONFIRM_BELOW: 0.8,
  /** Length of a sheet name, column name or sheet text kept on a proposal. */
  MAPPING_TEXT_MAX_CHARS: 300,
} as const;

export type ImportLimits = typeof IMPORT_LIMITS;

export const PLAN_EXPIRY_MS = IMPORT_LIMITS.PLAN_EXPIRY_HOURS * 60 * 60 * 1000;
