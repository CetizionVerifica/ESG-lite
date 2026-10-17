/**
 * KPI-5 · energy adapters: energy_total, energy_renewable, energy_non_renewable.
 *
 * They add up the activity quantity of approved energy rows in the period (the
 * report's status, sites and dates), converted to the KPI's canonical unit (GJ):
 *   - Scope 2 rows (electricity, heat, steam, cooling);
 *   - Scope 1 combustion rows (categories named for combustion or fuel);
 *   - rows with no scope whose category is renewable energy (the GHG report's
 *     "Renewable Electricity", kept out of emission totals but energy all the same).
 * An energy unit converts directly (values/units.ts). A volume or mass of fuel
 * converts through a net calorific value: the row's factor snapshot `ncv`
 * (GJ per `ncv_unit`, else per its denominator unit) when present, otherwise
 * data/kpi/ncv.json. A row that can't be converted is listed in the snapshot
 * as `skipped`, never dropped silently. Renewable: data/kpi/renewables.json
 * (category or activity words). No emission is calculated here.
 */
import fs from "fs";
import path from "path";
import { pickActivityValue } from "../../services/activityValue";
import { getPeriodRange } from "../../reporting/ghg-data";
import { convert, unitInfo } from "../values/units";
import { ghgFilters } from "./ghg";
import { cached, SNAPSHOT_ROW_LIMIT, type Adapter, type AdapterInput, type SkippedRow } from "./types";

type Row = Record<string, any>;

interface Fuel {
  key: string;
  match: string[];
  ncv_gj_per_tonne: number;
  density_kg_per_litre?: number;
  density_kg_per_m3?: number;
}

const DATA_DIR = [path.resolve(__dirname, "../../../data/kpi"), path.resolve(process.cwd(), "data/kpi")].find((d) => fs.existsSync(path.join(d, "ncv.json")))!;
const NCV = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "ncv.json"), "utf8")) as { fuels: Fuel[]; ncv_source: string };
const RENEWABLES = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "renewables.json"), "utf8")) as { category_words: string[]; activity_words: string[] };

const COMBUSTION = /combust|fuel|stationary|mobile|vehicle|generator|boiler|furnace|kiln|fleet/i;
const hasWord = (text: string, words: string[]) => words.some((w) => text.toLowerCase().includes(w.toLowerCase()));

export interface EnergyRow {
  id: number;
  scope: string | null;
  category: string;
  activity: string;
  quantity: number;
  unit: string;
  snapshot_ncv: number | null;
  snapshot_ncv_unit: string | null;
}

/** Whether a row is an energy row at all (others are ignored, not skipped). */
export const isEnergyRow = (r: Pick<EnergyRow, "scope" | "category">): boolean => {
  const scope = (r.scope ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (scope === "scope2") return true;
  if (scope === "scope1") return COMBUSTION.test(r.category);
  if (!scope) return hasWord(r.category, RENEWABLES.category_words);
  return false;
};

export const isRenewable = (r: Pick<EnergyRow, "category" | "activity">): boolean => hasWord(r.category, RENEWABLES.category_words) || hasWord(r.activity, RENEWABLES.activity_words);

/** The fuel of an activity name (first match, specific names first), or null. */
export const fuelOf = (activity: string): Fuel | null => NCV.fuels.find((f) => hasWord(activity, f.match)) ?? null;

/** A row's quantity in GJ, or why it can't be converted. Pure. */
export function rowGj(r: EnergyRow): { gj: number } | { skipped: string } {
  if (!(r.quantity > 0)) return { skipped: "no quantity" };
  const info = unitInfo(r.unit);
  if (info?.dimension === "energy") {
    const gj = convert(r.quantity, r.unit, "GJ");
    return gj === null ? { skipped: `unit ${r.unit}` } : { gj };
  }
  // The row's own NCV (GJ per unit) first.
  if (r.snapshot_ncv !== null && r.snapshot_ncv > 0) {
    const per = r.snapshot_ncv_unit ?? r.unit;
    const qty = per === r.unit ? r.quantity : convert(r.quantity, r.unit, per);
    if (qty !== null) return { gj: Number((qty * r.snapshot_ncv).toPrecision(12)) };
  }
  if (!info || (info.dimension !== "mass" && info.dimension !== "volume") || info.family === "co2e") return { skipped: r.unit ? `unit ${r.unit} isn't energy, mass or volume` : "no unit" };
  const fuel = fuelOf(r.activity);
  if (!fuel) return { skipped: "no calorific value for this fuel" };
  let tonnes: number | null = null;
  if (info.dimension === "mass") tonnes = convert(r.quantity, r.unit, "tonne");
  else if (fuel.density_kg_per_litre !== undefined) {
    const litres = convert(r.quantity, r.unit, "litre");
    tonnes = litres === null ? null : (litres * fuel.density_kg_per_litre) / 1000;
  } else if (fuel.density_kg_per_m3 !== undefined) {
    const m3 = convert(r.quantity, r.unit, "m3");
    tonnes = m3 === null ? null : (m3 * fuel.density_kg_per_m3) / 1000;
  }
  if (tonnes === null) return { skipped: `no density for ${fuel.key} by volume` };
  return { gj: Number((tonnes * fuel.ncv_gj_per_tonne).toPrecision(12)) };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Approved energy rows of the sites in the period (memoised per refresh). */
const energyRows = (input: AdapterInput): Promise<EnergyRow[]> => {
  const f = ghgFilters(input.siteIds, input.period);
  return cached(input, `energy:${JSON.stringify(f)}`, async () => {
    const range = getPeriodRange(f.yearType, f.year, f.frequency, f.month, f.quarter);
    const rows: Row[] = await input.m.query(
      `SELECT e.pk_id, c.scope, c.category_name, e.activity_data, e.activity_data_unit, e.emission_factor_snapshot AS snap
         FROM emission e JOIN category c ON c.category_id = e.category_id
        WHERE e.status = 'approved' AND e.site_id = ANY($1::int[]) AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
        ORDER BY e.pk_id`,
      [f.siteIds, range.startDate, range.endDate],
    );
    return rows
      .map((r) => {
        const data = (r.activity_data ?? {}) as Record<string, unknown>;
        const snap = (r.snap ?? {}) as Record<string, unknown>;
        return {
          id: Number(r.pk_id),
          scope: r.scope ?? null,
          category: String(r.category_name ?? ""),
          activity: String(data.fuelType ?? data.emission_category ?? snap.emission_category_name ?? ""),
          quantity: pickActivityValue(data),
          unit: String(r.activity_data_unit || snap.denominator_unit || ""),
          snapshot_ncv: num(snap.ncv),
          snapshot_ncv_unit: typeof snap.ncv_unit === "string" ? snap.ncv_unit : null,
        };
      })
      .filter(isEnergyRow);
  });
};

const energy =
  (which: "total" | "renewable" | "non_renewable"): Adapter =>
  async (input) => {
    const rows = (await energyRows(input)).filter((r) => which === "total" || (which === "renewable" ? isRenewable(r) : !isRenewable(r)));
    if (!rows.length) return null;
    let gj = 0;
    let used = 0;
    const skipped: SkippedRow[] = [];
    for (const r of rows) {
      const c = rowGj(r);
      if ("gj" in c) {
        gj += c.gj;
        used++;
      } else skipped.push({ id: r.id, reason: c.skipped });
    }
    const canonical = input.kpi.canonical_unit ?? "GJ";
    const value = used ? convert(Number(gj.toPrecision(12)), "GJ", canonical) : null;
    return {
      value_canonical: value,
      unit: canonical,
      snapshot: {
        kind: "energy",
        part: which,
        filters: { site_ids: input.siteIds, period_start: input.period.start, period_end: input.period.end, year_type: input.period.year_type },
        rows: used,
        row_ids: rows.filter((r) => !skipped.some((s) => s.id === r.id)).slice(0, SNAPSHOT_ROW_LIMIT).map((r) => r.id),
        skipped,
        ncv_source: NCV.ncv_source,
        read_at: new Date().toISOString(),
      },
    };
  };

export const energyTotal = energy("total");
export const energyRenewable = energy("renewable");
export const energyNonRenewable = energy("non_renewable");
