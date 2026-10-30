/**
 * DS-2 · breakdowns the GHG report functions don't give: by month, per gas,
 * biogenic CO₂, coverage (sites and months with data), the GWP sets used and
 * the newest approval. Each reads APPROVED emission rows with exactly the
 * filters computeGhgTables uses (status approved, the filters' sites, the
 * period from getPeriodRange, the category filter) and sums the same figure
 * (each row's kgCO₂e, rounded once per month and scope to tCO₂e: D14,
 * reporting/kgTotals.ts), so every split comes from the report's own rows
 * (ci/api/tests/ds-2-resolve.test.cjs proves months and sites against
 * POST /user/ghg/tables).
 *
 * Read only. No total is computed here that the report doesn't already have:
 * these are partitions of the same approved rows.
 */
import { AppDataSource } from "../../../config/data-source";
import { getPeriodRange, type GhgFilters } from "../../../reporting/ghg-data";
import { emissionColumns } from "../../../reporting/ghg-scope3";
import { kgToTonnes, sumKgSql } from "../../../reporting/kgTotals";

type Row = Record<string, any>;

/** The WHERE clause computeGhgTables applies (alias e = emission, c = category), and its params. */
export function approvedWhere(filters: GhgFilters, first = 1): { sql: string; params: unknown[] } {
  const range = getPeriodRange(filters.yearType, filters.year, filters.frequency ?? "yearly", filters.month, filters.quarter);
  const params: unknown[] = [filters.siteIds, range.startDate, range.endDate];
  let sql = `e.status = 'approved' AND e.site_id = ANY($${first}::int[]) AND e.date_of_reporting >= $${first + 1} AND e.date_of_reporting <= $${first + 2}`;
  if (filters.categoryIds?.length) {
    params.push(filters.categoryIds);
    sql += ` AND c.category_id = ANY($${first + 3}::int[])`;
  }
  return { sql, params };
}

export const SCOPES = ["Scope 1", "Scope 2", "Scope 3"] as const;
export type ScopeName = (typeof SCOPES)[number];

export interface MonthScopeRow {
  month: string; // YYYY-MM
  scope: ScopeName;
  tco2e: number;
}

/** tCO₂e per calendar month and scope (Scope 1–3 rows only, like the report's totals): the kg summed, rounded once. */
export async function monthlyByScope(filters: GhgFilters): Promise<MonthScopeRow[]> {
  const w = approvedWhere(filters);
  const rows: Row[] = await AppDataSource.query(
    `SELECT to_char(date_trunc('month', e.date_of_reporting), 'YYYY-MM') AS month, c.scope AS scope, ${sumKgSql("e")} AS kg
       FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
      WHERE ${w.sql} AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3')
      GROUP BY 1, 2 ORDER BY 1, 2`,
    w.params,
  );
  return rows.map((r) => ({ month: String(r.month), scope: r.scope as ScopeName, tco2e: kgToTonnes(r.kg) }));
}

export interface GasRow {
  scope: ScopeName;
  /** Rows in scope, and those whose factor gave per-gas parts. */
  rows: number;
  rows_with_gases: number;
  rows_with_biogenic: number;
  co2_kg: number;
  ch4_kg: number;
  n2o_kg: number;
  biogenic_kg: number;
}

/** Kg of CO₂, CH₄ and N₂O (emission.gas_kg) and biogenic CO₂ (emission.biogenic_kg) per scope; null when the columns don't exist. */
export async function gasesByScope(filters: GhgFilters): Promise<GasRow[] | null> {
  const cols = await emissionColumns();
  if (!cols.has("gas_kg") && !cols.has("biogenic_kg")) return null;
  const w = approvedWhere(filters);
  const gas = (g: string) => (cols.has("gas_kg") ? `COALESCE(SUM((e.gas_kg ->> '${g}')::numeric), 0)` : "0");
  const rows: Row[] = await AppDataSource.query(
    `SELECT c.scope AS scope, COUNT(*) AS n,
            ${cols.has("gas_kg") ? "COUNT(*) FILTER (WHERE e.gas_kg IS NOT NULL AND e.gas_kg <> '{}'::jsonb)" : "0"} AS n_gas,
            ${cols.has("biogenic_kg") ? "COUNT(e.biogenic_kg)" : "0"} AS n_bio,
            ${gas("CO2")} AS co2, ${gas("CH4")} AS ch4, ${gas("N2O")} AS n2o,
            ${cols.has("biogenic_kg") ? "COALESCE(SUM(e.biogenic_kg), 0)" : "0"} AS bio
       FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
      WHERE ${w.sql} AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3')
      GROUP BY 1 ORDER BY 1`,
    w.params,
  );
  return rows.map((r) => ({
    scope: r.scope as ScopeName,
    rows: Number(r.n),
    rows_with_gases: Number(r.n_gas),
    rows_with_biogenic: Number(r.n_bio),
    co2_kg: Number(r.co2) || 0,
    ch4_kg: Number(r.ch4) || 0,
    n2o_kg: Number(r.n2o) || 0,
    biogenic_kg: Number(r.bio) || 0,
  }));
}

export interface Coverage {
  /** Sites (of the filters) with at least one approved row in the period. */
  site_ids: number[];
  /** Calendar months (YYYY-MM) with at least one approved row. */
  months: string[];
  /** The newest approval among the rows (reviewed_at; updated_at for rows approved before it was kept), ISO. */
  approved_at: string | null;
  /** GWP sets on the factor snapshots of the rows (AR4, AR5, AR6), sorted. */
  gwp_sets: string[];
  rows: number;
}

export async function coverage(filters: GhgFilters): Promise<Coverage> {
  const w = approvedWhere(filters);
  const [agg]: Row[] = await AppDataSource.query(
    `SELECT COALESCE(array_agg(DISTINCT e.site_id) FILTER (WHERE e.site_id IS NOT NULL), '{}') AS sites,
            COALESCE(array_agg(DISTINCT to_char(date_trunc('month', e.date_of_reporting), 'YYYY-MM')), '{}') AS months,
            MAX(COALESCE(e.reviewed_at, e.updated_at)) AS approved_at,
            COALESCE(array_agg(DISTINCT e.emission_factor_snapshot ->> 'gwp_set') FILTER (WHERE e.emission_factor_snapshot ->> 'gwp_set' IS NOT NULL), '{}') AS gwp,
            COUNT(*) AS n
       FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
      WHERE ${w.sql} AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3')`,
    w.params,
  );
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.replace(/[{}]/g, "").split(",").filter(Boolean) : []);
  return {
    site_ids: list(agg?.sites).map(Number).sort((a, b) => a - b),
    months: list(agg?.months).sort(),
    approved_at: agg?.approved_at ? new Date(agg.approved_at).toISOString() : null,
    gwp_sets: list(agg?.gwp).sort(),
    rows: Number(agg?.n) || 0,
  };
}

/** The 12 calendar months (YYYY-MM) of a reporting year, in reporting order (FY: Apr → Mar). */
export function reportingMonthKeys(yearType: "CY" | "FY", year: number, fyStartMonth = 4): string[] {
  const out: string[] = [];
  const pad = (m: number) => String(m).padStart(2, "0");
  if (yearType === "FY") {
    for (let m = fyStartMonth; m <= 12; m++) out.push(`${year - 1}-${pad(m)}`);
    for (let m = 1; m < fyStartMonth; m++) out.push(`${year}-${pad(m)}`);
  } else {
    for (let m = 1; m <= 12; m++) out.push(`${year}-${pad(m)}`);
  }
  return out;
}

export interface FactorUsedRow {
  scope: ScopeName;
  /** The source category of the rows (category.category_name). */
  category: string;
  /** The factor's name as stored on the row (emission_category_name); null when the snapshot has none. */
  factor: string | null;
  /** kgCO₂e per `unit`, as stored on the snapshot (text or number). */
  value: string | null;
  unit: string | null;
  source: string | null;
  /** dataset_version, else the factor's year. */
  version: string | null;
  gwp: string | null;
  /** Approved rows that used this factor. */
  rows: number;
}

/**
 * The emission factors behind the approved rows (each row's
 * `emission_factor_snapshot`, written when it was calculated), one line per
 * scope × source category × factor. Rows without a snapshot are counted in
 * `missing`. No figure is computed: it lists what the rows carry.
 */
export async function factorsUsed(filters: GhgFilters): Promise<{ rows: FactorUsedRow[]; missing: number }> {
  if (!filters.siteIds.length) return { rows: [], missing: 0 };
  const w = approvedWhere(filters);
  const s = (k: string) => `NULLIF(TRIM(e.emission_factor_snapshot ->> '${k}'), '')`;
  const rows: Row[] = await AppDataSource.query(
    `SELECT c.scope AS scope, c.category_name AS category,
            ${s("emission_category_name")} AS factor,
            ${s("factor_value")} AS value,
            ${s("denominator_unit")} AS unit,
            COALESCE(${s("source")}, ${s("dataset")}) AS source,
            COALESCE(${s("dataset_version")}, ${s("year")}) AS version,
            ${s("gwp_set")} AS gwp,
            COUNT(*) AS n
       FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
      WHERE ${w.sql} AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3') AND e.emission_factor_snapshot IS NOT NULL
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      ORDER BY 1, lower(c.category_name), 3 NULLS LAST, 4, 5, 6, 7, 8`,
    w.params,
  );
  const [m]: Row[] = await AppDataSource.query(
    `SELECT COUNT(*) AS n FROM emission e LEFT JOIN category c ON c.category_id = e.category_id
      WHERE ${w.sql} AND c.scope IN ('Scope 1', 'Scope 2', 'Scope 3') AND e.emission_factor_snapshot IS NULL`,
    w.params,
  );
  return {
    rows: rows.map((r) => ({
      scope: r.scope as ScopeName,
      category: String(r.category ?? ""),
      factor: r.factor ?? null,
      value: r.value ?? null,
      unit: r.unit ?? null,
      source: r.source ?? null,
      version: r.version ?? null,
      gwp: r.gwp ?? null,
      rows: Number(r.n) || 0,
    })),
    missing: Number(m?.n) || 0,
  };
}
