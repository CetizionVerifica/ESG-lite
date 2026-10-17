/**
 * KPI-5 · GHG adapters. Every figure comes from the GHG report's own
 * functions with the filters `GET /reports/ghg` uses (sites, year type, year,
 * month or quarter), so a KPI agrees with the report to the decimal (D9, D14):
 *
 *   ghg_scope1, ghg_scope2_location   computeGhgTables(filters).totals[year].scope1 / .scope2 (tCO2e)
 *   ghg_scope3_total                  computeScope3(filters, company).total_tco2e
 *   ghg_scope3_category_<n>           computeScope3(filters, company).rows[n].tco2e
 *   ghg_scope2_market                 ESGLite records Scope 2 by the grid (location-based) only;
 *                                     a market-based figure is never invented: no value.
 *
 * No SQL of its own for totals: the only query here counts the approved rows
 * behind the figure and lists their ids for the snapshot (no rows → no value).
 * Results are converted from tCO2e to the KPI's canonical unit (tCO2e for the library).
 */
import { computeGhgTables, getPeriodRange, type GhgFilters } from "../../reporting/ghg-data";
import { computeScope3 } from "../../reporting/ghg-scope3";
import { isScope3Sql } from "../../scope3/taxonomy/service";
import { convert } from "../values/units";
import type { KpiPeriod } from "../values/period";
import { cached, SNAPSHOT_ROW_LIMIT, type Adapter, type AdapterInput, type AdapterResult } from "./types";

type Row = Record<string, any>;

/** The report's filters for a KPI period: the same year type and year, narrowed to the month or quarter. */
export function ghgFilters(siteIds: number[], period: KpiPeriod): GhgFilters {
  const month = Number(period.start.slice(5, 7));
  return {
    siteIds,
    yearType: period.year_type,
    year: period.year,
    frequency: period.frequency === "annual" ? "yearly" : period.frequency,
    ...(period.frequency === "monthly" ? { month } : {}),
    ...(period.frequency === "quarterly" ? { quarter: period.index } : {}),
  };
}

const filtersOut = (f: GhgFilters) => ({ site_ids: f.siteIds, year_type: f.yearType, year: f.year, frequency: f.frequency, month: f.month ?? null, quarter: f.quarter ?? null });

/** Approved emission rows behind a figure: the same status, sites and dates as the report. */
async function sourceRows(input: AdapterInput, f: GhgFilters, scopeSql: string, params: unknown[] = []): Promise<{ count: number; ids: number[] }> {
  const range = getPeriodRange(f.yearType, f.year, f.frequency, f.month, f.quarter);
  const rows: Row[] = await input.m.query(
    `SELECT e.pk_id FROM emission e JOIN category c ON c.category_id = e.category_id
      WHERE e.status = 'approved' AND e.site_id = ANY($1::int[]) AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3 AND ${scopeSql}
      ORDER BY e.pk_id`,
    [f.siteIds, range.startDate, range.endDate, ...params],
  );
  return { count: rows.length, ids: rows.slice(0, SNAPSHOT_ROW_LIMIT).map((r) => Number(r.pk_id)) };
}

const inUnit = (input: AdapterInput, tco2e: number): number | null => {
  const unit = input.kpi.canonical_unit ?? "tCO2e";
  return convert(tco2e, "tCO2e", unit);
};

const result = (input: AdapterInput, tco2e: number, snapshot: Record<string, unknown>): AdapterResult => {
  const value = inUnit(input, tco2e);
  return value === null
    ? { value_canonical: null, unit: input.kpi.canonical_unit, snapshot: { ...snapshot, skipped: [{ id: 0, reason: `tCO2e can't convert to ${input.kpi.canonical_unit}` }] } }
    : { value_canonical: value, unit: input.kpi.canonical_unit, snapshot };
};

const tables = (input: AdapterInput, f: GhgFilters) => cached(input, `tables:${JSON.stringify(f)}`, () => computeGhgTables(f));
const scope3 = (input: AdapterInput, f: GhgFilters) => cached(input, `scope3:${JSON.stringify(f)}`, () => computeScope3(f, input.companyId));

const scopeTotal = (scope: "Scope 1" | "Scope 2", field: "scope1" | "scope2"): Adapter => async (input) => {
  const f = ghgFilters(input.siteIds, input.period);
  const rows = await sourceRows(input, f, `c.scope = $4`, [scope]);
  if (!rows.count) return null;
  const t = await tables(input, f);
  const tco2e = Number(t.totals[String(f.year)][field]) || 0;
  return result(input, tco2e, {
    kind: "ghg",
    function: "computeGhgTables",
    field: `totals.${f.year}.${field}`,
    tco2e,
    filters: filtersOut(f),
    rows: rows.count,
    row_ids: rows.ids,
    read_at: new Date().toISOString(),
  });
};

export const ghgScope1 = scopeTotal("Scope 1", "scope1");
export const ghgScope2Location = scopeTotal("Scope 2", "scope2");

/** Market-based Scope 2 isn't recorded in ESGLite: never invented. */
export const ghgScope2Market: Adapter = async () => null;

export const ghgScope3Total: Adapter = async (input) => {
  const f = ghgFilters(input.siteIds, input.period);
  const rows = await sourceRows(input, f, isScope3Sql("c"));
  if (!rows.count) return null;
  const r = await scope3(input, f);
  return result(input, r.total_tco2e, {
    kind: "ghg",
    function: "computeScope3",
    field: "total_tco2e",
    tco2e: r.total_tco2e,
    filters: filtersOut(f),
    rows: rows.count,
    row_ids: rows.ids,
    read_at: new Date().toISOString(),
  });
};

export const ghgScope3Category =
  (n: number): Adapter =>
  async (input) => {
    const f = ghgFilters(input.siteIds, input.period);
    const rows = await sourceRows(input, f, `${isScope3Sql("c")} AND c.ghg_category = $4`, [n]);
    if (!rows.count) return null;
    const r = await scope3(input, f);
    const row = r.rows.find((x) => x.n === n);
    const tco2e = row?.tco2e ?? 0;
    return result(input, tco2e, {
      kind: "ghg",
      function: "computeScope3",
      field: `rows[n=${n}].tco2e`,
      tco2e,
      filters: filtersOut(f),
      rows: rows.count,
      row_ids: rows.ids,
      read_at: new Date().toISOString(),
    });
  };
