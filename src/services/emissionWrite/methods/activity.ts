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
import type { CategoryContext, ComputeResult, EngineRow } from "../compute";

/** tCO₂e for a value in the factor's unit, rounded as the controller did. */
export const totalFor = (activityValue: number, factor: EmissionFactor): number =>
  Math.round(((activityValue * factor.factor_value) / 1000) * 100) / 100;

/**
 * Applies the factor to an activity value in `unit`: zero for no quantity,
 * as is when the units match, converted when they can be, else an issue.
 * Shared by activity and spec.
 */
export const applyFactor = (activityValue: number, unit: string, factor: EmissionFactor): ComputeResult => {
  if (activityValue <= 0) {
    return { ok: true, computed: { activityValue, activity_unit: unit, total: 0 } };
  }
  if (unitsMatchExact(factor.denominator_unit, unit)) {
    return { ok: true, computed: { activityValue, activity_unit: unit, total: totalFor(activityValue, factor) } };
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
    computed: { activityValue, activity_unit: unit, conversion: conversionFactor, total: Math.round(((convertedValue * factor.factor_value) / 1000) * 100) / 100 },
  };
};

export const compute = (ctx: CategoryContext, row: EngineRow): ComputeResult =>
  applyFactor(pickActivityValue(row.activity_data, ctx.selectColumns), row.activity_unit, row.factor);
