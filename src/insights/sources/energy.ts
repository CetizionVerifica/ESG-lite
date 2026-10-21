/**
 * IN-1 · electricity for the renewable-share lever and the hero's third cell
 * when KPI tracking is off (I7, IN-4 lever `renewable_share`).
 *
 * Reads approved electricity rows of the scope's sites with KPI-5's energy
 * rules (src/kpi/auto/energy.ts, used unchanged): Scope 2 rows and the
 * no-scope renewable rows (the GHG report's "Renewable Electricity"), each
 * row's activity quantity converted to energy by `rowGj`; renewable by
 * `isRenewable` (data/kpi/renewables.json). Rows that can't be converted are
 * counted in `skipped`, never read as 0.
 *
 *   electricityByYear(scope, years)  per reporting year: {total_kwh, renewable_kwh, rows, skipped} | null
 *
 * The share itself (renewable ÷ total) is derive/'s `share`.
 */
import { AppDataSource } from "../../config/data-source";
import { isRenewable, rowGj, type EnergyRow } from "../../kpi/auto/energy";
import { pickActivityValue } from "../../services/activityValue";
import { once, periodRange, type InsightsScope } from "../scope";

type Row = Record<string, any>;

export const KWH_PER_GJ = 1e6 / 3600;

export interface Electricity {
  total_kwh: number;
  renewable_kwh: number;
  rows: number;
  skipped: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const isElectricity = (r: Pick<EnergyRow, "scope" | "category" | "activity">): boolean => {
  const scope = (r.scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (scope === "scope2") return true;
  return !scope && isRenewable(r);
};

export async function electricityByYear(scope: InsightsScope, years: number[]): Promise<Array<Electricity | null>> {
  if (!years.length || !scope.siteIds.length) return years.map(() => null);
  const ranges = years.map((year) => ({ year, ...periodRange({ year, yearType: scope.period.yearType }) }));
  const from = ranges.reduce((a, r) => (r.start < a ? r.start : a), ranges[0].start);
  const to = ranges.reduce((a, r) => (r.end > a ? r.end : a), ranges[0].end);
  const rows: Row[] = await once(scope, `electricity:${from}:${to}`, () =>
    AppDataSource.query(
      `SELECT e.pk_id, to_char(e.date_of_reporting, 'YYYY-MM-DD') AS day, c.scope, c.category_name, e.activity_data, e.activity_data_unit, e.emission_factor_snapshot AS snap
         FROM emission e JOIN category c ON c.category_id = e.category_id JOIN site s ON s.site_id = e.site_id
        WHERE s.company_id = $1 AND e.status = 'approved' AND e.site_id = ANY($2::int[]) AND e.date_of_reporting >= $3 AND e.date_of_reporting <= $4
          AND (c.scope = 'Scope 2' OR c.scope IS NULL)
        ORDER BY e.pk_id`,
      [scope.companyId, scope.siteIds, from, to],
    ),
  );
  return ranges.map((range) => {
    const out: Electricity = { total_kwh: 0, renewable_kwh: 0, rows: 0, skipped: 0 };
    for (const r of rows) {
      if (r.day < range.start || r.day > range.end) continue;
      const data = (r.activity_data ?? {}) as Record<string, unknown>;
      const snap = (r.snap ?? {}) as Record<string, unknown>;
      const row: EnergyRow = {
        id: Number(r.pk_id),
        scope: r.scope ?? null,
        category: String(r.category_name ?? ""),
        activity: String(data.fuelType ?? data.emission_category ?? snap.emission_category_name ?? ""),
        quantity: pickActivityValue(data),
        unit: String(r.activity_data_unit || snap.denominator_unit || ""),
        snapshot_ncv: num(snap.ncv),
        snapshot_ncv_unit: typeof snap.ncv_unit === "string" ? snap.ncv_unit : null,
      };
      if (!isElectricity(row)) continue;
      const c = rowGj(row);
      if (!("gj" in c)) {
        out.skipped++;
        continue;
      }
      const kwh = c.gj * KWH_PER_GJ;
      out.rows++;
      out.total_kwh += kwh;
      if (isRenewable(row)) out.renewable_kwh += kwh;
    }
    if (!out.rows) return null;
    return { ...out, total_kwh: Number(out.total_kwh.toPrecision(12)), renewable_kwh: Number(out.renewable_kwh.toPrecision(12)) };
  });
}
