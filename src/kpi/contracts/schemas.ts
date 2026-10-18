/**
 * KPI contracts (KPI-0): zod schemas for the request bodies and queries of
 * 01-contracts §3, plus the library row shapes of §2. The owning module (named
 * per block) builds the endpoint; it imports the schema from here and never
 * redefines it. Unknown keys are stripped (zod's default), so a client may send
 * extra fields such as `company_id` for a Superadmin.
 */
import { z } from "zod";
import {
  AutoSourceKeySchema,
  EsrsTopicSchema,
  FrameworkCodeSchema,
  KpiAggregationSchema,
  KpiFrequencySchema,
  KpiLevelSchema,
  KpiPillarSchema,
  KpiSourceSchema,
  KpiTopicSchema,
  KpiValueStatusSchema,
  KpiValueTypeSchema,
  MappingFitSchema,
  RequirementLevelSchema,
  TargetDirectionSchema,
  UnitDimensionSchema,
  YearTypeSchema,
} from "./enums";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export const IdSchema = z.coerce.number().int().positive();
const id = z.number().int().positive();
const year = z.coerce.number().int().min(1990).max(2100);
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a calendar date");
const text = (max = 2000) => z.string().trim().min(1).max(max);
const optionalText = (max = 2000) => z.string().trim().max(max).nullable().optional();
/** A KPI code: upper-case letters, digits and underscores (`ENERGY_TOTAL`). */
export const KpiCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/, "Use capitals, digits and underscores, e.g. ENERGY_TOTAL");
const unit = z.string().trim().min(1).max(40);
// http(s) only: these render as links (evidence, framework sources), so javascript: and data: are refused.
const url = z.string().trim().url().max(1000).refine((v) => /^https?:\/\//i.test(v), "Use an http or https link.");
/** Query flags arrive as strings. */
const queryBool = z.enum(["true", "false"]).transform((v) => v === "true");

// ---------------------------------------------------------------------------
// KPI-2 library (§2): definitions, frameworks, disclosures, mappings
// ---------------------------------------------------------------------------

/** `kpi_definition.breakdowns`: the parts a value may be split into, and the options of a `choice` KPI. */
export const BreakdownsSchema = z.object({
  by: z.array(z.string().min(1).max(40)).max(3).optional(),
  values: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(40).optional(),
  choices: z.array(z.string().min(1).max(80)).max(40).optional(),
});
export type Breakdowns = z.infer<typeof BreakdownsSchema>;

const definitionFields = {
  code: KpiCodeSchema,
  name: text(200),
  question: text(500),
  help: optionalText(4000),
  topic: KpiTopicSchema,
  value_type: KpiValueTypeSchema,
  unit_dimension: UnitDimensionSchema,
  canonical_unit: unit.nullable(),
  allowed_units: z.array(unit).max(20),
  aggregation: KpiAggregationSchema,
  level: KpiLevelSchema,
  default_frequency: KpiFrequencySchema,
  source: KpiSourceSchema,
  auto_source: AutoSourceKeySchema.nullable().optional(),
  formula: z.string().trim().min(1).max(500).nullable().optional(),
  breakdowns: BreakdownsSchema.nullable().optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  active: z.boolean().optional(),
  /** D19: defaults to TOPIC_PILLAR[topic]; on a library KPI only the Superadmin changes it. */
  pillar: KpiPillarSchema.optional(),
};

const definitionRules = (d: Partial<Record<keyof typeof definitionFields, unknown>>, ctx: z.RefinementCtx) => {
  if (d.source === "auto" && !d.auto_source) ctx.addIssue({ code: "custom", path: ["auto_source"], message: "An auto KPI names its auto_source." });
  if (d.source !== undefined && d.source !== "auto" && d.auto_source) ctx.addIssue({ code: "custom", path: ["auto_source"], message: "Only an auto KPI has an auto_source." });
  if (d.source === "formula" && !d.formula) ctx.addIssue({ code: "custom", path: ["formula"], message: "A formula KPI has a formula." });
  if (d.source !== undefined && d.source !== "formula" && d.formula) ctx.addIssue({ code: "custom", path: ["formula"], message: "Only a formula KPI has a formula." });
};

export const KpiDefinitionCreateSchema = z.object(definitionFields).superRefine(definitionRules);
export type KpiDefinitionCreate = z.infer<typeof KpiDefinitionCreateSchema>;
/** PUT: any subset; `code` can't change once values may point at it. */
export const KpiDefinitionUpdateSchema = z.object(definitionFields).omit({ code: true }).partial().superRefine(definitionRules);
export type KpiDefinitionUpdate = z.infer<typeof KpiDefinitionUpdateSchema>;

const frameworkFields = {
  code: FrameworkCodeSchema,
  version: text(40),
  name: text(200),
  source_url: url,
  active: z.boolean().optional(),
  default_for_new: z.boolean().optional(),
};
export const KpiFrameworkCreateSchema = z.object(frameworkFields);
export const KpiFrameworkUpdateSchema = z.object(frameworkFields).omit({ code: true, version: true }).partial();

const disclosureFields = {
  framework_id: id,
  code: text(40),
  title: text(300),
  section: text(120),
  requirement: RequirementLevelSchema,
  esrs_topic: EsrsTopicSchema.nullable().optional(),
  source_url: url,
  sort_key: z.number().int().min(0).max(1_000_000).optional(),
  verified: z.boolean().optional(),
};
export const KpiDisclosureCreateSchema = z.object(disclosureFields);
export const KpiDisclosureUpdateSchema = z.object(disclosureFields).omit({ framework_id: true, code: true }).partial();

const mappingFields = {
  disclosure_id: id,
  kpi_definition_id: id,
  fit: MappingFitSchema,
  breakdown_key: z.string().regex(/^[a-z0-9_]{1,40}$/).nullable().optional(),
  display_unit: unit.nullable().optional(),
  note: optionalText(1000),
};
const mappingNote = (m: { fit?: string; note?: string | null }, ctx: z.RefinementCtx) => {
  if ((m.fit === "partial" || m.fit === "derived") && !m.note) ctx.addIssue({ code: "custom", path: ["note"], message: "A partial or derived fit carries a note." });
};
export const KpiMappingCreateSchema = z.object(mappingFields).superRefine(mappingNote);
export const KpiMappingUpdateSchema = z.object(mappingFields).omit({ disclosure_id: true, kpi_definition_id: true }).partial();

/** `GET /kpi/library/*?framework=&topic=&source=&active=` */
export const LibraryQuerySchema = z.object({
  framework: FrameworkCodeSchema.optional(),
  framework_id: IdSchema.optional(),
  topic: KpiTopicSchema.optional(),
  pillar: KpiPillarSchema.optional(),
  source: KpiSourceSchema.optional(),
  kpi: IdSchema.optional(),
  active: queryBool.optional(),
});

// ---------------------------------------------------------------------------
// KPI-3 setup
// ---------------------------------------------------------------------------

export const MaterialTopicSchema = z
  .object({ esrs_topic: EsrsTopicSchema, material: z.boolean(), reason: optionalText(1000) })
  .refine((t) => t.material || !!t.reason, { message: "Give a reason when a topic isn't material.", path: ["reason"] });

export const CompanyKpiSelectionSchema = z
  .object({
    kpi_definition_id: id,
    selected: z.boolean(),
    frequency: KpiFrequencySchema.nullable().optional(),
    reason_excluded: optionalText(1000),
  });

export const KpiAssignmentSchema = z.object({
  kpi_definition_id: id,
  site_id: id.nullable(),
  owner_user_id: id,
  reviewer_user_id: id.nullable().optional(),
});

/**
 * D17 (wave D): the owner of a KPI topic on a site (`site_id` null = company
 * level). `owner_user_id: null` removes the row; `reviewer_user_id` null = the
 * site's Managers.
 */
export const KpiTopicAssignmentSchema = z.object({
  site_id: id.nullable(),
  topic: KpiTopicSchema,
  owner_user_id: id.nullable(),
  reviewer_user_id: id.nullable().optional(),
});

/** D17: `PUT /kpi/people/:user_id/topics` (Admin, Superadmin; a Manager for their own sites). */
export const KpiPeopleTopicsPutSchema = z.object({
  topics: z.array(KpiTopicSchema).max(20),
  site_ids: z.array(id).max(500).optional(),
});

/** `PUT /kpi/setup` (Admin, Superadmin): any subset of the steps. */
export const KpiSetupPutSchema = z.object({
  settings: z
    .object({
      year_type: YearTypeSchema.optional(),
      first_year: z.number().int().min(1990).max(2100).optional(),
      due_day: z.number().int().min(1).max(28).optional(),
      complete: z.boolean().optional(),
    })
    .optional(),
  frameworks: z.array(id).max(20).optional(),
  material_topics: z.array(MaterialTopicSchema).max(10).optional(),
  kpis: z.array(CompanyKpiSelectionSchema).max(1000).optional(),
  assignments: z.array(KpiAssignmentSchema).max(5000).optional(),
  /** D17: replaces the whole set of topic assignments. */
  topic_assignments: z.array(KpiTopicAssignmentSchema).max(5000).optional(),
});

/** `POST /kpi/setup/custom-kpis` (Admin): a company KPI, optionally mapped. */
export const CustomKpiCreateSchema = z.object({
  ...definitionFields,
  source: z.enum(["manual", "formula"]),
  mappings: z.array(z.object({ disclosure_id: id, fit: MappingFitSchema, note: optionalText(1000) })).max(20).optional(),
});

// ---------------------------------------------------------------------------
// KPI-4 values (and KPI-7 entry)
// ---------------------------------------------------------------------------

/** `GET /kpi/values?kpi=&site=&from=&to=&status=`. `site=company` reads company-level values only. */
export const KpiValuesQuerySchema = z.object({
  kpi: z.union([IdSchema, KpiCodeSchema]).optional(),
  site: z.union([IdSchema, z.literal("company")]).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  status: KpiValueStatusSchema.optional(),
  frequency: KpiFrequencySchema.optional(),
});
export type KpiValuesQuery = z.infer<typeof KpiValuesQuerySchema>;

/**
 * One item of `PUT /kpi/values {items}`. The KPI by id or code; `site_id` null
 * for a company-level KPI; `period_start` must start a period of `frequency`
 * (the KPI's default when omitted) in `year_type` (CY when omitted, until
 * KPI-3's company settings).
 */
export const KpiValueItemSchema = z
  .object({
    kpi_definition_id: id.optional(),
    kpi_code: KpiCodeSchema.optional(),
    site_id: id.nullable(),
    period_start: IsoDateSchema,
    frequency: KpiFrequencySchema.optional(),
    year_type: YearTypeSchema.optional(),
    value_numeric: z.number().finite().nullable().optional(),
    value_text: z.string().max(10_000).nullable().optional(),
    unit: unit.nullable().optional(),
    breakdown: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.number().finite()).nullable().optional(),
    is_estimate: z.boolean().optional(),
    comment: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((i) => i.kpi_definition_id !== undefined || i.kpi_code !== undefined, { message: "Name the KPI (kpi_definition_id or kpi_code).", path: ["kpi_definition_id"] });
export type KpiValueItem = z.infer<typeof KpiValueItemSchema>;

/**
 * KPI-8: a reviewer's edit of a pending value, as an item of `PUT /kpi/values`
 * named by `id` (Manager of its site, or Superadmin). The value stays pending;
 * `reason` is required (KPI_REASON_REQUIRED) and audited.
 */
export const KpiValueReviewEditSchema = z.object({
  id: id,
  value_numeric: z.number().finite().nullable().optional(),
  value_text: z.string().max(10_000).nullable().optional(),
  unit: unit.nullable().optional(),
  breakdown: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.number().finite()).nullable().optional(),
  is_estimate: z.boolean().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  reason: optionalText(2000),
});
export type KpiValueReviewEdit = z.infer<typeof KpiValueReviewEditSchema>;

export const KpiValuesPutSchema = z.object({ items: z.array(z.unknown()).min(1).max(500) });

export const KpiIdsSchema = z.object({ ids: z.array(id).min(1).max(1000) });

/** `POST /kpi/values/:id/evidence` as JSON (a link to a stored document); multipart `file` uploads one. */
export const KpiEvidenceLinkSchema = z.object({ document_url: url, document_name: text(255) });

// ---------------------------------------------------------------------------
// KPI-8 review and close
// ---------------------------------------------------------------------------

export const KpiReviewSchema = z.object({
  ids: z.array(id).min(1).max(1000),
  only_ready: z.boolean().optional(),
  reason: optionalText(2000),
});

export const KpiPeriodLockQuerySchema = z.object({
  year: year,
  period: z.coerce.number().int().min(1).max(12).optional(),
  site: IdSchema.optional(),
});
export const KpiPeriodLockBodySchema = z.object({
  year: z.number().int().min(1990).max(2100),
  period: z.number().int().min(1).max(12).nullable().optional(),
  site_id: id.nullable().optional(),
  reason: optionalText(1000),
});

// ---------------------------------------------------------------------------
// KPI-5, KPI-9, KPI-10, KPI-11, KPI-12
// ---------------------------------------------------------------------------

export const KpiAutoRefreshQuerySchema = z.object({ year: year });

export const KpiTargetSchema = z.object({
  id: id.optional(),
  kpi_definition_id: id,
  site_id: id.nullable().optional(),
  baseline_year: z.number().int().min(1990).max(2100),
  baseline_value: z.number().finite(),
  target_year: z.number().int().min(1990).max(2100),
  target_value: z.number().finite(),
  direction: TargetDirectionSchema,
  note: optionalText(1000),
});

/** `GET /kpi/targets?kpi=&site=` (`site=company` for company targets only). */
export const KpiTargetsQuerySchema = z.object({
  kpi: IdSchema.optional(),
  site: z.union([IdSchema, z.literal("company")]).optional(),
});

export const KpiDashboardQuerySchema = z.object({
  year: year,
  framework: FrameworkCodeSchema.optional(),
  site: IdSchema.optional(),
  topic: KpiTopicSchema.optional(),
});

/** D19 (wave E) `GET /kpi/esg?year=&site=&pillar=&topic=`: the ESG dashboard. */
export const KpiEsgQuerySchema = z.object({
  year: year,
  site: IdSchema.optional(),
  pillar: KpiPillarSchema.optional(),
  topic: KpiTopicSchema.optional(),
});

/** `POST /kpi/dashboard/remind {kpi, site}`: the KPI's id, and its site (null = company level). */
export const KpiRemindSchema = z.object({
  kpi: id,
  site: id.nullable(),
});

export const KpiReportQuerySchema = z.object({
  year: year,
  format: z.enum(["json", "xlsx", "pdf"]).optional(),
  sites: z.string().regex(/^\d+(,\d+)*$/).optional(),
});

const blankToUndefined = (v: unknown) => (v === "" || v === "null" ? undefined : v);
/**
 * KPI-12 `POST /kpi/ai/suggest-values`: JSON `{document_id, …}`, or multipart
 * `file` with the same fields as strings. `site_id` narrows to one of the
 * caller's sites; `period` (YYYY-MM, default last month, as /kpi/my) picks
 * the due items; `kpis` narrows to some of them (codes; a code the caller
 * doesn't owe there is KPI_NOT_ASSIGNED).
 */
export const KpiSuggestValuesSchema = z.object({
  document_id: z.preprocess(blankToUndefined, IdSchema.optional()),
  site_id: z.preprocess(blankToUndefined, IdSchema.nullable().optional()),
  period: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM").optional()),
  period_start: z.preprocess(blankToUndefined, IsoDateSchema.optional()),
  kpis: z.preprocess((v) => (typeof v === "string" ? (v.trim() ? v.split(",").map((x) => x.trim()) : undefined) : v), z.array(KpiCodeSchema).max(200).optional()),
});
export const KpiSuggestMappingSchema = z.object({ name: text(200), question: text(500), unit: unit.nullable().optional(), topic: KpiTopicSchema });
