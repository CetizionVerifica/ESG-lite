/**
 * KPI-6 · how a formula's reference resolves (pure; unit tested), for one
 * target (a site, or null = the company) and one period P of the formula KPI:
 *   - the input's values whose period lies inside P, at the input's own
 *     frequency for the company, rolled up over periods by its aggregation;
 *   - site target: the site's values (or the company value of a company-level input);
 *   - company target: a company-level input's value, or a site-level input
 *     rolled up over the sites that have one (its aggregation; `sum()` adds
 *     up, `avg()` averages; a weighted average is a plain average here).
 * Sites or periods without a value make the input `partial`, not missing; an
 * input is missing only when nothing is there. Status: approved when every
 * value used is approved, else pending.
 */
import type { KpiAggregation, KpiFrequency } from "../contracts/enums";
import { aggregate } from "../values/aggregate";
import { periodsFor, type KpiPeriod } from "../values/period";
import type { ResolvedInput } from "./evaluate";
import type { GraphDef } from "./graph";
import type { FormulaFn } from "./parse";

export interface CompanyDef extends GraphDef {
  id: number;
  name: string;
  level: string;
  aggregation: KpiAggregation;
  frequency: KpiFrequency;
  selected: boolean;
}

/** A submitted value (pending or approved) as the resolver reads it. */
export interface MemValue {
  id: number;
  kpi_definition_id: number;
  site_id: number | null;
  period_start: string;
  period_end: string;
  frequency: string;
  value: number | null;
  breakdown: Record<string, number> | null;
  status: string;
}

const settled = (statuses: string[]) => (statuses.every((s) => s === "approved") ? "approved" : "pending");

/** Rolls one site's (or the company's) values over the periods inside P. */
function overPeriods(values: MemValue[], part: string | null, rule: KpiAggregation): { value: number | null; statuses: string[] } {
  const sorted = [...values].sort((a, b) => a.period_start.localeCompare(b.period_start));
  const entries = sorted.map((v) => ({ value: part ? (typeof v.breakdown?.[part] === "number" ? (v.breakdown[part] as number) : null) : v.value }));
  const present = sorted.filter((_, i) => typeof entries[i].value === "number");
  if (!present.length) return { value: null, statuses: [] };
  const r = aggregate(entries.filter((e) => typeof e.value === "number"), rule === "weighted_average" ? "average" : rule);
  return { value: r.value, statuses: present.map((v) => v.status) };
}

/** A resolver for one target (site id, or null = company) and one period. */
export function makeResolver(defs: Map<string, CompanyDef>, values: MemValue[], siteIds: number[], target: number | null, period: KpiPeriod) {
  return (ref: { code: string; part: string | null; fn: FormulaFn | null }): ResolvedInput | null => {
    const d = defs.get(ref.code);
    if (!d) return null;
    const inside = values.filter((v) => v.kpi_definition_id === d.id && v.frequency === d.frequency && v.period_start >= period.start && v.period_end <= period.end);
    const expected = periodsFor(d.frequency, period.year_type, period.year).filter((p) => p.start >= period.start && p.end <= period.end).length;
    const one = (site: number | null) => {
      const vs = inside.filter((v) => v.site_id === site);
      const r = overPeriods(vs, ref.part, d.aggregation);
      return { ...r, partial: r.value !== null && vs.length < expected };
    };
    if (d.level === "company" || target !== null) {
      const r = one(d.level === "company" ? null : target);
      return r.value === null ? { value: null } : { value: r.value, status: settled(r.statuses), unit: d.canonical_unit, partial: r.partial };
    }
    // Company target, site-level input: roll up over the sites that have a value.
    const perSite = siteIds.map((s) => one(s)).filter((r) => r.value !== null);
    if (!perSite.length) return { value: null };
    const rule: KpiAggregation = ref.fn === "sum" ? "sum" : ref.fn === "avg" ? "average" : d.aggregation === "weighted_average" ? "average" : d.aggregation;
    const agg = aggregate(perSite.map((r) => ({ value: r.value })), rule);
    if (agg.value === null) return { value: null };
    return { value: agg.value, status: settled(perSite.flatMap((r) => r.statuses)), unit: d.canonical_unit, partial: perSite.length < siteIds.length || perSite.some((r) => r.partial) };
  };
}

