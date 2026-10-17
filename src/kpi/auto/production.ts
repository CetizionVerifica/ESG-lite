/**
 * KPI-5 · production_output: approved `production_data` quantity of the sites
 * whose whole period (start_date … end_date) lies inside the KPI period (the
 * rule src/pcf/plantData.ts uses), in the KPI's canonical unit, with a
 * breakdown per product (`product_<id>`). It is a denominator, so it adds up
 * only quantities that convert to one unit: when any product's unit doesn't,
 * there is no total and the snapshot lists every product in its own unit.
 */
import { convert } from "../values/units";
import { SNAPSHOT_ROW_LIMIT, type Adapter } from "./types";

type Row = Record<string, any>;

export const productionOutput: Adapter = async (input) => {
  const rows: Row[] = await input.m.query(
    `SELECT p.production_id, p.product_id, pr.name AS product_name, p.quantity, p.unit
       FROM production_data p LEFT JOIN product pr ON pr.product_id = p.product_id
      WHERE p.status = 'approved' AND p.site_id = ANY($1::int[]) AND p.start_date >= $2 AND p.end_date <= $3
      ORDER BY p.production_id`,
    [input.siteIds, input.period.start, input.period.end],
  );
  if (!rows.length) return null;
  const units = [...new Set(rows.map((r) => String(r.unit ?? "")))];
  const canonical = input.kpi.canonical_unit ?? (units.length === 1 ? units[0] : null);
  const products = new Map<number, { product_id: number; name: string; quantity: number; unit: string }>();
  let total = 0;
  const skipped: Array<{ id: number; reason: string }> = [];
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const qty = Number(r.quantity) || 0;
    const key = Number(r.product_id);
    const p = products.get(key) ?? { product_id: key, name: r.product_name ?? `Product ${key}`, quantity: 0, unit: String(r.unit ?? "") };
    p.quantity += qty;
    products.set(key, p);
    const inCanonical = canonical === null ? null : String(r.unit) === canonical ? qty : convert(qty, String(r.unit), canonical);
    if (inCanonical === null) {
      skipped.push({ id: Number(r.production_id), reason: `unit ${r.unit} doesn't convert to ${canonical ?? "one unit"}` });
      continue;
    }
    total += inCanonical;
    breakdown[`product_${key}`] = Number(((breakdown[`product_${key}`] ?? 0) + inCanonical).toPrecision(12));
  }
  const whole = skipped.length === 0;
  return {
    value_canonical: whole ? Number(total.toPrecision(12)) : null,
    unit: canonical,
    breakdown: whole ? breakdown : null,
    snapshot: {
      kind: "production",
      filters: { site_ids: input.siteIds, period_start: input.period.start, period_end: input.period.end },
      rows: rows.length,
      row_ids: rows.slice(0, SNAPSHOT_ROW_LIMIT).map((r) => Number(r.production_id)),
      products: [...products.values()].map((p) => ({ ...p, quantity: Number(p.quantity.toPrecision(12)) })),
      skipped,
      read_at: new Date().toISOString(),
    },
  };
};
