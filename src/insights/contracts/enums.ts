/**
 * Insights contracts (IN-0) §1: enums, docs/insights/01-contracts.md. The FE
 * mirror is ESG-lite_FE src/lib/insights/contracts.ts; change both together
 * (an IN-0 follow-up), and ci/unit/in-0-contracts.test.cjs keeps them equal.
 */
import { z } from "zod";
import { KPI_PILLARS } from "../../kpi/contracts/enums";

export const PANEL_IDS = [
  "summary",
  "esg_ring",
  "decoupling",
  "target_wall",
  "cards",
  "pathway",
  "completeness",
  "bridge",
  "flow",
  "materiality",
  "stripes",
  "site_compare",
] as const;
export const PanelIdSchema = z.enum(PANEL_IDS);
export type PanelId = z.infer<typeof PanelIdSchema>;

/** Panels that need KPI tracking: they answer `availability: 'kpi_off'` (HTTP 200, data null) while it's off. */
export const KPI_PANELS: readonly PanelId[] = ["esg_ring", "materiality"];

export const AVAILABILITIES = ["ok", "kpi_off", "no_data", "setup_incomplete"] as const;
export const AvailabilitySchema = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof AvailabilitySchema>;

/** at_risk: behind expected by ≤ the I6 threshold (10 pp for targets, +5 % for the SBTi pathway). */
export const TARGET_STATUSES = ["on_track", "at_risk", "off_track", "reached", "no_data"] as const;
export const TargetStatusSchema = z.enum(TARGET_STATUSES);
export type TargetStatus = z.infer<typeof TargetStatusSchema>;
/** The target wall's sort order (worst first). */
export const TARGET_STATUS_ORDER: readonly TargetStatus[] = ["off_track", "at_risk", "on_track", "reached", "no_data"];

export const TARGET_SOURCES = ["sbti", "kpi"] as const;
export type TargetSource = (typeof TARGET_SOURCES)[number];

/** = KPI_PILLARS (KPI D19). */
export const PILLARS = KPI_PILLARS;
export const PillarSchema = z.enum(PILLARS);
export type Pillar = z.infer<typeof PillarSchema>;

export const DRIVERS = ["activity", "intensity_s1", "energy_intensity_s2", "grid_and_renewables_s2", "scope3", "other"] as const;
export type Driver = (typeof DRIVERS)[number];

export const EVENT_KINDS = ["initiative", "acquisition", "divestment", "method_change", "disruption", "other"] as const;
export const EventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKindSchema>;

/** Ranked critical → attention → good → info (I12). */
export const CARD_SEVERITIES = ["good", "info", "attention", "critical"] as const;
export type CardSeverity = (typeof CARD_SEVERITIES)[number];
export const CARD_SEVERITY_RANK: readonly CardSeverity[] = ["critical", "attention", "good", "info"];

/** ai = reworded by IN-9, still from a rule. */
export const CARD_SOURCES = ["rule", "ai"] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

export const YEAR_TYPES = ["CY", "FY"] as const;
export const YearTypeSchema = z.enum(YEAR_TYPES);
export type YearType = z.infer<typeof YearTypeSchema>;

export const COMPARES = ["prior", "base"] as const;
export const CompareSchema = z.enum(COMPARES);
export type Compare = z.infer<typeof CompareSchema>;

/** As /kpi/esg and Overview CY/FY. */
export interface Period {
  year: number;
  yearType: YearType;
}

export type SiteFilter = "all" | number[];

/** Hero "Needs you" items (Summary.attention.items[].kind). */
export const ATTENTION_KINDS = ["approvals", "kpi_gaps", "off_track", "missing_submitters", "threshold"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Who may open Insights (I1): Managers (their sites), Admins and Superadmins. Users never. */
export const INSIGHTS_ROLES = ["Manager", "Admin", "Superadmin"] as const;

/** Bridge compare base and caps from 01-contracts §4. */
export const DECOUPLING_YEARS_DEFAULT = 5;
export const DECOUPLING_YEARS_MAX = 10;
export const STRIPES_MONTHS_MAX = 72;
export const EVENT_LABEL_MAX = 60;
export const MAX_CARDS = 6;
