/**
 * KPI-4 · aggregation (pure): site values → the company, and periods → the
 * year, per `KpiAggregation` (01-contracts §1).
 *
 *   sum, average, max     as usual over the values present
 *   weighted_average      Σ(value × weight) / Σ weight; a value without a weight
 *                         counts as missing (LTIFR is weighted by hours worked)
 *   latest                the last value present, in the order given
 *   none                  company level only: the single value, else nothing
 *
 * Missing values (null, or an expected period with no value) are reported as
 * missing and never treated as 0: `complete` is false and `missing` counts them.
 * With nothing present the value is null.
 */
import type { KpiAggregation } from "../contracts/enums";

export interface AggregateEntry {
  value: number | null | undefined;
  /** weighted_average only */
  weight?: number | null;
}

export interface AggregateResult {
  value: number | null;
  /** How many entries had a value (and, for weighted_average, a weight). */
  count: number;
  missing: number;
  complete: boolean;
}

/** Which KPI weighs a weighted_average KPI when rolling it up. */
export const WEIGHT_KPI: Record<string, string> = { LTIFR: "HOURS_WORKED" };

const present = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function aggregate(entries: AggregateEntry[], rule: KpiAggregation): AggregateResult {
  const usable = entries.filter((e) => present(e.value) && (rule !== "weighted_average" || (present(e.weight) && (e.weight as number) >= 0)));
  const missing = entries.length - usable.length;
  const values = usable.map((e) => e.value as number);
  let value: number | null = null;
  if (values.length) {
    switch (rule) {
      case "sum":
        value = values.reduce((a, b) => a + b, 0);
        break;
      case "average":
        value = values.reduce((a, b) => a + b, 0) / values.length;
        break;
      case "max":
        value = Math.max(...values);
        break;
      case "latest":
        value = values[values.length - 1];
        break;
      case "weighted_average": {
        const w = usable.reduce((a, e) => a + (e.weight as number), 0);
        value = w > 0 ? usable.reduce((a, e) => a + (e.value as number) * (e.weight as number), 0) / w : null;
        break;
      }
      case "none":
        value = entries.length === 1 ? values[0] : null;
        break;
    }
  }
  if (value !== null) value = Number(value.toPrecision(12));
  return { value, count: usable.length, missing, complete: missing === 0 && entries.length > 0 };
}

/**
 * Periods → year: `periods` are every expected period start of the year, in
 * order; `byStart` holds the values that exist. A period with no value is missing.
 */
export function rollupPeriods(periods: string[], byStart: Map<string, AggregateEntry>, rule: KpiAggregation): AggregateResult & { missing_periods: string[] } {
  const entries = periods.map((p) => byStart.get(p) ?? { value: null });
  const missing_periods = periods.filter((p) => !present(byStart.get(p)?.value));
  return { ...aggregate(entries, rule), missing_periods };
}

/**
 * Sites → company: `sites` are the sites expected to report; `bySite` the
 * values that exist. `none` KPIs are company level and never roll up.
 */
export function rollupSites(sites: number[], bySite: Map<number, AggregateEntry>, rule: KpiAggregation): AggregateResult & { missing_sites: number[] } {
  if (rule === "none") return { value: null, count: 0, missing: sites.length, complete: false, missing_sites: [...sites] };
  const entries = sites.map((s) => bySite.get(s) ?? { value: null });
  const missing_sites = sites.filter((s) => !present(bySite.get(s)?.value));
  return { ...aggregate(entries, rule), missing_sites };
}
