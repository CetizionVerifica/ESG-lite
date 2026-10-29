/**
 * Activity method (S3-0): activity value × factor → tCO₂e. Today's default
 * for every category without a calculation spec.
 *
 * Moved from compute.ts without change: same expressions, same order of
 * operations, so stored numbers do not move (ci/golden).
 */
import type { EmissionFactor } from "../../../entities/EmissionFactor";
import { pickActivityValue } from "../../activityValue";
import { getConversionFactor, unitsMatchExact } from "../units";
import type { CategoryContext, ComputeResult, FactorRow } from "../compute";
import { roundTonnes } from "../round";
import type { Gas } from "../../../scope3/contracts/factor";

/** tCO₂e for a value in the factor's unit, rounded as the controller did. */
export const totalFor = (activityValue: number, factor: EmissionFactor): number =>
  roundTonnes((activityValue * factor.factor_value) / 1000);

/**
 * kgCO₂e at 4 dp for `emission.total_kgco2e` (S3-4, D5): the same product as
 * the tCO₂e total, never rounded before multiplying. A string, as numeric
 * columns read back.
 */
export const kgFor = (quantityInFactorUnit: number, factor: EmissionFactor): string =>
  (Math.round(quantityInFactorUnit * Number(factor.factor_value) * 10000) / 10000).toFixed(4);

/**
 * Per-gas and biogenic kg for a quantity in the factor's unit (S3-4, contracts §4):
 * quantity × each gas part the factor carries, at 4 dp. CO₂, CH₄ and N₂O are kg
 * of each gas; `other_kgco2e` is a CO₂e lump with no single gas, so it stays on
 * the factor. Empty when the factor has no gas parts and no biogenic part, so
 * the row keeps both columns null ("Not tracked").
 */
export const gasesFor = (quantityInFactorUnit: number, factor: EmissionFactor): { gas_kg?: Partial<Record<Gas, number>>; biogenic_kg?: string } => {
  const kg = (part: string | number | null | undefined) =>
    part === null || part === undefined || String(part).trim() === "" ? null : Math.round(quantityInFactorUnit * Number(part) * 10000) / 10000;
  const out: { gas_kg?: Partial<Record<Gas, number>>; biogenic_kg?: string } = {};
  const gases: Partial<Record<Gas, number>> = {};
  for (const [gas, field] of GAS_COLUMNS) {
    const v = kg(factor[field]);
    if (v !== null && Number.isFinite(v)) gases[gas] = v;
  }
  if (Object.keys(gases).length) out.gas_kg = gases;
  const bio = kg(factor.biogenic_co2_kg);
  if (bio !== null && Number.isFinite(bio)) out.biogenic_kg = bio.toFixed(4);
  return out;
};

const GAS_COLUMNS = [
  ["CO2", "co2_kg"],
  ["CH4", "ch4_kg"],
  ["N2O", "n2o_kg"],
] as const satisfies readonly (readonly [Gas, keyof EmissionFactor])[];

/** A factor with no unit can't be checked against the quantity's unit (S3-4). */
export const factorHasUnit = (factor: EmissionFactor): boolean => !!String(factor.denominator_unit ?? "").trim();

/**
 * Applies the factor to an activity value in `unit`: zero for no quantity,
 * as is when the units match, converted when they can be, else an issue.
 * Shared by activity and spec.
 */
export const applyFactor = (activityValue: number, unit: string, factor: EmissionFactor): ComputeResult => {
  if (activityValue <= 0) {
    return { ok: true, computed: { activityValue, activity_unit: unit, total: 0, total_kgco2e: "0.0000", ...gasesFor(0, factor) } };
  }
  if (!factorHasUnit(factor)) {
    return {
      ok: false,
      issue: {
        code: "UNIT_REQUIRED",
        message: `The emission factor "${factor.emission_category_name}" has no unit, so the quantity can't be checked against it. Give the factor its unit on the Emission factors page.`,
        field: "activity_unit",
      },
    };
  }
  if (unitsMatchExact(factor.denominator_unit, unit)) {
    return { ok: true, computed: { activityValue, activity_unit: unit, total: totalFor(activityValue, factor), total_kgco2e: kgFor(activityValue, factor), ...gasesFor(activityValue, factor) } };
  }
  const conversionFactor = getConversionFactor(unit, factor.denominator_unit);
  if (!conversionFactor) {
    return {
      ok: false,
      issue: {
        code: "UNIT_NOT_CONVERTIBLE",
        message: `Unit mismatch: Expected "${factor.denominator_unit}" but received "${unit}". No conversion available.`,
        field: "activity_unit",
        extra: { expected_unit: factor.denominator_unit, received_unit: unit },
      },
    };
  }
  const convertedValue = activityValue * conversionFactor;
  return {
    ok: true,
    computed: {
      activityValue,
      activity_unit: unit,
      conversion: conversionFactor,
      total: roundTonnes((convertedValue * factor.factor_value) / 1000),
      total_kgco2e: kgFor(convertedValue, factor),
      ...gasesFor(convertedValue, factor),
    },
  };
};

export const compute = (ctx: CategoryContext, row: FactorRow): ComputeResult =>
  applyFactor(pickActivityValue(row.activity_data, ctx.selectColumns), row.activity_unit, row.factor);
