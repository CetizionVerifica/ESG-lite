/**
 * Design Studio contracts (DS-0) §1, §2, §2.1: data sources, bindings, data
 * tokens and report inputs. Numbers on a page come only from a binding,
 * resolved by src/studio/sources/ (DS-2); `custom` data is never a reported
 * figure (it shows "Unlinked data").
 */
import { z } from "zod";
import { MeasureSchema, NumberFormatSchema, YearRefSchema, type ReportKind } from "./enums";

export const DATA_SOURCES = ["kpi", "ghg", "input", "custom"] as const;
export const DataSourceSchema = z.enum(DATA_SOURCES);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const GHG_METRICS = [
  "total",
  "scope1",
  "scope2_location",
  "scope2_market",
  "scope3",
  "scope3_category",
  "biogenic_co2",
  "gas_co2",
  "gas_ch4",
  "gas_n2o",
  "gas_other",
  "intensity_revenue",
  "intensity_output",
  "intensity_employee",
  "base_year_total",
  "dq_score",
  "primary_data_pct",
  "sites_covered",
  "months_covered",
] as const;
export const GhgMetricSchema = z.enum(GHG_METRICS);
export type GhgMetric = z.infer<typeof GhgMetricSchema>;

export const GHG_BREAKDOWNS = ["scope", "scope3_category", "site", "month", "quarter", "gas", "fuel", "source_category"] as const;
export const GhgBreakdownSchema = z.enum(GHG_BREAKDOWNS);
export type GhgBreakdown = z.infer<typeof GhgBreakdownSchema>;

/** D7: market-based Scope 2 isn't recorded; a binding to it resolves as unavailable (DS_SOURCE_UNAVAILABLE). */
export const UNAVAILABLE_GHG_METRICS: readonly GhgMetric[] = ["scope2_market"];

// ---------------------------------------------------------------------------
// Bindings (§2): RS `Binding` becomes the `kpi` variant.
// ---------------------------------------------------------------------------

/** A KPI code or an ESG headline code (src/kpi/esg/headlines.ts). */
export const KpiRefSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/, "A KPI or headline code");
const YearSchema = z.number().int().min(1990).max(2100);
export const BindingYearsSchema = z.union([z.object({ last: z.number().int().min(1).max(20) }).strict(), z.array(YearSchema).min(1).max(20)]);
export const SitesSchema = z.union([z.literal("all"), z.array(z.number().int().positive()).min(1).max(500)]);
export type Sites = z.infer<typeof SitesSchema>;

export const KpiBindingSchema = z
  .object({
    source: z.literal("kpi"),
    kpis: z.array(KpiRefSchema).min(1).max(50),
    years: BindingYearsSchema,
    sites: SitesSchema,
    unit: z.string().min(1).max(40).optional(),
    breakdown: z.string().min(1).max(80).optional(),
    compare: z.enum(["prior", "base", "target"]).optional(),
  })
  .strict();
export type KpiBinding = z.infer<typeof KpiBindingSchema>;

export const GhgBindingSchema = z
  .object({
    source: z.literal("ghg"),
    metric: GhgMetricSchema,
    years: BindingYearsSchema,
    sites: SitesSchema,
    breakdown: GhgBreakdownSchema.optional(),
    scope3Category: z.number().int().min(1).max(15).optional(),
    top: z.number().int().min(1).max(50).optional(),
    compare: z.enum(["prior", "base"]).optional(),
  })
  .strict()
  .refine((b) => b.metric !== "scope3_category" || b.scope3Category !== undefined || b.breakdown === "scope3_category", {
    message: "scope3_category needs scope3Category (1–15) or breakdown 'scope3_category'",
    path: ["scope3Category"],
  });
export type GhgBinding = z.infer<typeof GhgBindingSchema>;

// ---------------------------------------------------------------------------
// Report inputs (§2.1): disclosures that aren't in the data.
// ---------------------------------------------------------------------------

export const REPORT_INPUT_KEYS = [
  "consolidation_approach",
  "responsible_person",
  "reporting_period",
  "base_year",
  "recalculation_policy",
  "significance_threshold_pct",
  "gwp_set",
  "exclusions",
  "scope2_instruments",
  "uncertainty_statement",
  "verification",
  "conformance",
  "revenue",
  "revenue_ppp_rate",
  "output_units",
  "employees",
  "leadership_message",
  "about_company",
] as const;
export const ReportInputKeySchema = z.enum(REPORT_INPUT_KEYS);
export type ReportInputKey = z.infer<typeof ReportInputKeySchema>;

/** Which kinds each input belongs to (§2.1 "Kind" column). */
export const REPORT_INPUT_KINDS: Record<ReportInputKey, readonly ReportKind[]> = {
  consolidation_approach: ["ghg"],
  responsible_person: ["ghg"],
  reporting_period: ["ghg", "sustainability"],
  base_year: ["ghg"],
  recalculation_policy: ["ghg"],
  significance_threshold_pct: ["ghg"],
  gwp_set: ["ghg"],
  exclusions: ["ghg"],
  scope2_instruments: ["ghg"],
  uncertainty_statement: ["ghg"],
  verification: ["ghg", "sustainability"],
  conformance: ["ghg"],
  revenue: ["ghg"],
  revenue_ppp_rate: ["ghg"],
  output_units: ["ghg"],
  employees: ["ghg"],
  leadership_message: ["sustainability"],
  about_company: ["sustainability"],
};
export const inputKeysFor = (kind: ReportKind): ReportInputKey[] => REPORT_INPUT_KEYS.filter((k) => REPORT_INPUT_KINDS[k].includes(kind));

export const INPUT_SOURCES = ["company", "typed", "kpi"] as const;
export const InputSourceSchema = z.enum(INPUT_SOURCES);
export type InputSource = z.infer<typeof InputSourceSchema>;

export const VERIFICATION_STATUSES = ["none", "limited", "reasonable"] as const;
export const CONFORMANCE_CODES = ["GHGP", "ISO14064"] as const;
/** `MIXED` when the data uses more than one GWP set (prefill, DS-2). */
export const GWP_SETS = ["AR4", "AR5", "AR6", "MIXED"] as const;

const Text = (max: number) => z.string().max(max);
const NonNegative = z.number().finite().min(0);

/** The value each input holds. */
export const REPORT_INPUT_VALUE_SCHEMAS = {
  consolidation_approach: Text(200),
  responsible_person: Text(200),
  reporting_period: Text(200),
  base_year: z.number().int().min(1990).max(2100),
  recalculation_policy: Text(3000),
  significance_threshold_pct: z.number().finite().min(0).max(100),
  gwp_set: z.enum(GWP_SETS),
  exclusions: z.array(z.object({ what: Text(200).min(1), reason: Text(1000) }).strict()).max(50),
  scope2_instruments: Text(3000),
  uncertainty_statement: Text(3000),
  verification: z
    .object({ status: z.enum(VERIFICATION_STATUSES), provider: Text(200).optional(), statementAssetId: z.string().min(1).max(80).optional() })
    .strict(),
  conformance: z.array(z.enum(CONFORMANCE_CODES)).min(1).max(2),
  revenue: NonNegative,
  revenue_ppp_rate: NonNegative,
  output_units: NonNegative,
  employees: NonNegative,
  leadership_message: Text(20000),
  about_company: Text(20000),
} satisfies Record<ReportInputKey, z.ZodType>;

const InputMeta = {
  source: InputSourceSchema,
  updatedBy: z.number().int().positive().nullable(),
  updatedAt: z.string().min(1).max(40),
};

/** `{value, source, updatedBy, updatedAt}` per key; `report_doc.inputs jsonb`. */
const entry = <T extends z.ZodType>(value: T) => z.object({ value, ...InputMeta }).strict().optional();
const V = REPORT_INPUT_VALUE_SCHEMAS;
export const ReportInputsSchema = z
  .object({
    consolidation_approach: entry(V.consolidation_approach),
    responsible_person: entry(V.responsible_person),
    reporting_period: entry(V.reporting_period),
    base_year: entry(V.base_year),
    recalculation_policy: entry(V.recalculation_policy),
    significance_threshold_pct: entry(V.significance_threshold_pct),
    gwp_set: entry(V.gwp_set),
    exclusions: entry(V.exclusions),
    scope2_instruments: entry(V.scope2_instruments),
    uncertainty_statement: entry(V.uncertainty_statement),
    verification: entry(V.verification),
    conformance: entry(V.conformance),
    revenue: entry(V.revenue),
    revenue_ppp_rate: entry(V.revenue_ppp_rate),
    output_units: entry(V.output_units),
    employees: entry(V.employees),
    leadership_message: entry(V.leadership_message),
    about_company: entry(V.about_company),
  } satisfies Record<ReportInputKey, z.ZodType>)
  .strict();
export type ReportInputs = z.infer<typeof ReportInputsSchema>;
export type ReportInput<K extends ReportInputKey = ReportInputKey> = { value: z.infer<(typeof REPORT_INPUT_VALUE_SCHEMAS)[K]>; source: InputSource; updatedBy: number | null; updatedAt: string };

export const InputBindingSchema = z.object({ source: z.literal("input"), key: ReportInputKeySchema }).strict();
export type InputBinding = z.infer<typeof InputBindingSchema>;

/** Typed table data (≤ 200 rows × 20 columns). Never a reported figure. */
export const CustomDataSchema = z
  .object({
    source: z.literal("custom"),
    columns: z.array(z.string().max(120)).min(1).max(20),
    rows: z.array(z.array(z.union([z.string().max(500), z.number().finite()])).max(20)).max(200),
  })
  .strict()
  .refine((d) => d.rows.every((r) => r.length === d.columns.length), { message: "Every row needs one cell per column", path: ["rows"] });
export type CustomData = z.infer<typeof CustomDataSchema>;

export const BindingSchema = z.union([KpiBindingSchema, GhgBindingSchema, InputBindingSchema, CustomDataSchema]);
export type Binding = KpiBinding | GhgBinding | InputBinding | CustomData;

/**
 * A text chip (TipTap node `data`): one value. `year` is kept from a v1 KpiToken
 * (RS YearRef: current / prior / base / a year) so the upgrade loses nothing;
 * without it the binding's latest year is meant.
 */
export const DataTokenAttrsSchema = z
  .object({
    binding: z.union([GhgBindingSchema, KpiBindingSchema]),
    measure: MeasureSchema,
    format: NumberFormatSchema.optional(),
    year: YearRefSchema.optional(),
  })
  .strict();
export const DataTokenSchema = z.object({ type: z.literal("data"), attrs: DataTokenAttrsSchema }).strict();
export type DataToken = z.infer<typeof DataTokenSchema>;

/** RS v1 KpiToken (read by upgradeV1 only). */
export const KpiTokenV1Schema = z
  .object({
    type: z.literal("kpi"),
    attrs: z
      .object({
        kpi: KpiRefSchema,
        year: YearRefSchema,
        measure: MeasureSchema,
        unit: z.string().max(40).optional(),
        format: NumberFormatSchema.optional(),
        sites: SitesSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type KpiTokenV1 = z.infer<typeof KpiTokenV1Schema>;

/** The source a binding reads, for data marks (`data-source`) and checks. */
export const bindingSource = (b: Binding): DataSource => b.source;
