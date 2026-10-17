/**
 * Supplier-specific method (S3-6): the quantity bought × the supplier's own
 * cradle-to-gate figure for that item (guidance formula [1.1], L1745;
 * Example 1.1).
 *
 * The figure is chosen before the engine runs (`pickSupplierFactor`: the
 * newest `reference_year` up to the reporting year) and arrives on
 * `row.supplier.factor`. This file only converts the quantity into the
 * figure's unit (`units.ts`, as every other method) and multiplies. The row's
 * own emission factor, if the activity has one, plays no part.
 */
import { pickActivityValue } from "../../activityValue";
import { getConversionFactor, unitsMatchExact } from "../units";
import type { CategoryContext, ComputeResult, EngineRow } from "../compute";
import type { SupplierFactorInput } from "../../../scope3/suppliers/engineInput";

/** What a supplier-specific row stores as its factor snapshot (spec §Build.4). */
export const supplierSnapshot = (supplierId: number, f: SupplierFactorInput) => ({
  factor_type: "supplier" as const,
  dataset: "supplier",
  supplier_id: supplierId,
  supplier_factor_id: f.supplier_factor_id,
  item: f.item,
  factor_value: String(f.kgco2e_per_unit),
  denominator_unit: f.unit,
  boundary: f.boundary,
  reference_year: f.reference_year,
  year: f.reference_year,
  gwp_set: f.gwp_set,
  source: f.source,
});

/**
 * Converts `value` in `unit` to `target`: as is when the units match, by the
 * shared conversion table otherwise; null when they don't convert.
 */
export const toUnit = (value: number, unit: string, target: string): number | null => {
  if (unitsMatchExact(unit, target)) return value;
  const k = getConversionFactor(unit, target);
  return k ? value * k : null;
};

/** kg → the engine's two totals: tCO₂e at 2 dp (as every row) and kgCO₂e at 4 dp (D5). */
export const totalsFromKg = (kg: number) => ({ total: Math.round((kg / 1000) * 100) / 100, total_kgco2e: (Math.round(kg * 10000) / 10000).toFixed(4) });

export const compute = (ctx: CategoryContext, row: EngineRow): ComputeResult => {
  const supplier = row.supplier;
  if (!supplier) {
    return { ok: false, issue: { code: "FIELD_REQUIRED", message: "Choose the supplier to use the supplier's own figure.", field: "supplier_id" } };
  }
  const f = supplier.factor;
  if (!f) {
    return {
      ok: false,
      issue: { code: "NO_FACTOR_FOR_YEAR", message: "No figure from this supplier yet. Request one or use an average.", field: "supplier_factor_id" },
    };
  }
  const unit = row.activity_unit;
  const activityValue = pickActivityValue(row.activity_data, ctx.selectColumns);
  const quantity = activityValue > 0 ? toUnit(activityValue, unit, f.unit) : 0;
  if (quantity === null) {
    return {
      ok: false,
      issue: {
        code: "UNIT_NOT_CONVERTIBLE",
        message: `Unit mismatch: the supplier's figure is per "${f.unit}" but the quantity is in "${unit}". No conversion available.`,
        field: "activity_unit",
        extra: { expected_unit: f.unit, received_unit: unit },
      },
    };
  }
  const kg = quantity * f.kgco2e_per_unit;
  const conversion = activityValue > 0 && !unitsMatchExact(unit, f.unit) ? quantity / activityValue : undefined;
  return {
    ok: true,
    computed: {
      activityValue,
      activity_unit: unit,
      ...(conversion !== undefined ? { conversion } : {}),
      ...totalsFromKg(kg),
      snapshot: supplierSnapshot(supplier.supplier_id, f),
      supplier_id: supplier.supplier_id,
      // DQ (spec §Build.4): the supplier's own figure describes the activity
      // where it happens, so its geography is the supplier's country and its
      // time is the figure's reference year; evidence on the figure counts.
      quality: {
        factor: { geography: supplier.country, year: f.reference_year, factor_type: "supplier" },
        siteCountry: supplier.country,
        hasEvidence: f.has_evidence,
      },
    },
  };
};
