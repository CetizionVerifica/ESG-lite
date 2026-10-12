/**
 * Import contracts (IM0). Zod schemas and inferred types for every shape in
 * docs/mcp-import/01-contracts.md. The HTTP plans API (IM2), the context API
 * (IM3), the MCP tools (IM7, IM8) and the Bulk upload page (IM11) all parse
 * and type against these objects, so they cannot drift.
 *
 * Changing a shape here is an IM0 follow-up PR, merged before the module
 * that needs it.
 */
import { z } from "zod";
import { IMPORT_LIMITS } from "./limits";
import { ROW_ISSUE_CODE_LIST, IMPORT_ERROR_CODES } from "./errors";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

const positiveInt = z.number().int().positive();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a calendar date");
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");
const uuid = z.string().uuid();

export const YearTypeSchema = z.enum(["CY", "FY"]);
export type YearType = z.infer<typeof YearTypeSchema>;

export const ReportingPeriodSchema = z.enum(["monthly", "yearly"]);
export type ReportingPeriod = z.infer<typeof ReportingPeriodSchema>;

export const ImportChannelSchema = z.enum(["mcp", "bulk_upload", "api"]);
export type ImportChannel = z.infer<typeof ImportChannelSchema>;

export const ScopeSchema = z.enum(["Scope 1", "Scope 2", "Scope 3"]);

// ---------------------------------------------------------------------------
// §1 ImportRow
// ---------------------------------------------------------------------------

export const MonthlyPeriodSchema = z.object({
  kind: z.literal("monthly"),
  /** Any day of the month; stored as sent, matched by month. */
  date: isoDate,
});

export const YearlyPeriodSchema = z.object({
  kind: z.literal("yearly"),
  /** CY → Dec 31 of `year`; FY → Mar 31 of `year` (April financial year). */
  year_type: YearTypeSchema,
  year: z.number().int().min(2000).max(2100),
});

export const ImportPeriodSchema = z.discriminatedUnion("kind", [MonthlyPeriodSchema, YearlyPeriodSchema]);
export type ImportPeriod = z.infer<typeof ImportPeriodSchema>;

const fieldValue = z.union([z.string().max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS), z.number().finite()]);

/**
 * Keys a client may send that carry a total, factor or result unit. They are
 * dropped (strip, not error) and reported by `parseImportRows` so IM1 can add
 * a CLIENT_TOTAL_IGNORED warning. Totals are always recomputed server-side.
 */
export const TOTAL_LIKE_KEYS = [
  "total_emission",
  "total_tco2e",
  "total",
  "emission",
  "emissions",
  "tco2e",
  "co2e",
  "factor",
  "factor_value",
  "emission_factor",
  "emission_factor_id",
  "unit",
] as const;

/** The row's fields without the value-or-fields rule; `ImportRowSchema` adds it. */
export const ImportRowShape = z
  .object({
    /** Where the row came from, e.g. "Fuel 2025!B14". Unique within a plan. */
    row_ref: z.string().trim().min(1).max(IMPORT_LIMITS.ROW_REF_MAX_CHARS),
    site_id: positiveInt,
    category_id: positiveInt,
    period: ImportPeriodSchema,
    /** The sheet's own wording; resolved server-side (plan match → mapping → factor). */
    activity_name: z.string().trim().min(1).max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS),
    /** Single-value categories; required unless the form's calc spec uses `fields`. */
    activity_value: z.number().finite().optional(),
    /** As written ("L", "litre", "kWh", "t.km"); normalised server-side. */
    activity_unit: z.string().trim().min(1).max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS),
    /** Form fields by column key: calc-spec inputs and extra fields. */
    fields: z.record(z.string().max(100), fieldValue).optional(),
    /** Stored in extra_data.notes. */
    notes: z.string().max(IMPORT_LIMITS.NOTES_MAX_CHARS).optional(),
  })
  .strip();

export const ImportRowSchema = ImportRowShape.refine((row) => row.activity_value !== undefined || (row.fields !== undefined && Object.keys(row.fields).length > 0), {
    message: "activity_value is required unless fields are given",
    path: ["activity_value"],
  });

export type ImportRow = z.infer<typeof ImportRowSchema>;

export const ImportRowsSchema = z.array(ImportRowSchema).min(1).max(IMPORT_LIMITS.ROWS_PER_REQUEST);

export interface StrippedTotal {
  row_ref: string;
  keys: string[];
}

export interface ParsedImportRows {
  rows: ImportRow[];
  /** Rows that carried a total-like key, with the keys dropped. Empty when none. */
  stripped: StrippedTotal[];
  /** row_refs that appear more than once in this request. */
  duplicate_row_refs: string[];
}

/**
 * Parse a request's rows: validates with `ImportRowsSchema`, records which
 * rows carried total-like keys (dropped, never trusted), and lists duplicate
 * row_refs. Throws a ZodError on invalid input, like `schema.parse`.
 */
export const parseImportRows = (raw: unknown): ParsedImportRows => {
  const rows = ImportRowsSchema.parse(raw);
  const stripped: StrippedTotal[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const keys = TOTAL_LIKE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(item, k));
      if (keys.length) stripped.push({ row_ref: rows[i].row_ref, keys: [...keys] });
    });
  }
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.row_ref)) dup.add(r.row_ref);
    seen.add(r.row_ref);
  }
  return { rows, stripped, duplicate_row_refs: [...dup] };
};

// ---------------------------------------------------------------------------
// §2 PlannedRow
// ---------------------------------------------------------------------------

export const RowIssueCodeSchema = z.enum(ROW_ISSUE_CODE_LIST as [string, ...string[]]);
export const RowIssueSeveritySchema = z.enum(["error", "warning"]);

export const RowIssueSchema = z.object({
  code: RowIssueCodeSchema,
  severity: RowIssueSeveritySchema,
  message: z.string(),
  field: z.string().optional(),
});
export type RowIssue = z.infer<typeof RowIssueSchema>;

export const RowStateSchema = z.enum(["ready", "issue", "skipped"]);
export type RowState = z.infer<typeof RowStateSchema>;

export const PlannedRowResultSchema = z.object({
  activity: z.object({
    name: z.string(),
    matched_by: z.enum(["factor", "mapping", "plan_match"]),
    factor_name: z.string(),
  }),
  factor: z.object({
    emission_factor_id: positiveInt,
    year: z.number().int(),
    value: z.number(),
    unit: z.string(),
    fallback_year: z.boolean(),
  }),
  activity_value: z.number(),
  activity_unit: z.string(),
  conversion: z.number().optional(),
  total_tco2e: z.number(),
  fera: z.object({ category_id: positiveInt, total_tco2e: z.number() }).optional(),
  reporting_date: isoDate,
  reporting_period: ReportingPeriodSchema,
  year_type: YearTypeSchema.optional(),
});
export type PlannedRowResult = z.infer<typeof PlannedRowResultSchema>;

export const PlannedRowSchema = z.object({
  row_ref: z.string(),
  state: RowStateSchema,
  /** Empty when ready; warnings may exist on ready rows. */
  issues: z.array(RowIssueSchema),
  /** As stored (after strip and normalise). */
  input: ImportRowSchema,
  /** Present when ready. */
  result: PlannedRowResultSchema.optional(),
});
export type PlannedRow = z.infer<typeof PlannedRowSchema>;

// ---------------------------------------------------------------------------
// §3 ImportPlan
// ---------------------------------------------------------------------------

export const PlanStatusSchema = z.enum(["draft", "committed", "cancelled", "expired"]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanCountsSchema = z.object({
  rows: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  issue: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});
export type PlanCounts = z.infer<typeof PlanCountsSchema>;

export const PlanTotalsSchema = z.object({
  tco2e: z.number(),
  by_category: z.array(
    z.object({
      category_id: positiveInt,
      name: z.string(),
      scope: ScopeSchema.nullable(),
      tco2e: z.number(),
      rows: z.number().int().nonnegative(),
    }),
  ),
  by_month: z.array(z.object({ month: yearMonth, tco2e: z.number() })),
});
export type PlanTotals = z.infer<typeof PlanTotalsSchema>;

export const IssueSummarySchema = z.array(
  z.object({
    code: RowIssueCodeSchema,
    count: z.number().int().nonnegative(),
    example_row_refs: z.array(z.string()),
  }),
);
export type IssueSummary = z.infer<typeof IssueSummarySchema>;

export const PlanCommittedSchema = z.object({
  upload_batch_id: z.string(),
  inserted: z.number().int().nonnegative(),
  fera_inserted: z.number().int().nonnegative(),
  committed_at: z.string(),
});

export const ImportPlanSchema = z.object({
  plan_id: uuid,
  version: z.number().int().nonnegative(),
  status: PlanStatusSchema,
  company_id: positiveInt,
  created_by: positiveInt.nullable(), // null once the creator's account is deleted (IM2)
  channel: ImportChannelSchema,
  /** Workbook name as the user calls it. */
  source_name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  /** 24 h after the last change. */
  expires_at: z.string(),
  counts: PlanCountsSchema,
  totals: PlanTotalsSchema,
  issues_summary: IssueSummarySchema,
  committed: PlanCommittedSchema.optional(),
});
export type ImportPlan = z.infer<typeof ImportPlanSchema>;

/** A plan plus a page of rows, the shape most plan endpoints and tools return. */
export const ImportPlanWithRowsSchema = ImportPlanSchema.extend({
  rows: z.array(PlannedRowSchema),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  total_rows: z.number().int().nonnegative().optional(),
});
export type ImportPlanWithRows = z.infer<typeof ImportPlanWithRowsSchema>;

// ---------------------------------------------------------------------------
// §4 ImportContext (IM3)
// ---------------------------------------------------------------------------

export const CalcModeSchema = z.enum(["single", "per_method", "per_unit", "distance"]);
export type CalcMode = z.infer<typeof CalcModeSchema>;

export const FormFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean(),
  unit: z.string().optional(),
  options: z.array(z.string()).optional(),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const CategoryFormSchema = z.object({
  calc_mode: CalcModeSchema,
  fields: z.array(FormFieldSchema),
});
export type CategoryForm = z.infer<typeof CategoryFormSchema>;

export const ContextCategorySchema = z.object({
  category_id: positiveInt,
  name: z.string(),
  scope: ScopeSchema.nullable(),
  period_modes: z.array(ReportingPeriodSchema),
  form: CategoryFormSchema.nullable(),
  units: z.array(z.string()),
  activity_count: z.number().int().nonnegative(),
  readiness: z.object({ form: z.boolean(), factor_years: z.array(z.number().int()) }),
});
export type ContextCategory = z.infer<typeof ContextCategorySchema>;

export const ContextSiteSchema = z.object({
  site_id: positiveInt,
  name: z.string(),
  categories: z.array(ContextCategorySchema),
});
export type ContextSite = z.infer<typeof ContextSiteSchema>;

export const ImportContextSchema = z.object({
  company: z.object({ company_id: positiveInt, name: z.string(), mcp_enabled: z.boolean() }),
  role: z.string(),
  fy_start_month: z.literal(4),
  sites: z.array(ContextSiteSchema),
});
export type ImportContext = z.infer<typeof ImportContextSchema>;

export const ActivityOptionSchema = z.object({
  name: z.string(),
  kind: z.enum(["factor", "mapping"]),
  maps_to: z.string().optional(),
  units: z.array(z.string()),
  latest_year: z.number().int().nullable(),
});
export type ActivityOption = z.infer<typeof ActivityOptionSchema>;

export const ReadinessCellSchema = z.object({
  site_id: positiveInt,
  category_id: positiveInt,
  form: z.boolean(),
  factor_years: z.array(z.number().int()),
  period_modes: z.array(ReportingPeriodSchema),
  /** What is missing and the app page that fixes it (IM3 fills). */
  missing: z.array(z.object({ what: z.string(), fix_page: z.string() })).optional(),
});
export type ReadinessCell = z.infer<typeof ReadinessCellSchema>;

// ---------------------------------------------------------------------------
// §4 request bodies and queries (IM2, IM3)
// ---------------------------------------------------------------------------

export const ActivityMatchSchema = z.object({
  site_id: positiveInt,
  category_id: positiveInt,
  /** The sheet's wording, as it appears in `activity_name`. */
  sheet_name: z.string().trim().min(1).max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS),
  /** An existing emission factor name for that site × category. */
  factor_name: z.string().trim().min(1).max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS),
  /** Also save as a P23 category mapping (Superadmin / company Admin only, D5). */
  save_mapping: z.boolean().optional(),
});
export type ActivityMatch = z.infer<typeof ActivityMatchSchema>;

export const CreatePlanBodySchema = z.object({
  source_name: z.string().trim().min(1).max(IMPORT_LIMITS.SOURCE_NAME_MAX_CHARS),
  channel: ImportChannelSchema,
  /** Required for a Superadmin; ignored for other roles (their own company). */
  company_id: positiveInt.optional(),
  rows: ImportRowsSchema,
});
export type CreatePlanBody = z.infer<typeof CreatePlanBodySchema>;

export const AppendRowsBodySchema = z.object({
  version: z.number().int().nonnegative(),
  rows: ImportRowsSchema,
});
export type AppendRowsBody = z.infer<typeof AppendRowsBodySchema>;

export const RowChangeSchema = z
  .object({
    row_ref: z.string().trim().min(1).max(IMPORT_LIMITS.ROW_REF_MAX_CHARS),
    set: ImportRowShape.partial().omit({ row_ref: true }).optional(),
    skip: z.boolean().optional(),
  })
  .refine((c) => c.set !== undefined || c.skip !== undefined, { message: "A change needs set or skip" });
export type RowChange = z.infer<typeof RowChangeSchema>;

export const PatchPlanBodySchema = z
  .object({
    version: z.number().int().nonnegative(),
    changes: z.array(RowChangeSchema).max(IMPORT_LIMITS.ROWS_PER_REQUEST).optional(),
    activity_matches: z.array(ActivityMatchSchema).max(IMPORT_LIMITS.ROWS_PER_REQUEST).optional(),
  })
  .refine((b) => (b.changes?.length ?? 0) + (b.activity_matches?.length ?? 0) > 0, {
    message: "Send changes or activity_matches",
  });
export type PatchPlanBody = z.infer<typeof PatchPlanBodySchema>;

export const CommitPlanBodySchema = z.object({
  version: z.number().int().nonnegative(),
  skip_rows_with_issues: z.boolean(),
  idempotency_key: z.string().trim().min(1).max(200),
});
export type CommitPlanBody = z.infer<typeof CommitPlanBodySchema>;

const pageQuery = z.coerce.number().int().positive().optional();

export const GetPlanQuerySchema = z.object({
  state: RowStateSchema.optional(),
  code: RowIssueCodeSchema.optional(),
  page: pageQuery,
  page_size: z.coerce.number().int().positive().max(IMPORT_LIMITS.MAX_PAGE_SIZE).optional(),
});
export type GetPlanQuery = z.infer<typeof GetPlanQuerySchema>;

export const ListBatchesQuerySchema = z.object({
  company_id: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "approved", "rejected", "mixed"]).optional(),
  channel: ImportChannelSchema.optional(),
  page: pageQuery,
});
export type ListBatchesQuery = z.infer<typeof ListBatchesQuerySchema>;

export const UploadBatchSummarySchema = z.object({
  upload_batch_id: z.string(),
  channel: ImportChannelSchema,
  source_name: z.string().nullable(),
  created_by: z.object({ user_id: positiveInt.nullable(), name: z.string().nullable() }),
  created_at: z.string(),
  rows: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  tco2e: z.number(),
});
export type UploadBatchSummary = z.infer<typeof UploadBatchSummarySchema>;

export const ContextQuerySchema = z.object({ company_id: z.coerce.number().int().positive().optional() });
export const ActivitiesQuerySchema = z.object({
  site_id: z.coerce.number().int().positive(),
  category_id: z.coerce.number().int().positive(),
  q: z.string().max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS).optional(),
  limit: z.coerce.number().int().positive().max(IMPORT_LIMITS.MAX_PAGE_SIZE).optional(),
});
export const ReadinessQuerySchema = z.object({
  company_id: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(2000).max(2100),
});

// ---------------------------------------------------------------------------
// §8 MCP tool inputs (IM7 read tools, IM8 import tools)
// The MCP SDK derives each tool's JSON input schema from these objects.
// ---------------------------------------------------------------------------

const companyId = positiveInt.describe("Client id, from whoami or list_sites_and_categories");

export const ToolInputs = {
  // IM7
  whoami: z.object({}),
  list_sites_and_categories: z.object({ company_id: companyId }),
  get_category_form: z.object({ site_id: positiveInt, category_id: positiveInt }),
  find_activity: z.object({
    site_id: positiveInt,
    category_id: positiveInt,
    query: z.string().trim().min(1).max(IMPORT_LIMITS.ACTIVITY_TEXT_MAX_CHARS),
  }),
  check_readiness: z.object({ company_id: companyId, year: z.number().int().min(2000).max(2100) }),
  // IM8
  plan_import: z.object({
    company_id: companyId,
    source_name: z.string().trim().min(1).max(IMPORT_LIMITS.SOURCE_NAME_MAX_CHARS),
    rows: ImportRowsSchema,
    plan_id: uuid.optional().describe("Append to this draft plan instead of creating one"),
    version: z.number().int().nonnegative().optional().describe("Required when plan_id is given"),
  }),
  get_import_plan: z.object({
    plan_id: uuid,
    state: RowStateSchema.optional(),
    code: RowIssueCodeSchema.optional(),
    page: z.number().int().positive().optional(),
  }),
  update_import_plan: z.object({
    plan_id: uuid,
    version: z.number().int().nonnegative(),
    changes: z.array(RowChangeSchema).max(IMPORT_LIMITS.ROWS_PER_REQUEST).optional(),
    activity_matches: z.array(ActivityMatchSchema).max(IMPORT_LIMITS.ROWS_PER_REQUEST).optional(),
  }),
  commit_import: z.object({
    plan_id: uuid,
    version: z.number().int().nonnegative(),
    skip_rows_with_issues: z.boolean(),
    confirm: z.literal(true).describe("Only after the user has seen the totals and said yes"),
  }),
  cancel_import_plan: z.object({ plan_id: uuid }),
  list_upload_batches: z.object({
    company_id: companyId,
    status: z.enum(["pending", "approved", "rejected", "mixed"]).optional(),
    page: z.number().int().positive().optional(),
  }),
} as const;

export type ToolName = keyof typeof ToolInputs;
export type ToolInput<T extends ToolName> = z.infer<(typeof ToolInputs)[T]>;

export const TOOL_NAMES = Object.keys(ToolInputs) as ToolName[];

/** Tools that only read (MCP `readOnlyHint: true`). */
export const READ_ONLY_TOOLS: readonly ToolName[] = [
  "whoami",
  "list_sites_and_categories",
  "get_category_form",
  "find_activity",
  "check_readiness",
  "get_import_plan",
  "list_upload_batches",
];

/** MCP error result shape (§9). */
export const McpToolErrorSchema = z.object({
  code: z.enum(IMPORT_ERROR_CODES as [string, ...string[]]),
  details: z.unknown().optional(),
});
export type McpToolError = z.infer<typeof McpToolErrorSchema>;
