/**
 * Scope 3 contracts (S3-0) §4 and §5: zod schemas for the new columns and the
 * request bodies, plus the §10 additions whose fields §10 spells out.
 * Copied from docs/scope3/01-contracts.md. The owning module (named per
 * schema) adds the migration and the endpoint; it imports the schema from
 * here and never redefines it.
 *
 * The §5 request bodies and the Scope 3 report row come from the module
 * specs' "S3-0 follow-up" notes, folded into 01-contracts.md §4–§6.
 */
import { z } from "zod";
import { GhgCategoryNumberSchema, MethodSchema, Scope3SubSchema, ScopeSchema } from "./ghgCategory";
import { FactorTypeSchema, GasSchema, GwpSetSchema } from "./factor";
import { DataTypeSchema, DqSchema } from "./dq";
import { RowChecksSchema } from "./checks";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

const id = z.number().int().positive();
const year = z.number().int().min(1990).max(2100);
const month = z.number().int().min(1).max(12);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a calendar date");
const currency = z.string().regex(/^[A-Z]{3}$/, "Expected an ISO 4217 code such as USD");
/** ISO-3166 alpha-2, `GLO`, or a region code (§2). */
const geography = z.string().min(2).max(16);
const nonNegative = z.number().min(0);
const text = (max = 2000) => z.string().trim().min(1).max(max);
/** kgCO₂e kept as a decimal string, as `numeric` columns come back from Postgres. */
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "Expected a decimal number");

// ---------------------------------------------------------------------------
// §4 Category, boundary and consolidation (S3-1)
// ---------------------------------------------------------------------------

/** `category.scope` + `category.ghg_category`: a number only for Scope 3 (S3-1). */
export const CategoryGhgSchema = z
  .object({
    scope: ScopeSchema,
    ghg_category: GhgCategoryNumberSchema.nullable(),
  })
  .refine((c) => c.ghg_category === null || c.scope === "Scope 3", {
    message: "Only a Scope 3 category has a GHG Protocol category number.",
    path: ["ghg_category"],
  });

export const CONSOLIDATION_APPROACHES = ["operational_control", "equity_share", "financial_control"] as const;
export const ConsolidationApproachSchema = z.enum(CONSOLIDATION_APPROACHES);
export type ConsolidationApproach = z.infer<typeof ConsolidationApproachSchema>;

export const BOUNDARY_STATUSES = ["included", "excluded", "not_relevant", "screening"] as const;
export const BoundaryStatusSchema = z.enum(BOUNDARY_STATUSES);
export type BoundaryStatus = z.infer<typeof BoundaryStatusSchema>;

/** Table II relevance criteria ticks, criterion → ticked. */
export const RelevanceSchema = z.record(z.string(), z.boolean());

const reasonUnlessIncluded = <T extends { status: BoundaryStatus; reason?: string | null }>(v: T) =>
  v.status === "included" || !!v.reason?.trim();

/** `company_scope3_category` (S3-1); unique (company_id, ghg_category). */
export const CompanyScope3CategorySchema = z
  .object({
    id: id.optional(),
    company_id: id,
    ghg_category: GhgCategoryNumberSchema,
    status: BoundaryStatusSchema,
    reason: z.string().max(2000).nullable().optional(),
    method_note: z.string().max(2000).nullable().optional(),
    relevance: RelevanceSchema.nullable().optional(),
    updated_by: id.nullable().optional(),
    updated_at: z.string().optional(),
  })
  .refine(reasonUnlessIncluded, { message: "A reason is required unless the category is included.", path: ["reason"] });

/** `category_ghg_map_proposal` (S3-1 backfill). */
export const CategoryGhgMapProposalSchema = z.object({
  category_id: id,
  company_id: id,
  ghg_category: GhgCategoryNumberSchema,
  confidence: z.number().min(0).max(1),
  confirmed_by: id.nullable().optional(),
  confirmed_at: z.string().nullable().optional(),
});

/** `PUT /scope3/categories/:n` (S3-1, Admin and Superadmin). */
export const PutScope3CategoryBodySchema = z
  .object({
    status: BoundaryStatusSchema,
    reason: z.string().max(2000).nullable().optional(),
    method_note: z.string().max(2000).nullable().optional(),
    relevance: RelevanceSchema.optional(),
  })
  .refine(reasonUnlessIncluded, { message: "A reason is required unless the category is included.", path: ["reason"] });

/** `PUT /company/:id/consolidation-approach` (S3-1). */
export const PutConsolidationApproachBodySchema = z.object({ consolidation_approach: ConsolidationApproachSchema });

// ---------------------------------------------------------------------------
// §2 / §4 Factor metadata (S3-2)
// ---------------------------------------------------------------------------

export const GasPartsSchema = z.object({
  co2_kg: nonNegative.nullable().optional(),
  ch4_kg: nonNegative.nullable().optional(),
  n2o_kg: nonNegative.nullable().optional(),
  other_kgco2e: nonNegative.nullable().optional(),
});

/** The §2 fields every `emission_factors` row gets (S3-2). */
export const FactorMetadataSchema = GasPartsSchema.extend({
  factor_type: FactorTypeSchema,
  gwp_set: GwpSetSchema,
  geography,
  // Same limits as the columns (varchar 60/40, EmissionFactor.ts) and S3-2's validator (src/scope3/factors/meta.ts).
  dataset: text(60),
  dataset_version: z.string().max(40).nullable().optional(),
  biogenic_co2_kg: nonNegative.nullable().optional(),
  includes_wtt: z.boolean().optional(), // column default false; no parse default, so an edit that omits it keeps the stored value
  price_base_year: year.nullable().optional(),
  price_currency: currency.nullable().optional(),
}).refine((f) => f.factor_type !== "eeio_spend" || (f.price_base_year != null && f.price_currency != null), {
  message: "A spend (EEIO) factor needs its price base year and currency.",
  path: ["price_base_year"],
});
export type FactorMetadata = z.infer<typeof FactorMetadataSchema>;

/** `FactorSnapshot` gains these (§6). */
export const FactorSnapshotScope3FieldsSchema = z.object({
  factor_type: FactorTypeSchema,
  gwp_set: GwpSetSchema,
  geography,
  dataset: z.string(),
  dataset_version: z.string().nullable().optional(),
  gases: z.partialRecord(GasSchema, nonNegative).optional(),
});

// ---------------------------------------------------------------------------
// §4 / §10 Emission columns (S3-3, S3-4, S3-5, S3-6, S3-7, S3-12, S3-15)
// ---------------------------------------------------------------------------

/** `emission.fx` (S3-5). */
/** `emission.fx` (S3-5): 1 `currency` = `rate` `to` on `as_of`; `spend_date` is the purchase date the rate was looked up for. */
export const FxSchema = z.object({
  currency,
  to: currency,
  rate: z.number().positive(),
  as_of: isoDate,
  source: text(100),
  spend_date: isoDate.optional(),
});

/** `emission.proxy` (S3-12). */
export const ProxySchema = z.object({
  basis: text(200),
  coverage_pct: z.number().min(0).max(100),
  from: z.string().max(200),
});

/** The new nullable `emission` columns, by owning module. */
export const EmissionScope3FieldsSchema = z.object({
  method: MethodSchema.nullable().optional(), // S3-3
  dq: DqSchema.nullable().optional(), // S3-3
  data_type: DataTypeSchema.nullable().optional(), // S3-3
  is_estimate: z.boolean().optional(), // S3-3; column default false, no parse default (see includes_wtt)
  total_kgco2e: decimalString.nullable().optional(), // S3-4, beside total_emission
  fx: FxSchema.nullable().optional(), // S3-5
  supplier_id: id.nullable().optional(), // S3-6
  scope3_sub: Scope3SubSchema.nullable().optional(), // S3-7
  proxy: ProxySchema.nullable().optional(), // S3-12
  checks: RowChecksSchema.nullable().optional(), // S3-15
  gas_kg: z.partialRecord(GasSchema, nonNegative).nullable().optional(), // §10, from the factor's gas parts
  biogenic_kg: nonNegative.nullable().optional(), // §10
});
export type EmissionScope3Fields = z.infer<typeof EmissionScope3FieldsSchema>;

// ---------------------------------------------------------------------------
// §4 FX and deflators (S3-5)
// ---------------------------------------------------------------------------

/** `fx_rate`; unique (currency, date). */
export const FxRateSchema = z.object({ currency, date: isoDate, rate_to_usd: z.number().positive(), source: text(100) });

/** `GET /fx-rates?currency&date`. */
export const FxRatesQuerySchema = z.object({ currency, date: isoDate });

/** `price_deflator`: index with base 100 = the dataset base year. */
export const PriceDeflatorSchema = z.object({ country: geography, year, index: z.number().positive(), source: text(100) });

// ---------------------------------------------------------------------------
// §4 Suppliers (S3-6)
// ---------------------------------------------------------------------------

/** `supplier`; unique (company_id, lower(name)). */
export const SupplierSchema = z.object({
  supplier_id: id.optional(),
  company_id: id,
  name: text(200),
  country: geography.nullable().optional(),
  email: z.email().nullable().optional(),
  created_by: id.optional(),
});

/** `POST /suppliers`, `PUT /suppliers/:id`. */
export const SupplierBodySchema = z.object({
  name: text(200),
  country: geography.nullable().optional(),
  email: z.email().nullable().optional(),
});

export const SUPPLIER_FACTOR_SOURCES = ["supplier_request", "manual"] as const;

/** `supplier_factor`: boundary is cradle-to-gate only (`SUPPLIER_FACTOR_BOUNDARY`). */
export const SupplierFactorSchema = z.object({
  id: id.optional(),
  company_id: id,
  supplier_id: id,
  item: text(200),
  unit: text(50),
  kgco2e_per_unit: z.number().min(0),
  boundary: z.literal("cradle_to_gate"),
  reference_year: year,
  gwp_set: GwpSetSchema,
  evidence_document_id: id.nullable().optional(),
  source: z.enum(SUPPLIER_FACTOR_SOURCES),
  material_factor_id: id.nullable().optional(),
});

/** `POST /suppliers/:id/factors` (manual entry). */
export const SupplierFactorBodySchema = z.object({
  item: text(200),
  unit: text(50),
  kgco2e_per_unit: z.number().min(0),
  boundary: z.literal("cradle_to_gate"),
  reference_year: year,
  gwp_set: GwpSetSchema,
  evidence_document_id: id.nullable().optional(),
  material_factor_id: id.nullable().optional(),
});

/** `supplier_facility_data` (hybrid method). */
export const SupplierFacilityDataSchema = z.object({
  id: id.optional(),
  company_id: id,
  supplier_id: id,
  year,
  scope12_tco2e: z.number().min(0),
  output_qty: z.number().positive(),
  output_unit: text(50),
  allocation_key: text(100),
});

// ---------------------------------------------------------------------------
// §4 / §10 Leased assets, franchises, investments (S3-11)
// ---------------------------------------------------------------------------

export const LEASE_ROLES = ["lessee", "lessor", "franchisee", "franchisor"] as const;
export const LeaseRoleSchema = z.enum(LEASE_ROLES);
/** §10: `site.lease_type`. */
export const LEASE_TYPES = ["finance", "operating"] as const;
export const LeaseTypeSchema = z.enum(LEASE_TYPES);

/** `site.lease_role`, `site.floor_area_m2`, `site.lease_type`. */
export const SiteLeaseSchema = z.object({
  lease_role: LeaseRoleSchema.nullable().optional(),
  floor_area_m2: z.number().positive().nullable().optional(),
  lease_type: LeaseTypeSchema.nullable().optional(),
});

/** `company.home_site_id`: company-level rows (Cat 15, franchises) go on the head-office site (§4). */
export const CompanyHomeSiteSchema = z.object({ home_site_id: id.nullable() });

export const INVESTMENT_TYPES = ["equity", "debt", "project"] as const;

/** `investment`, with the §10 revenue, currency and EEIO sector fields. */
export const InvestmentSchema = z.object({
  id: id.optional(),
  company_id: id,
  investee: text(200),
  type: z.enum(INVESTMENT_TYPES),
  share_pct: z.number().min(0).max(100),
  investee_scope12_tco2e: z.number().min(0).nullable().optional(),
  year,
  source: z.string().max(200).nullable().optional(),
  revenue: z.number().min(0).nullable().optional(),
  currency: currency.nullable().optional(),
  eeio_sector: z.string().max(100).nullable().optional(),
  sector_split: z.record(z.string(), z.number().min(0).max(1)).nullable().optional(),
});

const yearType = z.enum(["CY", "FY"]);

/** `POST /scope3/investments/plan` → an import plan, one yearly Cat 15 row per investment (S3-11). */
export const InvestmentsPlanBodySchema = z.object({ site_id: id, year, year_type: yearType });

// ---------------------------------------------------------------------------
// §4 / §10 Sold products (S3-10)
// ---------------------------------------------------------------------------

/** `product_sale`: `period` is a monthly date like `emission.date` (§10). */
export const ProductSaleSchema = z.object({
  id: id.optional(),
  company_id: id,
  product_id: id,
  period: isoDate,
  quantity: z.number().positive(),
  unit: text(50),
  region: z.string().max(100).nullable().optional(),
});

/** `product.eol_mix`: `[{treatment, share}]`, shares summing to 1 (§10). */
export const EolMixSchema = z
  .array(z.object({ treatment: text(100), share: z.number().min(0).max(1) }))
  .refine((mix) => Math.abs(mix.reduce((s, x) => s + x.share, 0) - 1) < 1e-6, "Treatment shares must add up to 1.");

/** `product.lifetime_uses`, `product.eol_mix`. */
export const ProductScope3FieldsSchema = z.object({
  lifetime_uses: z.number().positive().nullable().optional(),
  eol_mix: EolMixSchema.nullable().optional(),
});

/** `PUT /scope3/products/:id/use-profile`. */
export const PutUseProfileBodySchema = ProductScope3FieldsSchema;

/** `POST /scope3/sold-products/plan` → an import plan (Cat 10, 11, 12). */
export const SoldProductsPlanBodySchema = z.object({
  site_id: id,
  year,
  year_type: yearType,
  ghg_category: z.union([z.literal(10), z.literal(11), z.literal(12)]),
});

// ---------------------------------------------------------------------------
// §5 Commuting survey (S3-9)
// ---------------------------------------------------------------------------

export const COMMUTING_SURVEY_MAX_RESPONSES = 20_000;

/** `POST /scope3/commuting/surveys`: `ref` is the client's own code, never a name; responses are not stored. */
export const CommutingSurveyBodySchema = z.object({
  site_id: id,
  year,
  year_type: yearType,
  total_employees: z.number().int().positive(),
  responses: z
    .array(
      z.object({
        ref: z.string().max(100),
        mode: text(100),
        one_way_km: nonNegative,
        days_per_week: z.number().min(0).max(7),
        weeks_per_year: z.number().min(0).max(53),
      }),
    )
    .min(1)
    .max(COMMUTING_SURVEY_MAX_RESPONSES),
});

// ---------------------------------------------------------------------------
// §4 / §10 Base year and recalculation (S3-14)
// ---------------------------------------------------------------------------

/** `company_base_year`, with the §10 rationale, year type and snapshot. */
export const CompanyBaseYearSchema = z.object({
  company_id: id,
  base_year: year,
  scope: ScopeSchema,
  significance_pct: z.number().min(0).max(100).default(5),
  policy_note: z.string().max(4000).nullable().optional(),
  rationale: z.string().max(4000).nullable().optional(),
  year_type: z.enum(["CY", "FY"]).nullable().optional(),
  snapshot: z.unknown().optional(),
});

/** `PUT /scope3/base-year`. */
export const PutBaseYearBodySchema = CompanyBaseYearSchema.omit({ company_id: true, snapshot: true });

export const RECALCULATION_REASONS = ["methodology", "data_quality", "structural", "error"] as const;
export const RECALCULATION_STATUSES = ["proposed", "approved", "dismissed"] as const;

/** `recalculation_event`, with the §10 status, note, before and after. */
export const RecalculationEventSchema = z.object({
  id: id.optional(),
  company_id: id,
  reason: z.enum(RECALCULATION_REASONS),
  affected_years: z.array(year).min(1),
  delta_tco2e: z.number(),
  approved_by: id.nullable().optional(),
  created_at: z.string().optional(),
  status: z.enum(RECALCULATION_STATUSES).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

/** `POST /scope3/recalculations`: a reason is required (`RECALCULATION_REASON_REQUIRED`). */
export const PostRecalculationBodySchema = z.object({
  reason: z.enum(RECALCULATION_REASONS),
  affected_years: z.array(year).min(1),
  note: z.string().max(4000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// §4 / §5 / §10 Review workflow and month lock (S3-15)
// ---------------------------------------------------------------------------

/** `emission.status` gains `draft` (S3-15). */
export const EMISSION_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export const EmissionStatusSchema = z.enum(EMISSION_STATUSES);

/** `period_lock`: per site and month (D11); site null = every site, month null = the whole year. */
export const PeriodLockSchema = z.object({
  company_id: id,
  site_id: id.nullable(),
  year,
  month: month.nullable(),
  locked_by: id,
  locked_at: z.string(),
  reopened_by: id.nullable().optional(),
  reopened_at: z.string().nullable().optional(),
  reopened_reason: z.string().max(2000).nullable().optional(),
});

/** `POST /user/emissions/submit` `{ids}`: draft → pending, runs the checks. */
export const SubmitEmissionsBodySchema = z.object({ ids: z.array(id).min(1) });

/** `POST /periods/lock`. */
export const LockPeriodBodySchema = z.object({ site_id: id.nullable().optional(), year, month: month.nullable().optional() });

/** `POST /periods/unlock` `{reason}` (`UNLOCK_REASON_REQUIRED`). */
export const UnlockPeriodBodySchema = LockPeriodBodySchema.extend({ reason: text(2000) });

/** `GET /user/emissions?ready=1|0`. */
export const ReadyFilterSchema = z.object({ ready: z.enum(["0", "1"]).optional() });

/** `PUT /user/emissions/bulk-approve` `{ids, only_ready}`: rows that aren't ready are skipped and returned. */
export const BulkApproveBodySchema = z.object({ ids: z.array(id).min(1), only_ready: z.boolean().optional() });

/** `GET /user/emissions/:id/history?months=6`. */
export const EmissionHistoryQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });

/** `POST/DELETE /user/my-month/nothing`. */
export const NothingThisMonthBodySchema = z.object({ site_id: id, category_id: id, month: isoDate });

/** Notification kind for a submitted draft (S3-15). */
export const DRAFT_SUBMITTED_NOTIFICATION = "draft_submitted";

/** §10 `nothing_this_month`: a contributor's "Nothing this month" for a site, category and period. */
export const NothingThisMonthSchema = z.object({
  site_id: id,
  category_id: id,
  period: isoDate,
  user_id: id,
});

// ---------------------------------------------------------------------------
// §5 Screening (S3-12)
// ---------------------------------------------------------------------------

/** `GET /scope3/screening?year=`. */
export const ScreeningQuerySchema = z.object({ year: z.coerce.number().int().min(1990).max(2100) });

export const SCREENING_BASES = ["spend", "headcount", "revenue", "mass_sold", "other"] as const;

/** `scope3_screening_input`; unique (company_id, year, ghg_category, basis). */
export const ScreeningInputSchema = z.object({
  company_id: id,
  year,
  ghg_category: GhgCategoryNumberSchema,
  basis: z.enum(SCREENING_BASES),
  amount: nonNegative,
  currency: currency.nullable().optional(),
  eeio_sector: z.string().max(100).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  updated_by: id.nullable().optional(),
  updated_at: z.string().optional(),
});

/** `PUT /scope3/screening/inputs`. */
export const PutScreeningInputsBodySchema = z.object({
  year,
  inputs: z.array(ScreeningInputSchema.omit({ company_id: true, year: true, updated_by: true, updated_at: true })),
});

/** `POST /scope3/extrapolate` (`EXTRAPOLATION_BASIS_INVALID` for coverage outside 1–99, no source rows, no production). */
export const ExtrapolateBodySchema = z.object({
  ghg_category: GhgCategoryNumberSchema,
  site_id: id,
  year,
  year_type: yearType,
  basis: z.enum(["coverage", "intensity"]),
  coverage_pct: z.number().min(1).max(99).optional(),
  source_filter: z.record(z.string(), z.unknown()).optional(),
  output_site_ids: z.array(id).optional(),
}).refine((b) => b.basis !== "coverage" || b.coverage_pct !== undefined, {
  message: "coverage_pct is required when basis is coverage",
  path: ["coverage_pct"],
});

/** python_AI_service `POST /v1/scope3/eeio-sector` (S3-12). */
export const EeioSectorRequestSchema = z.object({
  lines: z.array(z.object({ description: z.string(), supplier: z.string().nullable().optional(), amount: z.number(), currency })).min(1),
  sectors: z.array(z.object({ code: z.string(), name: z.string() })).min(1),
});
export const EeioSectorResponseSchema = z.object({
  lines: z.array(z.object({ suggestions: z.array(z.object({ code: z.string(), confidence: z.number().min(0).max(100) })).max(3) })),
});

// ---------------------------------------------------------------------------
// §5 GHG Scope 3 report (S3-13)
// ---------------------------------------------------------------------------

/** One row of `GET /reports/ghg/scope3`: a category 1–15, or "Unmapped" (`n: null`). */
export const Scope3ReportRowSchema = z.object({
  n: GhgCategoryNumberSchema.nullable(),
  name: z.string(),
  direction: z.enum(["upstream", "downstream"]).nullable(),
  status: BoundaryStatusSchema.nullable(),
  reason: z.string().nullable(),
  method_note: z.string().nullable(),
  tco2e: z.number(),
  share_pct: z.number(),
  methods: z.partialRecord(MethodSchema, z.number()),
  primary_pct: z.number(),
  value_chain_pct: z.number(),
  proxy_pct: z.number(),
  dq: z.object({ overall: z.number().nullable(), good_pct: z.number(), fair_pct: z.number(), poor_pct: z.number() }),
  datasets: z.array(z.object({ dataset: z.string(), version: z.string().nullable(), factor_type: FactorTypeSchema })),
  gwp_sets: z.array(GwpSetSchema),
  /** null = "Not tracked" until `emission.biogenic_kg` is written. */
  biogenic_tco2e: z.number().nullable(),
  mapped_categories: z.array(z.object({ category_id: id, name: z.string() })),
});
export type Scope3ReportRow = z.infer<typeof Scope3ReportRowSchema>;

// ---------------------------------------------------------------------------
// §4 Audit
// ---------------------------------------------------------------------------

/** `audit_log.entity_type` values the Scope 3 modules write (the type accepts any `scope3_*`). */
export const SCOPE3_AUDIT_ENTITY_TYPES = [
  "scope3_boundary",
  "scope3_base_year",
  "scope3_recalculation",
  "scope3_period_lock",
  "scope3_supplier_factor",
] as const;

// ---------------------------------------------------------------------------
// §6 Form method options (S3-3 column, used by S3-8 to S3-11)
// ---------------------------------------------------------------------------

/** `column_config.method_options`: the methods a form offers, most specific first, each with the units it shows. */
export const MethodOptionsSchema = z
  .array(z.object({ method: MethodSchema.exclude(["unknown"]), units: z.array(text(50)).min(1) }))
  .min(1)
  .refine((opts) => new Set(opts.map((o) => o.method)).size === opts.length, "A method appears twice.");
export type MethodOptions = z.infer<typeof MethodOptionsSchema>;
