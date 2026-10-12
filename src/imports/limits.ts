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
} as const;

export type ImportLimits = typeof IMPORT_LIMITS;

export const PLAN_EXPIRY_MS = IMPORT_LIMITS.PLAN_EXPIRY_HOURS * 60 * 60 * 1000;
