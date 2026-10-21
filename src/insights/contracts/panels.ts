/**
 * Insights contracts (IN-0) §2–§3: the panel envelope and each panel's data
 * shape, docs/insights/01-contracts.md. Types only.
 *
 * Rules for every shape:
 *  - numbers are raw (unrounded) except `params` in cards; the FE formats them;
 *  - `null` means "no data", never zero; a missing year is `null` in a series;
 *  - every percentage is a number of percent (12.5 means 12.5 %), never a fraction.
 */
import type { AttentionKind, Availability, CardSeverity, CardSource, Driver, EventKind, PanelId, Period, Pillar, SiteFilter, TargetSource, TargetStatus } from "./enums";
import type { RuleId } from "./rules";

export interface PendingNotIn {
  emissions: number;
  kpi_values: number;
  link: string | null;
}

/** Every panel response. availability ≠ 'ok' → data is null and the FE shows the matching state. */
export interface PanelResponse<T> {
  panel: PanelId;
  availability: Availability;
  /** Plain words for the empty state. */
  reason?: string;
  period: Period;
  sites: SiteFilter;
  /** "CY 2026 · All sites" */
  label: string;
  data: T | null;
  pending_not_in: PendingNotIn;
  /** Data stamp used for the cache key and ETag. */
  stamp: string;
  /** Drill-down targets, keyed by element id. */
  links: Record<string, string>;
}

/** GET /insights/status (any role; answers while the switch is off). */
export interface InsightsStatus {
  enabled: boolean;
  kpi_tracking: boolean;
}

/** GET /insights/sites (IN-0 addition): the caller's sites in the company, for the header's site chips. */
export interface InsightsSites {
  sites: Array<{ site_id: number; name: string }>;
}

// IN-1 · GET /insights/summary
export interface Summary {
  net: { value: number; unit: "tCO2e"; prior: number | null; change_pct: number | null; good: boolean | null };
  /** null: no SBTi setup */
  pathway: { status: TargetStatus; gap_pct: number | null; target_year: number | null } | null;
  intensity: { value: number | null; unit: string; combined: boolean; change_pct: number | null; good: boolean | null };
  /** null when KPI tracking is off (or nothing is counted yet). by_pillar: null for a pillar with nothing counted (IN-0 follow-up, IN-1). */
  readiness: { pct: number; by_pillar: Record<Pillar, number | null> } | null;
  attention: { total: number; items: Array<{ kind: AttentionKind; count: number; link: string }> };
  /** Renewable share of electricity in the period, % (hero cell 3 when KPI tracking is off); null without electricity data. IN-0 follow-up, IN-1. */
  renewable_share_pct: number | null;
}

// IN-2 · GET /insights/esg-ring (kpi_off when KPI tracking is off)
export interface EsgRingTopic {
  topic: string;
  label: string;
  kpis: number;
  approved: number;
  coverage_pct: number;
  /** Share of the topic's KPIs filled from data (KPI-5), the "joined" signal. */
  auto_share: number;
}
export interface EsgRing {
  pct: number;
  pillars: Array<{ pillar: Pillar; label: string; kpis: number; approved: number; coverage_pct: number; topics: EsgRingTopic[] }>;
}

// IN-2 · GET /insights/decoupling
export type DecouplingSeriesKey = "output" | "emissions" | "intensity";
export interface Decoupling {
  base_year: number;
  years: number[];
  series: Array<{ key: DecouplingSeriesKey; label: string; index: Array<number | null>; raw: Array<number | null>; unit: string }>;
  combined_output: boolean;
  /** output index ↑ and emissions index ↓ vs base */
  decoupled: boolean;
  headline: { output_change_pct: number; emissions_change_pct: number; intensity_change_pct: number };
}

// IN-2 · GET /insights/target-wall — sorted off_track, at_risk, on_track, reached, no_data; then by (expected − progress) desc
export interface TargetWallItem {
  id: string;
  source: TargetSource;
  pillar: Pillar;
  name: string;
  unit: string;
  progress_pct: number | null;
  expected_pct: number | null;
  status: TargetStatus;
  baseline: { year: number; value: number };
  target: { year: number; value: number };
  latest: { year: number; value: number } | null;
  direction_good: "down" | "up";
  link: string;
}
export interface TargetWall {
  items: TargetWallItem[];
}

// IN-3 · GET /insights/cards — at most 6, ranked by severity then rule weight
export interface InsightCard {
  id: string;
  rule: RuleId;
  severity: CardSeverity;
  source: CardSource;
  /** Values the copy template needs; numbers already rounded for display. */
  params: Record<string, number | string>;
  /** Only when source = 'ai'; contains {{v:key}} tokens only. */
  text?: string;
  link: string | null;
  /** Which panel to scroll to and highlight. */
  panel?: PanelId;
}
export interface Cards {
  cards: InsightCard[];
}

export interface EventRef {
  id: number;
  date: string;
  label: string;
  kind: EventKind;
  site_id: number | null;
}

// IN-4 · GET /insights/pathway
export interface Pathway {
  base_year: number;
  target_year: number;
  annual_rate_pct: number;
  years: number[];
  pathway: number[];
  actual: { s1: Array<number | null>; s2: Array<number | null>; s3: Array<number | null> };
  levers: Array<{ key: "renewable_share" | "energy_intensity"; label: string; unit: string; values: Array<number | null> }>;
  gap_band: Array<{ year: number; gap: number }>;
  events: EventRef[];
}

// IN-4 · GET /insights/completeness
export interface CompletenessCell {
  month: string;
  pct: number | null;
  emissions_expected: number;
  emissions_approved: number;
  kpi_expected: number;
  kpi_approved: number;
  link: string;
}
export interface Completeness {
  /** 'YYYY-MM' of the period */
  months: string[];
  rows: Array<{ site_id: number; site: string; cells: CompletenessCell[] }>;
}

// IN-5 · GET /insights/bridge?compare=prior|base — Σ steps = to − from exactly
export interface Bridge {
  from: { year: number; value: number };
  to: { year: number; value: number };
  steps: Array<{ driver: Driver; label: string; value: number; inputs: Record<string, number> }>;
  method: "lmdi_additive";
  notes: string[];
}

// IN-6 · GET /insights/flow — columns 0→1→2 carry tCO2e; 2→3 carries count (I9)
export interface Flow {
  nodes: Array<{ id: string; label: string; column: 0 | 1 | 2 | 3; kind: "site" | "scope" | "kpi" | "disclosure" }>;
  links: Array<{ source: string; target: string; value: number; measure: "tCO2e" | "count"; fit?: "exact" | "partial" | "derived" }>;
}

// IN-7 · GET /insights/materiality (kpi_off when KPI tracking is off)
export interface Materiality {
  /** false → topics listed without positions, plus a link to add scores */
  scored: boolean;
  points: Array<{
    esrs_topic: string;
    label: string;
    impact: number | null;
    financial: number | null;
    weight: number;
    status: TargetStatus;
    kpis: number;
    on_track: number;
    off_track: number;
    link: string;
  }>;
}

// IN-8 · GET /insights/stripes
export interface Stripes {
  months: string[];
  values: Array<number | null>;
  unit: "tCO2e";
  min: number;
  max: number;
}

/** Panel id → its data type. */
export interface PanelDataMap {
  summary: Summary;
  esg_ring: EsgRing;
  decoupling: Decoupling;
  target_wall: TargetWall;
  cards: Cards;
  pathway: Pathway;
  completeness: Completeness;
  bridge: Bridge;
  flow: Flow;
  materiality: Materiality;
  stripes: Stripes;
}

/** Panel id → its GET path under /insights (01-contracts §4). */
export const PANEL_PATHS: Record<PanelId, string> = {
  summary: "/summary",
  esg_ring: "/esg-ring",
  decoupling: "/decoupling",
  target_wall: "/target-wall",
  cards: "/cards",
  pathway: "/pathway",
  completeness: "/completeness",
  bridge: "/bridge",
  flow: "/flow",
  materiality: "/materiality",
  stripes: "/stripes",
};
