/**
 * KPI contracts (KPI-0) §1: enums. Copied from docs/kpi/01-contracts.md §1.
 * Changed only by a KPI-0 follow-up; every module imports from here and never
 * redefines a value. Labels: `labels.ts`.
 */
import { z } from "zod";

export const FRAMEWORK_CODES = ["GRI", "BRSR", "ESRS"] as const;
export const FrameworkCodeSchema = z.enum(FRAMEWORK_CODES);
export type FrameworkCode = z.infer<typeof FrameworkCodeSchema>;

export const REQUIREMENT_LEVELS = ["required", "if_material", "voluntary", "core"] as const;
export const RequirementLevelSchema = z.enum(REQUIREMENT_LEVELS);
export type RequirementLevel = z.infer<typeof RequirementLevelSchema>;

export const KPI_TOPICS = [
  "climate",
  "energy",
  "water",
  "waste",
  "pollution",
  "biodiversity",
  "materials",
  "workforce",
  "health_safety",
  "diversity",
  "training",
  "human_rights",
  "community",
  "customers",
  "governance",
  "ethics",
] as const;
export const KpiTopicSchema = z.enum(KPI_TOPICS);
export type KpiTopic = z.infer<typeof KpiTopicSchema>;

export const KPI_VALUE_TYPES = ["number", "percent", "integer", "currency", "yes_no", "choice", "text"] as const;
export const KpiValueTypeSchema = z.enum(KPI_VALUE_TYPES);
export type KpiValueType = z.infer<typeof KpiValueTypeSchema>;
/** Value types stored in `value_numeric` (yes_no also stores 1/0 there). */
export const NUMERIC_VALUE_TYPES: readonly KpiValueType[] = ["number", "percent", "integer", "currency"];

export const KPI_SOURCES = ["manual", "auto", "formula"] as const;
export const KpiSourceSchema = z.enum(KPI_SOURCES);
export type KpiSource = z.infer<typeof KpiSourceSchema>;

export const KPI_AGGREGATIONS = ["sum", "average", "weighted_average", "max", "latest", "none"] as const;
export const KpiAggregationSchema = z.enum(KPI_AGGREGATIONS);
export type KpiAggregation = z.infer<typeof KpiAggregationSchema>;

export const KPI_LEVELS = ["site", "company"] as const;
export const KpiLevelSchema = z.enum(KPI_LEVELS);
export type KpiLevel = z.infer<typeof KpiLevelSchema>;

export const KPI_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export const KpiFrequencySchema = z.enum(KPI_FREQUENCIES);
export type KpiFrequency = z.infer<typeof KpiFrequencySchema>;

export const KPI_VALUE_STATUSES = ["draft", "pending", "approved", "rejected"] as const;
export const KpiValueStatusSchema = z.enum(KPI_VALUE_STATUSES);
export type KpiValueStatus = z.infer<typeof KpiValueStatusSchema>;

export const MAPPING_FITS = ["exact", "partial", "derived"] as const;
export const MappingFitSchema = z.enum(MAPPING_FITS);
export type MappingFit = z.infer<typeof MappingFitSchema>;

/**
 * `AutoSourceKey` as 01-contracts §1 lists it. `ghg_scope3_category_n` is a
 * template: a stored key names the category, `ghg_scope3_category_1` …
 * `ghg_scope3_category_15` (AUTO_SOURCE_KEYS).
 */
export const AUTO_SOURCE_KEY_TEMPLATES = [
  "ghg_scope1",
  "ghg_scope2_location",
  "ghg_scope2_market",
  "ghg_scope3_total",
  "ghg_scope3_category_n",
  "energy_total",
  "energy_renewable",
  "energy_non_renewable",
  "production_output",
  "waste_total",
] as const;
export const AUTO_SOURCE_KEYS = [
  ...AUTO_SOURCE_KEY_TEMPLATES.filter((k) => k !== "ghg_scope3_category_n"),
  ...Array.from({ length: 15 }, (_, i) => `ghg_scope3_category_${i + 1}`),
] as readonly string[];
export const AutoSourceKeySchema = z.string().refine((k) => AUTO_SOURCE_KEYS.includes(k), "Unknown auto source");
export type AutoSourceKey = string;

/** `kpi_definition.unit_dimension` (01-contracts §2). Water is `volume`; percentages are `ratio`. */
export const UNIT_DIMENSIONS = ["energy", "mass", "volume", "count", "currency", "ratio", "time", "none"] as const;
export const UnitDimensionSchema = z.enum(UNIT_DIMENSIONS);
export type UnitDimension = z.infer<typeof UnitDimensionSchema>;

export const YEAR_TYPES = ["CY", "FY"] as const;
export const YearTypeSchema = z.enum(YEAR_TYPES);
export type YearType = z.infer<typeof YearTypeSchema>;

/** ESRS topical standards a disclosure may belong to (`kpi_disclosure.esrs_topic`) and D13 materiality. */
export const ESRS_TOPICS = ["E1", "E2", "E3", "E4", "E5", "S1", "S2", "S3", "S4", "G1"] as const;
export const EsrsTopicSchema = z.enum(ESRS_TOPICS);
export type EsrsTopic = z.infer<typeof EsrsTopicSchema>;

export const TARGET_DIRECTIONS = ["reduce", "increase", "maintain"] as const;
export const TargetDirectionSchema = z.enum(TARGET_DIRECTIONS);
export type TargetDirection = z.infer<typeof TargetDirectionSchema>;

/** `audit_log.entity_type` values KPI code writes (01-contracts §2, "Audit"). */
export const KPI_AUDIT_ENTITY_TYPES = ["kpi_value", "kpi_setup", "kpi_period_lock", "kpi_target", "kpi_library"] as const;
export type KpiAuditEntityType = (typeof KPI_AUDIT_ENTITY_TYPES)[number];

/** Notification kinds KPI code sends. */
/**
 * Notification kinds KPI code sends:
 *   kpi_enabled    KPI-1: the switch went on (to the company's Admins)
 *   kpi_due        KPI-8: values due in 5 days or today (daily job), and KPI-10's "Remind"
 *   kpi_assigned   KPI-3: "Invite your team" (to assignment owners)
 *   kpi_submitted  KPI-8: values sent for review (to reviewers, one per submit)
 *   kpi_rejected   KPI-8: a value sent back, with the reason (to whoever entered it)
 */
export const KPI_NOTIFICATION_KINDS = ["kpi_enabled", "kpi_due", "kpi_assigned", "kpi_submitted", "kpi_rejected"] as const;
export type KpiNotificationKind = (typeof KPI_NOTIFICATION_KINDS)[number];
