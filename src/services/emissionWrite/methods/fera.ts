/**
 * FERA twin (S3-0 move; S3-7 owns from here): the fuel- and energy-related
 * row a fuel or electricity row spawns in the site's FERA category.
 *
 * Moved from compute.ts without change (ci/golden).
 */
import type { EmissionFactor } from "../../../entities/EmissionFactor";
import { pickActivityValue } from "../../activityValue";
import { getConversionFactor, unitsMatchExact } from "../units";
import type { CategoryContext } from "../compute";

export interface FeraTwin {
  category_id: number;
  factor: EmissionFactor;
  activityValue: number;
  total: number;
}

/**
 * The FERA twin a row spawns, or null (no FERA category, no factor for the
 * year, no quantity, or a unit that can't be converted). Never for spec
 * categories. Mode-lock on the FERA category is the caller's check.
 */
export const feraTwinFor = (ctx: CategoryContext, emissionCategory: string, activity_data: Record<string, any>, activity_unit: string | null | undefined, targetYear: number): FeraTwin | null => {
  if (!ctx.fera || ctx.spec || !emissionCategory) return null;
  const factor = ctx.fera.factors.findExactForYear(emissionCategory, targetYear);
  if (!factor) return null;
  const activityValue = pickActivityValue(activity_data, ctx.selectColumns);
  if (activityValue <= 0) return null;
  const conv = unitsMatchExact(factor.denominator_unit, activity_unit) ? 1 : getConversionFactor(activity_unit as any, factor.denominator_unit);
  if (!conv) return null;
  return { category_id: ctx.fera.category_id, factor, activityValue, total: Math.round(((activityValue * conv * factor.factor_value) / 1000) * 100) / 100 };
};
