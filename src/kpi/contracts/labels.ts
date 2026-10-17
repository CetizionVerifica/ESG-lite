/**
 * KPI contracts (KPI-0): plain-language labels for every enum value
 * (05-ux copy rules: sentence case, status words Draft / Pending / Approved /
 * Rejected). The FE keeps the same table in `src/lib/kpi/labels.ts`; exports
 * and notifications use this one.
 */
import type { KpiCheckId } from "./checks";
import type {
  FrameworkCode,
  KpiAggregation,
  KpiFrequency,
  KpiLevel,
  KpiSource,
  KpiTopic,
  KpiValueStatus,
  KpiValueType,
  MappingFit,
  RequirementLevel,
  UnitDimension,
  EsrsTopic,
  TargetDirection,
  YearType,
} from "./enums";

export const FRAMEWORK_LABELS: Record<FrameworkCode, string> = {
  GRI: "GRI",
  BRSR: "BRSR (Business Responsibility and Sustainability Report)",
  ESRS: "CSRD (ESRS)",
};

export const REQUIREMENT_LABELS: Record<RequirementLevel, string> = {
  required: "Required",
  if_material: "If the topic is material",
  voluntary: "Voluntary",
  core: "BRSR Core",
};

export const TOPIC_LABELS: Record<KpiTopic, string> = {
  climate: "Climate",
  energy: "Energy",
  water: "Water",
  waste: "Waste",
  pollution: "Pollution",
  biodiversity: "Biodiversity",
  materials: "Materials",
  workforce: "Workforce",
  health_safety: "Health and safety",
  diversity: "Diversity",
  training: "Training",
  human_rights: "Human rights",
  community: "Community",
  customers: "Customers",
  governance: "Governance",
  ethics: "Ethics",
};

export const VALUE_TYPE_LABELS: Record<KpiValueType, string> = {
  number: "Number",
  percent: "Percentage",
  integer: "Whole number",
  currency: "Amount of money",
  yes_no: "Yes or no",
  choice: "Choice",
  text: "Text",
};

export const SOURCE_LABELS: Record<KpiSource, string> = {
  manual: "Entered",
  auto: "From your data",
  formula: "Calculated",
};

export const AGGREGATION_LABELS: Record<KpiAggregation, string> = {
  sum: "Added up",
  average: "Average",
  weighted_average: "Weighted average",
  max: "Highest",
  latest: "Latest",
  none: "Company only",
};

export const LEVEL_LABELS: Record<KpiLevel, string> = { site: "Per site", company: "Company" };

export const FREQUENCY_LABELS: Record<KpiFrequency, string> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Yearly" };

export const STATUS_LABELS: Record<KpiValueStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export const FIT_LABELS: Record<MappingFit, string> = { exact: "Exact", partial: "Partial", derived: "Derived" };

export const UNIT_DIMENSION_LABELS: Record<UnitDimension, string> = {
  energy: "Energy",
  mass: "Mass",
  volume: "Volume",
  count: "Count",
  currency: "Money",
  ratio: "Ratio",
  time: "Time",
  none: "No unit",
};

export const YEAR_TYPE_LABELS: Record<YearType, string> = { CY: "Calendar year", FY: "Financial year (April to March)" };

export const ESRS_TOPIC_LABELS: Record<EsrsTopic, string> = {
  E1: "E1 Climate change",
  E2: "E2 Pollution",
  E3: "E3 Water and marine resources",
  E4: "E4 Biodiversity and ecosystems",
  E5: "E5 Resource use and circular economy",
  S1: "S1 Own workforce",
  S2: "S2 Workers in the value chain",
  S3: "S3 Affected communities",
  S4: "S4 Consumers and end-users",
  G1: "G1 Business conduct",
};

export const TARGET_DIRECTION_LABELS: Record<TargetDirection, string> = { reduce: "Reduce", increase: "Increase", maintain: "Keep level" };

export const CHECK_LABELS: Record<KpiCheckId, string> = {
  KPI_EVIDENCE: "No evidence",
  KPI_CHANGE_LIMIT: "Big change from last year",
  KPI_BREAKDOWN_SUM: "Parts don't add up",
  KPI_UNIT_CONVERTED: "Converted from another unit",
  KPI_ESTIMATE: "Estimate",
  KPI_AUTO_STALE: "Source data changed",
};
