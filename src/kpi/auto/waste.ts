/**
 * KPI-5 · waste_total: the quantity of approved waste rows (GHG Protocol
 * Scope 3 Category 5, "Waste generated in operations") in the period, in the
 * KPI's canonical unit (tonnes). The quantity is the row's activity figure
 * (dropdown ids such as "Disposal Method" are never read as quantities); the
 * unit is the row's activity unit, else its factor's. A breakdown by disposal
 * method comes from the activity name ("ETP sludge - Landfill") when every
 * row names one of the KPI's breakdown values; otherwise there is none.
 * Unconvertible rows are listed as skipped.
 */
import { getPeriodRange } from "../../reporting/ghg-data";
import { pickActivityValue } from "../../services/activityValue";
import { isScope3Sql } from "../../scope3/taxonomy/service";
import { convert } from "../values/units";
import { ghgFilters } from "./ghg";
import { SNAPSHOT_ROW_LIMIT, type Adapter } from "./types";

type Row = Record<string, any>;

/** "ETP Sludge - Landfill" → "landfill"; null without a " - " suffix. */
export const disposalOf = (activity: string): string | null => {
  const i = activity.lastIndexOf(" - ");
  if (i < 0) return null;
  const slug = activity.slice(i + 3).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || null;
};

export const wasteTotal: Adapter = async (input) => {
  const f = ghgFilters(input.siteIds, input.period);
  const range = getPeriodRange(f.yearType, f.year, f.frequency, f.month, f.quarter);
  const rows: Row[] = await input.m.query(
    `SELECT e.pk_id, e.activity_data, e.activity_data_unit, e.emission_factor_snapshot AS snap
       FROM emission e JOIN category c ON c.category_id = e.category_id
      WHERE e.status = 'approved' AND e.site_id = ANY($1::int[]) AND e.date_of_reporting >= $2 AND e.date_of_reporting <= $3
        AND ${isScope3Sql("c")} AND c.ghg_category = 5
      ORDER BY e.pk_id`,
    [f.siteIds, range.startDate, range.endDate],
  );
  if (!rows.length) return null;
  const canonical = input.kpi.canonical_unit ?? "tonne";
  const parts = new Set(input.kpi.breakdowns?.values ?? []);
  let total = 0;
  let used = 0;
  const skipped: Array<{ id: number; reason: string }> = [];
  const breakdown: Record<string, number> = {};
  let byMethod = parts.size > 0;
  for (const r of rows) {
    const data = (r.activity_data ?? {}) as Record<string, unknown>;
    const snap = (r.snap ?? {}) as Record<string, unknown>;
    const qty = pickActivityValue(data);
    const unit = String(r.activity_data_unit || snap.denominator_unit || "");
    const t = qty > 0 ? convert(qty, unit, canonical) : null;
    if (t === null) {
      skipped.push({ id: Number(r.pk_id), reason: qty > 0 ? `unit ${unit || "missing"}` : "no quantity" });
      continue;
    }
    total += t;
    used++;
    const method = disposalOf(String(data.emission_category ?? snap.emission_category_name ?? ""));
    if (method && parts.has(method)) breakdown[method] = Number(((breakdown[method] ?? 0) + t).toPrecision(12));
    else byMethod = false;
  }
  return {
    value_canonical: used ? Number(total.toPrecision(12)) : null,
    unit: canonical,
    breakdown: used && byMethod ? breakdown : null,
    snapshot: {
      kind: "waste",
      filters: { site_ids: input.siteIds, period_start: input.period.start, period_end: input.period.end, ghg_category: 5 },
      rows: used,
      row_ids: rows.filter((r) => !skipped.some((s) => s.id === Number(r.pk_id))).slice(0, SNAPSHOT_ROW_LIMIT).map((r) => Number(r.pk_id)),
      skipped,
      read_at: new Date().toISOString(),
    },
  };
};
