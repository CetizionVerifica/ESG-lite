/**
 * A KPI's figure for a reporting year (pure), from stored values: what
 * targets (KPI-9), the dashboard (KPI-10) and the framework reports (KPI-11)
 * show. The callers pass approved values only (D14); nothing here reads a
 * draft, pending or rejected value.
 *
 *   yearFigure(def, values, {year, yearType, sites, site?, weightOf?})
 *     - the periods of the year at the KPI's company frequency, rolled up by its aggregation
 *       (values/aggregate.ts `rollupPeriods`; a weighted average over periods is a plain average);
 *     - company-level KPIs: the company's values;
 *     - site-level KPIs: one site (`site`), or the sites in `sites` rolled up by `rollupSites`
 *       (weighted_average weighted by `weightOf(site)`, e.g. hours worked for LTIFR);
 *     - missing is never 0: `complete` is false and `missing_periods` / `missing_sites` say what's
 *       absent; with nothing at all the value is null;
 *     - text, choice and yes/no KPIs: the latest value's text;
 *     - `breakdown`: the parts added up over the values used (sum KPIs only);
 *     - D14: a sum of GHG auto values (each keeps its rows' kg, kpi/auto/ghg.ts) adds the kg
 *       and rounds once (reporting/kgTotals), so the company or year figure is the GHG
 *       report's for those sites and that year, not its rounded parts added up.
 *   combineValues(values, rule)   one period's values across sites, by the same rule (D14 too)
 *   loadValues(m, company, {from, to, statuses})   the rows yearFigure takes
 */
import type { EntityManager } from "typeorm";
import { kgToTonnes, sumKg } from "../../reporting/kgTotals";
import type { KpiAggregation, KpiFrequency, YearType } from "../contracts/enums";
import { aggregate, rollupPeriods, rollupSites, WEIGHT_KPI, type AggregateEntry } from "./aggregate";
import { isoDay, periodsFor } from "./period";

type Row = Record<string, any>;

export interface StoredValue {
  id: number;
  kpi_definition_id: number;
  site_id: number | null;
  period_start: string;
  period_end?: string;
  frequency: string;
  value: number | null;
  text: string | null;
  breakdown: Record<string, number> | null;
  status: string;
  /** D14: an auto GHG value's rows' exact kgCO₂e (`auto_snapshot.kg`), else null. */
  kg?: number | null;
}

export interface FigureDef {
  id: number;
  level: string;
  aggregation: KpiAggregation;
  frequency: KpiFrequency;
  value_type?: string;
}

export interface YearFigure {
  value: number | null;
  text: string | null;
  complete: boolean;
  /** Period starts with no value (for a company roll-up: any site's). */
  missing_periods: string[];
  missing_sites: number[];
  /** The sites (or [null] for the company) whose values were used. */
  sites: Array<number | null>;
  value_ids: number[];
  breakdown: Record<string, number> | null;
}

const tidy = (n: number) => Number(n.toPrecision(12));

/**
 * D14: a sum of values that each keep their rows' kg (GHG auto values in tCO2e,
 * each the kg rounded once) adds the kg and rounds once, as the GHG report does
 * for the same rows. null when it doesn't apply (another rule, no values, or a
 * value without kg or whose kg doesn't round to it): the caller adds the values.
 */
function kgSum(values: StoredValue[], rule: KpiAggregation): number | null {
  if (rule !== "sum") return null;
  const nums = values.filter((v) => v.value !== null);
  if (!nums.length || !nums.every((v) => typeof v.kg === "number" && kgToTonnes(v.kg) === v.value)) return null;
  return kgToTonnes(sumKg(nums.map((v) => v.kg)));
}

export function yearFigure(
  def: FigureDef,
  values: StoredValue[],
  opts: { year: number; yearType: YearType; sites: number[]; site?: number | null; weightOf?: (site: number) => number | null },
): YearFigure {
  const periods = periodsFor(def.frequency, opts.yearType, opts.year).map((p) => p.start);
  const inYear = new Set(periods);
  const mine = values.filter((v) => v.kpi_definition_id === def.id && v.frequency === def.frequency && inYear.has(v.period_start));
  const periodRule: KpiAggregation = def.aggregation === "weighted_average" ? "average" : def.aggregation;

  const forTarget = (target: number | null) => {
    const rows = mine.filter((v) => v.site_id === target);
    const byStart = new Map<string, AggregateEntry>(rows.map((v) => [v.period_start, { value: v.value }]));
    return { rows, result: rollupPeriods(periods, byStart, periodRule) };
  };

  const used: StoredValue[] = [];
  let value: number | null;
  let complete: boolean;
  let missing_periods: string[] = [];
  let missing_sites: number[] = [];
  let sites: Array<number | null> = [];

  if (def.level === "company" || opts.site !== undefined) {
    const target = def.level === "company" ? null : (opts.site as number | null);
    const { rows, result } = forTarget(target);
    used.push(...rows.filter((r) => r.value !== null || r.text !== null));
    value = result.value;
    complete = result.complete;
    missing_periods = result.missing_periods;
    sites = used.length ? [target] : [];
  } else {
    const bySite = new Map<number, AggregateEntry>();
    const missing = new Set<string>();
    let allComplete = true;
    for (const s of opts.sites) {
      const { rows, result } = forTarget(s);
      used.push(...rows.filter((r) => r.value !== null || r.text !== null));
      if (result.value !== null) {
        bySite.set(s, { value: result.value, weight: opts.weightOf ? opts.weightOf(s) : null });
        sites.push(s);
      }
      if (!result.complete) allComplete = false;
      for (const p of result.missing_periods) missing.add(p);
    }
    const rolled = rollupSites(opts.sites, bySite, def.aggregation);
    value = rolled.value;
    missing_sites = rolled.missing_sites;
    complete = allComplete && rolled.complete;
    missing_periods = periods.filter((p) => missing.has(p));
  }

  if (value !== null) value = kgSum(used, def.aggregation) ?? value;

  const texts = used.filter((r) => r.text !== null).sort((a, b) => a.period_start.localeCompare(b.period_start));
  const text = texts.length ? texts[texts.length - 1].text : null;
  let breakdown: Record<string, number> | null = null;
  if (def.aggregation === "sum") {
    for (const r of used) {
      if (!r.breakdown) continue;
      breakdown ??= {};
      for (const [k, v] of Object.entries(r.breakdown)) breakdown[k] = tidy((breakdown[k] ?? 0) + Number(v));
    }
  }
  return {
    value: value === null ? null : tidy(value),
    text,
    complete,
    missing_periods,
    missing_sites,
    sites,
    value_ids: used.map((r) => r.id).sort((a, b) => a - b),
    breakdown,
  };
}

/**
 * yearFigure with the weights a weighted-average KPI needs across sites
 * (`WEIGHT_KPI`: LTIFR by hours worked), read from the same values.
 */
export function figureOf(
  def: FigureDef & { code: string },
  values: StoredValue[],
  defsByCode: Map<string, FigureDef>,
  opts: { year: number; yearType: YearType; sites: number[]; site?: number | null },
): YearFigure {
  const weightDef = def.aggregation === "weighted_average" && WEIGHT_KPI[def.code] ? defsByCode.get(WEIGHT_KPI[def.code]) : undefined;
  const weightOf = weightDef ? (s: number) => yearFigure(weightDef, values, { ...opts, site: s }).value : undefined;
  return yearFigure(def, values, { ...opts, weightOf });
}

/** A plain roll-up of numbers by a KPI's aggregation (for series points across sites). */
export const combine = (nums: Array<number | null>, rule: KpiAggregation): number | null => {
  const r = aggregate(nums.map((v) => ({ value: v, weight: 1 })), rule === "none" ? "latest" : rule);
  return r.value;
};

/** combine() over stored values: a sum of GHG auto values adds their kg and rounds once (D14). */
export const combineValues = (values: StoredValue[], rule: KpiAggregation): number | null => kgSum(values, rule) ?? combine(values.map((v) => v.value), rule);

export async function loadValues(m: EntityManager, companyId: number, opts: { from: string; to: string; statuses: string[]; kpiIds?: number[] }): Promise<StoredValue[]> {
  const rows: Row[] = await m.query(
    `SELECT id, kpi_definition_id, site_id, period_start, period_end, frequency, value_canonical, value_text, breakdown, status,
            CASE WHEN source = 'auto' THEN auto_snapshot->>'kg' END AS kg
       FROM kpi_value
      WHERE company_id = $1 AND period_start >= $2 AND period_end <= $3 AND status = ANY($4::text[])
        AND ($5::int[] IS NULL OR kpi_definition_id = ANY($5::int[]))
      ORDER BY period_start, id`,
    [companyId, opts.from, opts.to, opts.statuses, opts.kpiIds ?? null],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kpi_definition_id: Number(r.kpi_definition_id),
    site_id: r.site_id === null ? null : Number(r.site_id),
    period_start: isoDay(r.period_start) as string,
    period_end: isoDay(r.period_end) as string,
    frequency: r.frequency,
    value: r.value_canonical === null ? null : Number(r.value_canonical),
    text: r.value_text ?? null,
    breakdown: r.breakdown ?? null,
    status: r.status,
    kg: r.kg === null || r.kg === undefined ? null : Number(r.kg),
  }));
}
