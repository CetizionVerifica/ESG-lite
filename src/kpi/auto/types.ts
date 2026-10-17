/**
 * KPI-5 · what every auto adapter takes and gives (one adapter per
 * `AutoSourceKey`, 01-contracts §1).
 */
import type { EntityManager } from "typeorm";
import type { KpiPeriod } from "../values/period";

export interface AdapterKpi {
  id: number;
  code: string;
  auto_source: string;
  canonical_unit: string | null;
  unit_dimension: string;
  allowed_units: string[];
  breakdowns: { by?: string[]; values?: string[] } | null;
}

export interface AdapterInput {
  m: EntityManager;
  companyId: number;
  /** The sites the value covers: one site, or every site of the company for a company-level KPI. */
  siteIds: number[];
  period: KpiPeriod;
  kpi: AdapterKpi;
  /** Shared by the adapters of one refresh, so one report call serves several KPIs. */
  cache: Map<string, Promise<unknown>>;
}

export interface SkippedRow {
  id: number;
  reason: string;
}

export interface AdapterResult {
  /** In the KPI's canonical unit; null when rows exist but none could be used (see `snapshot.skipped`). */
  value_canonical: number | null;
  unit: string | null;
  breakdown?: Record<string, number> | null;
  /** What it was read from: the report function or the rows, the filters and the read time. */
  snapshot: Record<string, unknown>;
}

/** null = the source has nothing for this site and period: no value (an earlier one is removed). */
export type Adapter = (input: AdapterInput) => Promise<AdapterResult | null>;

/** Row ids kept in a snapshot (the count is always complete). */
export const SNAPSHOT_ROW_LIMIT = 200;

export const cached = <T>(input: AdapterInput, key: string, load: () => Promise<T>): Promise<T> => {
  if (!input.cache.has(key)) input.cache.set(key, load());
  return input.cache.get(key) as Promise<T>;
};
