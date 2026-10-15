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
import { factorHasUnit, kgFor } from "./activity";

export interface FeraTwin {
  category_id: number;
  factor: EmissionFactor;
  activityValue: number;
  total: number;
  /** kgCO₂e at 4 dp (S3-4). */
  total_kgco2e: string;
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
  // No unit on either side: nothing to check the quantity against, so no twin (S3-4).
  if (!activity_unit || !factorHasUnit(factor)) return null;
  const activityValue = pickActivityValue(activity_data, ctx.selectColumns);
  if (activityValue <= 0) return null;
  const conv = unitsMatchExact(factor.denominator_unit, activity_unit) ? 1 : getConversionFactor(activity_unit as any, factor.denominator_unit);
  if (!conv) return null;
  return {
    category_id: ctx.fera.category_id,
    factor,
    activityValue,
    total: Math.round(((activityValue * conv * factor.factor_value) / 1000) * 100) / 100,
    total_kgco2e: kgFor(activityValue * conv, factor),
  };
};

/**
 * Why a row that could have a FERA twin has none, for an edit that must say
 * so (S3-4): the site has a FERA category, the activity is named and the
 * category has no spec. Null when a twin is possible or FERA does not apply.
 */
export const feraGap = (ctx: CategoryContext, emissionCategory: string, activity_unit: string | null | undefined, targetYear: number): string | null => {
  if (!ctx.fera || ctx.spec || !emissionCategory) return null;
  const factor = ctx.fera.factors.findExactForYear(emissionCategory, targetYear);
  if (!factor) {
    if (!ctx.fera.factors.knows(emissionCategory)) return null;
    // FERA names must match exactly (findExactForYear); say so when only the spelling differs.
    const near = ctx.fera.factors.find(emissionCategory, targetYear);
    if (near && !near.fallback_year) {
      return `the ${targetYear} FERA factor is named "${near.factor.emission_category_name}", not "${emissionCategory}" (FERA names must match exactly)`;
    }
    return `there is no ${targetYear} FERA factor for "${emissionCategory}"`;
  }
  if (!factorHasUnit(factor)) return `the FERA factor for "${emissionCategory}" has no unit`;
  if (!activity_unit) return `the entry has no unit to convert to the FERA factor unit "${factor.denominator_unit}"`;
  if (!unitsMatchExact(factor.denominator_unit, activity_unit) && !getConversionFactor(activity_unit, factor.denominator_unit)) {
    return `"${activity_unit}" can't be converted to the FERA factor unit "${factor.denominator_unit}"`;
  }
  return null;
};
