/**
 * DS-2 · what `POST /studio/resolve` returns per binding and token, and the
 * context every source resolves in. The FE mirror is `ResolvedBinding` and
 * `ResolveResponse` in ESG-lite_FE src/lib/studio/contracts.ts.
 */
import type { DataSource, ReportInputs, ReportKind, YearType } from "../contracts";

/** Why a binding has no value (01-contracts §5 DS_SOURCE_UNAVAILABLE `details.reason`). */
export const UNAVAILABLE_REASONS = [
  "NOT_RECORDED", // the data isn't captured at all (scope2_market, D7; per-gas "other")
  "NOT_TRACKED", // the column exists but no approved row in scope carries it (gases, biogenic)
  "NO_DATA", // nothing approved in the period
  "NO_BASE_YEAR", // no Scope 3 base year and no `base_year` input
  "NO_INPUT", // a report input it needs is empty (revenue, employees, output)
  "NO_TARGET", // compare/progress against a target the KPI doesn't have
  "KPI_TRACKING_OFF", // a KPI binding while the company's KPI tracking is off
  "EXCLUDED", // a Scope 3 category excluded in the report inputs (display "Excluded: <reason>")
  "DIVIDE_BY_ZERO",
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export interface SeriesPoint {
  key: string;
  value: number | null;
}
export interface Series {
  label: string;
  values: SeriesPoint[];
}

export interface Comparison {
  against: "prior" | "base" | "target";
  /** The year compared with (prior year, base year, target year). */
  year: number | null;
  value: number | null;
  change_abs: number | null;
  change_pct: number | null;
  /** Why a figure is null (derived.ts reasons). */
  reason?: string;
}

export interface ResolvedBinding {
  source: DataSource;
  /** The value as the page shows it, rounded once here (format.ts); or "Not reported", "Excluded: …", input text. */
  display: string;
  /** The unrounded figure for the doc's year (null when not numeric or unavailable). */
  value: number | null;
  unit: string | null;
  /** Year series, or one series per year keyed by breakdown (sources/CLAUDE.md "Series"). */
  series?: Series[];
  /** The newest approval behind the figure (ISO), when the source records one. */
  approvedAt?: string | null;
  evidenceCount?: number;
  /** Missing periods or sites (KPI values never count missing as 0). */
  complete?: boolean;
  compare?: Comparison;
  /** KPI target and progress (single-KPI bindings with a company target). */
  target?: { baseline_year: number; baseline_value: number; target_year: number; target_value: number; progress_pct: number | null; status: string };
  /** Totals a share is taken of (`share` measure): the binding's own total over its breakdown. */
  total?: number | null;
  unavailable?: { reason: UnavailableReason; detail?: string };
}

export interface ResolveResponse {
  values: ResolvedBinding[];
  tokens: ResolvedBinding[];
  dataHash: string;
  unavailable: Array<{ bindingIdx: number; reason: UnavailableReason; token?: boolean }>;
}

/** Everything a source needs, already checked against the caller (tenant, sites, kind). */
export interface ResolveContext {
  companyId: number;
  kind: ReportKind;
  year: number;
  yearType: YearType;
  /** The request's sites, resolved to ids the caller may read in the company. */
  siteIds: number[];
  /** Every readable site of the company, for `sites: 'all'` on a binding. */
  allSiteIds: number[];
  kpiEnabled: boolean;
  /** Stored inputs merged over prefill (inputs.ts `effectiveInputs`). */
  inputs: ReportInputs;
}
