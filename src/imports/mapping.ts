/**
 * Smart Excel import contracts (XI0, docs/excel-import/01-contracts.md).
 *
 * A MappingProposal is what python_AI_service works out from a workbook for
 * ONE site (imports are site-wise, Shyam 2026-10-14) and what the user
 * confirms on screen; rows_from_proposal turns it into ImportRows. A
 * MappingProfile is one confirmed sheet mapping remembered per company (XI3).
 *
 * Every site_id, category_id, field key and factor_name in a proposal must
 * exist in the caller's ImportContext; the engine drops anything else and
 * records NOT_IN_CONTEXT. That rule is enforced by code, not by this schema.
 */
import { z } from "zod";
import { IMPORT_LIMITS } from "./limits";
import { CreatePlanBodySchema, ImportRowMetaSchema, MappingSourceSchema, YearTypeSchema } from "./contracts";

const positiveInt = z.number().int().positive();
const confidence = z.number().min(0).max(1);
const text = z.string().max(IMPORT_LIMITS.MAPPING_TEXT_MAX_CHARS);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Where a part of the mapping came from; "mixed" is for a whole sheet. */
export const SheetSourceSchema = z.enum([...MappingSourceSchema.options, "mixed"]);
export type SheetSource = z.infer<typeof SheetSourceSchema>;

export const SheetLayoutSchema = z.enum(["rows", "months_as_columns"]);

/** The category of a sheet: one for the whole sheet, or read per row from a column. */
export const ResolvedCategorySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), id: positiveInt, label: text, confidence, source: MappingSourceSchema }),
  z.object({
    kind: z.literal("column"),
    column: text,
    values: z.array(z.object({ text, id: positiveInt.nullable(), confidence, source: MappingSourceSchema })).max(IMPORT_LIMITS.MAPPING_DISTINCT_VALUES_PER_COLUMN),
  }),
]);
export type ResolvedCategory = z.infer<typeof ResolvedCategorySchema>;

export const SheetPeriodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("column"), column: text }),
  z.object({ kind: z.literal("monthly_fixed"), date: isoDate }),
  z.object({ kind: z.literal("yearly"), year_type: YearTypeSchema, year: z.number().int().min(2000).max(2100) }),
  z.object({ kind: z.literal("months_as_columns"), columns: z.array(z.object({ column: text, date: isoDate })).min(1).max(120) }),
]);
export type SheetPeriod = z.infer<typeof SheetPeriodSchema>;

export const FieldMappingSchema = z.object({
  key: z.string().max(100),
  label: text,
  required: z.boolean(),
  column: text.nullable(),
  confidence,
  source: MappingSourceSchema,
  skipped: z.boolean().default(false),
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const ProposedActivityMatchSchema = z.object({
  sheet_text: text,
  category_id: positiveInt,
  factor_name: text.nullable(),
  confidence,
  source: MappingSourceSchema,
  save_mapping: z.boolean().default(false),
});
export type ProposedActivityMatch = z.infer<typeof ProposedActivityMatchSchema>;

/** A sheet that names other sites: informational, the rows get SITE_NOT_ALLOWED. */
export const SiteColumnSchema = z.object({
  column: text,
  values: z.array(z.object({ text, matches_site: z.boolean() })).max(IMPORT_LIMITS.MAPPING_DISTINCT_VALUES_PER_COLUMN),
});

export const SheetProposalSchema = z
  .object({
    sheet_name: text,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex"),
    header_row: positiveInt,
    data_rows: z.number().int().nonnegative(),
    layout: SheetLayoutSchema,
    /** The site chosen on screen 1; a proposal never changes it. */
    site_id: positiveInt,
    site_column: SiteColumnSchema.nullable().default(null),
    category: ResolvedCategorySchema,
    period: SheetPeriodSchema,
    fields: z.array(FieldMappingSchema),
    activities: z.array(ProposedActivityMatchSchema),
    /** Names the model gave that are not in the caller's context; dropped. */
    not_in_context: z.array(text).default([]),
    confidence,
    source: SheetSourceSchema,
    /** Left out of the plan by the user. */
    excluded: z.boolean().default(false),
  })
  .strip();
export type SheetProposal = z.infer<typeof SheetProposalSchema>;

export const MappingProposalSchema = z
  .object({
    document_id: positiveInt,
    site_id: positiveInt,
    sheets: z.array(SheetProposalSchema).max(IMPORT_LIMITS.MAPPING_SHEETS_PER_WORKBOOK),
    /** Telemetry only. `error`: why the model call gave no usable answer, as a code (`http_402`, an error type), present only on a failure. */
    model: z
      .object({ name: z.string().max(100), calls: z.number().int().nonnegative(), cached_profile_hits: z.number().int().nonnegative(), error: z.string().max(60).optional() })
      .optional(),
  })
  .strip()
  .refine((p) => p.sheets.every((s) => s.site_id === p.site_id), { message: "every sheet must be for the proposal's site", path: ["sheets"] });
export type MappingProposal = z.infer<typeof MappingProposalSchema>;

/**
 * `POST /imports/plans` body with `mapping` validated as a MappingProposal.
 * Lives here, not in contracts.ts, because this module already imports from
 * contracts (a lazy back-reference would be circular at load time). The plans
 * controller parses with this, so an invalid proposal is a 400
 * IMPORT_VALIDATION with a `mapping.…` path like any other body error.
 */
export const CreatePlanWithMappingBodySchema = CreatePlanBodySchema.extend({ mapping: MappingProposalSchema.optional() });
export type CreatePlanWithMappingBody = z.infer<typeof CreatePlanWithMappingBodySchema>;

/** `GET /imports/mapping-profiles` row (XI3). sheet_proposal is a SheetProposal without `activities[].save_mapping`. */
export const MappingProfileSchema = z.object({
  id: z.uuid(),
  company_id: positiveInt,
  site_id: positiveInt,
  category_id: positiveInt.nullable(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  sheet_proposal: SheetProposalSchema,
  confirmed_by: positiveInt.nullable(),
  confirmed_at: z.string().nullable(),
  uses: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MappingProfile = z.infer<typeof MappingProfileSchema>;

export const ListMappingProfilesQuerySchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  site_id: z.coerce.number().int().positive(),
  company_id: z.coerce.number().int().positive().optional(),
});

/** Whether a part needs the user's eyes before Continue (decision 4). */
export const needsConfirmation = (c: number): boolean => c < IMPORT_LIMITS.MAPPING_CONFIRM_BELOW;

export { ImportRowMetaSchema };
