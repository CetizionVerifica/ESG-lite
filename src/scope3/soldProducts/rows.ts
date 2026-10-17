/**
 * S3-10 · sales of one year → import plan rows for Category 10, 11 or 12.
 * Pure: no database. The rows carry activity fields only (quantities, masses,
 * shares and the select values); the engine finds the factor and calculates.
 *
 *   Category 10  one average_data row per product: Mass sold (kg) (formula 10.2).
 *                Site-specific processing (10.1) needs the customer's own data
 *                and is typed on the form.
 *   Category 11  one row per product, from its use profile (11.1 / 11.2 / 11.3 / 11.5).
 *   Category 12  one row per product × material × treatment with a share above 0
 *                (formula 12.1), or one average_data row per material when the
 *                product has no end-of-life mix.
 *
 * Mass sold = quantity × mass per unit, or the quantity itself when the sale is
 * in a mass unit. Packaging (use profile `packaging_kg_per_unit`) is added for
 * Category 12 only, split by the study's packaging lines.
 */
import type { ImportRow } from "../../imports/contracts";
import { ROW_METHOD_COLUMN } from "../../services/calculationSpec";
import { massKg, type MaterialSplit, type ProductBom } from "./bom";
import {
  AVERAGE_TREATMENT,
  COL_EOL_MASS,
  COL_ENERGY_PER_USE,
  COL_FINAL_SHARE,
  COL_FINAL_USES,
  COL_GAS_PER_PRODUCT,
  COL_GAS_RELEASED,
  COL_LIFETIME_USES,
  COL_MASS_SOLD,
  COL_MATERIAL,
  COL_METHOD,
  COL_PROCESSING,
  COL_PRODUCT,
  COL_PRODUCT_NAME,
  COL_TREATMENT,
  COL_TREATMENT_SHARE,
  COL_UNITS_SOLD,
  COL_USE_OPTION,
  FINAL_PRODUCT_USE,
  MATERIALS,
  PROCESSING_AVERAGE,
  type SoldProductCategory,
  TREATMENT_LABELS,
  USE_METHODS,
  USE_OPTIONS,
  type Material,
} from "./configs";
import { EOL_TREATMENTS, type EolTreatment, type UseProfileExtra } from "./schemas";

export interface SoldProduct {
  product_id: number;
  name: string;
  mass_per_unit_kg: number | null;
  lifetime_uses: number | null;
  eol_mix: Array<{ treatment: string; share: number }> | null;
  use_profile: UseProfileExtra | null;
}

export interface SaleRow {
  product_id: number;
  quantity: number;
  unit: string;
}

export interface SoldTotals {
  /** Units sold (the product's own unit); null when sales are in mass and the mass per unit is unknown. */
  units: number | null;
  /** Mass of the products sold (kg), packaging excluded; null when a sale can't be turned into kg. */
  mass_kg: number | null;
  /** Packaging mass (kg): units × packaging per unit. */
  packaging_kg: number;
}

/** Totals of one product's sales in the year. */
export function soldTotals(product: SoldProduct, sales: SaleRow[]): SoldTotals {
  const perUnit = product.mass_per_unit_kg && product.mass_per_unit_kg > 0 ? product.mass_per_unit_kg : null;
  let units: number | null = 0;
  let mass: number | null = 0;
  for (const s of sales) {
    const kg = massKg(Number(s.quantity), s.unit);
    if (kg !== null) {
      mass = mass === null ? null : mass + kg;
      units = units === null || perUnit === null ? null : units + kg / perUnit;
    } else {
      units = units === null ? null : units + Number(s.quantity);
      mass = mass === null || perUnit === null ? null : mass + Number(s.quantity) * perUnit;
    }
  }
  const packaging = product.use_profile?.packaging_kg_per_unit ?? 0;
  return { units, mass_kg: mass, packaging_kg: units !== null && packaging > 0 ? units * packaging : 0 };
}

/** already_imported: the year's row for it is saved already (the engine checks duplicates of monthly rows only). */
export type SkipReason = "missing_mass" | "missing_units" | "missing_use_profile" | "missing_lifetime_uses" | "already_imported";

export interface PlannedProduct {
  product_id: number;
  row_refs: string[];
  method: string;
}

export interface SoldProductRows {
  rows: ImportRow[];
  planned: PlannedProduct[];
  skipped: Array<{ product_id: number; product: string; reason: SkipReason }>;
}

/** First and last month of a reporting year (FY = April of year − 1 to March, as emissionWrite/period.ts). */
export const yearWindow = (year: number, yearType: "CY" | "FY"): { from: string; to: string } =>
  yearType === "CY" ? { from: `${year}-01-01`, to: `${year}-12-01` } : { from: `${year - 1}-04-01`, to: `${year}-03-01` };

/** "2026-03" or "2026-03-17" → "2026-03-01"; null when it isn't a real month. */
export const monthOf = (raw: string): string | null => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1];
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return `${m[1]}-${m[2]}-01`;
};

/** Up to 6 decimals, no float noise ("4" not "4.000000000001"). */
export const fmt = (n: number): number => Number(n.toFixed(6));

type Base = Pick<ImportRow, "site_id" | "category_id" | "period">;

function cat10(p: SoldProduct, t: SoldTotals, base: Base, out: SoldProductRows) {
  if (t.mass_kg === null || t.mass_kg <= 0) return out.skipped.push({ product_id: p.product_id, product: p.name, reason: "missing_mass" });
  const row_ref = `sold-10-${p.product_id}`;
  out.rows.push({
    ...base,
    row_ref,
    activity_name: PROCESSING_AVERAGE,
    activity_unit: "kg",
    fields: { [ROW_METHOD_COLUMN]: "average_data", [COL_PROCESSING]: PROCESSING_AVERAGE, [COL_PRODUCT]: p.name, [COL_MASS_SOLD]: fmt(t.mass_kg) },
  });
  out.planned.push({ product_id: p.product_id, row_refs: [row_ref], method: "average_data" });
}

function cat11(p: SoldProduct, t: SoldTotals, base: Base, out: SoldProductRows) {
  const skip = (reason: SkipReason) => out.skipped.push({ product_id: p.product_id, product: p.name, reason });
  const u = p.use_profile;
  const type = u?.use_type ?? null;
  if (!u || !type) return skip("missing_use_profile");
  const method = USE_METHODS[type];
  const option = type === "intermediate" ? FINAL_PRODUCT_USE : u.use_option;
  if (!option || !USE_OPTIONS[method]?.includes(option)) return skip("missing_use_profile");
  if (t.units === null || t.units <= 0) return skip("missing_units");
  const fields: Record<string, string | number> = { [COL_METHOD]: method, [COL_USE_OPTION]: option, [COL_PRODUCT_NAME]: p.name, [COL_UNITS_SOLD]: fmt(t.units) };
  let unit: string;
  if (type === "energy") {
    if (!u.energy_per_use_kwh) return skip("missing_use_profile");
    if (!p.lifetime_uses) return skip("missing_lifetime_uses");
    Object.assign(fields, { [COL_ENERGY_PER_USE]: u.energy_per_use_kwh, [COL_LIFETIME_USES]: p.lifetime_uses });
    unit = "kWh";
  } else if (type === "fuel") {
    unit = "litre";
  } else if (type === "gas") {
    if (!u.gas_per_product_kg) return skip("missing_use_profile");
    // 100 % released when unknown (L5442-5452).
    Object.assign(fields, { [COL_GAS_PER_PRODUCT]: u.gas_per_product_kg, [COL_GAS_RELEASED]: u.gas_released_pct ?? 100 });
    unit = "kg";
  } else {
    if (!u.final_product_share_pct) return skip("missing_use_profile");
    if (!p.lifetime_uses) return skip("missing_lifetime_uses");
    Object.assign(fields, { [COL_FINAL_USES]: p.lifetime_uses, [COL_FINAL_SHARE]: u.final_product_share_pct });
    unit = "use";
  }
  const row_ref = `sold-11-${p.product_id}`;
  out.rows.push({ ...base, row_ref, activity_name: `${method}|${option}`, activity_unit: unit, fields });
  out.planned.push({ product_id: p.product_id, row_refs: [row_ref], method: "direct_use" });
}

/** kg per material: the product's mass by its BOM split plus the packaging by the packaging split. */
export function eolMasses(t: SoldTotals, bom: ProductBom | undefined): Array<[Material, number]> {
  const kg: Partial<Record<Material, number>> = {};
  const add = (total: number, split: MaterialSplit) => {
    for (const [m, share] of Object.entries(split) as Array<[Material, number]>) kg[m] = (kg[m] ?? 0) + total * share;
  };
  add(t.mass_kg ?? 0, bom?.product ?? { Mixed: 1 });
  if (t.packaging_kg > 0) add(t.packaging_kg, bom?.packaging ?? { Mixed: 1 });
  return MATERIALS.filter((m) => (kg[m] ?? 0) > 0).map((m) => [m, kg[m]!]);
}

function cat12(p: SoldProduct, t: SoldTotals, bom: ProductBom | undefined, base: Base, out: SoldProductRows) {
  if (t.mass_kg === null || t.mass_kg <= 0) return out.skipped.push({ product_id: p.product_id, product: p.name, reason: "missing_mass" });
  const mix = (p.eol_mix ?? []).filter((x) => x.share > 0 && (EOL_TREATMENTS as readonly string[]).includes(x.treatment));
  const refs: string[] = [];
  eolMasses(t, bom).forEach(([material, kg], i) => {
    const common = { [COL_MATERIAL]: material, [COL_PRODUCT]: p.name, [COL_EOL_MASS]: fmt(kg) };
    if (!mix.length) {
      const row_ref = `sold-12-${p.product_id}-${i + 1}`;
      refs.push(row_ref);
      out.rows.push({
        ...base,
        row_ref,
        activity_name: `${material}|${AVERAGE_TREATMENT}`,
        activity_unit: "kg",
        fields: { [ROW_METHOD_COLUMN]: "average_data", ...common, [COL_TREATMENT]: AVERAGE_TREATMENT },
      });
      return;
    }
    for (const x of mix) {
      const label = TREATMENT_LABELS[x.treatment as EolTreatment];
      const row_ref = `sold-12-${p.product_id}-${i + 1}-${x.treatment}`;
      refs.push(row_ref);
      out.rows.push({
        ...base,
        row_ref,
        activity_name: `${material}|${label}`,
        activity_unit: "kg",
        fields: { [ROW_METHOD_COLUMN]: "waste_type_specific", ...common, [COL_TREATMENT]: label, [COL_TREATMENT_SHARE]: fmt(x.share * 100) },
      });
    }
  });
  out.planned.push({ product_id: p.product_id, row_refs: refs, method: mix.length ? "waste_type_specific" : "average_data" });
}

/** The plan rows for one category from one year's sales, product by product (products without sales are left out). */
export function soldProductRows(
  n: SoldProductCategory,
  products: SoldProduct[],
  sales: SaleRow[],
  boms: Map<number, ProductBom>,
  base: Base,
): SoldProductRows {
  const out: SoldProductRows = { rows: [], planned: [], skipped: [] };
  for (const p of products) {
    const mine = sales.filter((s) => s.product_id === p.product_id);
    if (!mine.length) continue;
    const t = soldTotals(p, mine);
    if (n === 10) cat10(p, t, base, out);
    else if (n === 11) cat11(p, t, base, out);
    else cat12(p, t, boms.get(p.product_id), base, out);
  }
  return out;
}

/**
 * Leaves out the rows already saved for the year (`imported(row)`), listing each
 * product once as `already_imported`. emissionWrite flags DUPLICATE_EXISTING for
 * monthly rows only, so a second yearly plan would otherwise count a year twice.
 */
export function withoutImported(out: SoldProductRows, imported: (row: ImportRow) => boolean): SoldProductRows {
  const gone = new Set(out.rows.filter(imported).map((r) => r.row_ref));
  if (!gone.size) return out;
  const result: SoldProductRows = { rows: out.rows.filter((r) => !gone.has(r.row_ref)), planned: [], skipped: [...out.skipped] };
  for (const p of out.planned) {
    const left = p.row_refs.filter((ref) => !gone.has(ref));
    if (left.length) result.planned.push({ ...p, row_refs: left });
    if (left.length < p.row_refs.length) {
      const f = out.rows.find((r) => r.row_ref === p.row_refs[0])?.fields ?? {};
      const name = String(f[COL_PRODUCT] ?? f[COL_PRODUCT_NAME] ?? "");
      result.skipped.push({ product_id: p.product_id, product: name, reason: "already_imported" });
    }
  }
  return result;
}
