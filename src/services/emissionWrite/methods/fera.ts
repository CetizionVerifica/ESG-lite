/**
 * S3-7 · Category 3 (fuel- and energy-related activities) split and the WTT
 * double-count guard. Spec: ./fera.CLAUDE.md.
 *
 *   3a upstream of fuels        the FERA twin of a fuel row (wtt factor)
 *   3b upstream of electricity  the FERA twin of a Scope 2 row (wtt factor)
 *   3c T&D losses               a second twin of a Scope 2 row, only when a
 *                               td_loss factor exists for the year
 *   3d resold energy            out of scope (no client sells energy)
 *
 * The 3a/3b twin is today's FERA twin, found exactly as before (exact name,
 * else exact global name, target year), except that a td_loss factor is
 * never taken for it. The 3c twin uses a td_loss factor of the site's FERA
 * category whose name or global name is the activity's, uploaded as
 * kgCO₂e per kWh consumed (life-cycle grid factor × loss rate). Nothing here
 * changes the total of a twin that exists today (ci/golden).
 *
 * S3-0 moved `feraTwinFor` here from compute.ts; compute.ts re-exports it.
 */
import type { EmissionFactor } from "../../../entities/EmissionFactor";
import { pickActivityValue } from "../../activityValue";
import { getConversionFactor, unitsMatchExact } from "../units";
import { ghgNumberFromName, scopeNumber } from "../../../scope3/factors/backfill";
import type { CategoryContext, EngineIssue } from "../compute";
import type { Scope3Sub } from "../../../scope3/contracts/ghgCategory";

export type { Scope3Sub };

export interface FeraTwin {
  category_id: number;
  factor: EmissionFactor;
  activityValue: number;
  total: number;
  /** Category 3 sub-activity (S3-7): 3a, 3b or 3c. */
  scope3_sub: Scope3Sub;
}

/** Factor types a FERA twin may use (01-contracts §2: Cat 3 → wtt, td_loss). */
const FERA_FACTOR_TYPES = ["wtt", "td_loss"] as const;

const factorType = (f: EmissionFactor): string | null => f.factor_type ?? null;
export const isTdLossFactor = (f: EmissionFactor): boolean => factorType(f) === "td_loss";

/**
 * The sub-activity of the FERA twin of a parent row: Scope 2 → upstream of
 * electricity, anything else (Scope 1 fuels, or a category with no scope)
 * → upstream of fuels. The migration backfills old twins with the same rule.
 */
export const feraSubFor = (parentScope: string | null | undefined): Scope3Sub =>
  scopeNumber(parentScope ?? null) === 2 ? "3b_upstream_electricity" : "3a_upstream_fuels";

/** Today's FERA lookup (exact name, else exact global name, for the year), never a td_loss factor. */
export const upstreamFeraFactor = (ctx: CategoryContext, name: string, year: number): EmissionFactor | null => {
  if (!ctx.fera) return null;
  const list = ctx.fera.factors.factors.filter((f) => !isTdLossFactor(f));
  return list.find((f) => f.emission_category_name === name && f.year === year) || list.find((f) => f.global_category_name === name && f.year === year) || null;
};

/** The td_loss factor for a Scope 2 activity: same name or global name, same year. */
export const tdLossFactor = (ctx: CategoryContext, name: string, year: number): EmissionFactor | null => {
  if (!ctx.fera) return null;
  const list = ctx.fera.factors.factors.filter(isTdLossFactor);
  return list.find((f) => f.emission_category_name === name && f.year === year) || list.find((f) => f.global_category_name === name && f.year === year) || null;
};

/** activity × factor, converted to the factor's unit, as the FERA twin always has. Null when it can't be. */
const twinWith = (ctx: CategoryContext, factor: EmissionFactor, activity_data: Record<string, any>, activity_unit: string | null | undefined, scope3_sub: Scope3Sub): FeraTwin | null => {
  if (!ctx.fera) return null;
  const activityValue = pickActivityValue(activity_data, ctx.selectColumns);
  if (activityValue <= 0) return null;
  const conv = unitsMatchExact(factor.denominator_unit, activity_unit) ? 1 : getConversionFactor(activity_unit as any, factor.denominator_unit);
  if (!conv) return null;
  return {
    category_id: ctx.fera.category_id,
    factor,
    activityValue,
    total: Math.round(((activityValue * conv * factor.factor_value) / 1000) * 100) / 100,
    scope3_sub,
  };
};

/**
 * The 3a/3b FERA twin a row spawns, or null (no FERA category, no factor for
 * the year, no quantity, or a unit that can't be converted). Never for spec
 * categories. Mode-lock on the FERA category is the caller's check. The same
 * exact lookup as before S3-7, minus td_loss factors (those make the 3c twin).
 */
export const feraTwinFor = (ctx: CategoryContext, emissionCategory: string, activity_data: Record<string, any>, activity_unit: string | null | undefined, targetYear: number): FeraTwin | null => {
  if (!ctx.fera || ctx.spec || !emissionCategory) return null;
  const factor = upstreamFeraFactor(ctx, emissionCategory, targetYear);
  return factor ? twinWith(ctx, factor, activity_data, activity_unit, feraSubFor(ctx.scope)) : null;
};

/**
 * The 3c T&D-loss twin of a Scope 2 row, or null: not a Scope 2 category, a
 * spec category, no td_loss factor for the year, no quantity, or a unit that
 * can't be converted. A missing td_loss factor is normal (most sites have
 * none) and raises nothing.
 */
export const tdLossTwinFor = (ctx: CategoryContext, emissionCategory: string, activity_data: Record<string, any>, activity_unit: string | null | undefined, targetYear: number): FeraTwin | null => {
  if (!ctx.fera || ctx.spec || !emissionCategory || scopeNumber(ctx.scope) !== 2) return null;
  const factor = tdLossFactor(ctx, emissionCategory, targetYear);
  return factor ? twinWith(ctx, factor, activity_data, activity_unit, "3c_td_losses") : null;
};

/**
 * FACTOR_TYPE_MISMATCH on a twin whose factor is typed as something other
 * than wtt or td_loss. A factor with no type yet (saved before S3-2's
 * backfill ran) is not flagged. Never blocks.
 */
export const feraFactorTypeWarning = (twin: FeraTwin | null): EngineIssue | null => {
  if (!twin) return null;
  const type = factorType(twin.factor);
  if (!type || (FERA_FACTOR_TYPES as readonly string[]).includes(type)) return null;
  return {
    code: "FACTOR_TYPE_MISMATCH",
    message: `The FERA factor "${twin.factor.emission_category_name}" is typed ${type}; a Category 3 factor should be wtt (upstream) or td_loss (T&D losses).`,
  };
};

/**
 * The GHG Protocol Scope 3 number of the row's category: `category.ghg_category`
 * once S3-1 adds it, until then read from a Scope 3 category's name
 * ("Upstream transportation and distribution" → 4).
 */
export const ghgCategoryOfContext = (ctx: CategoryContext): number | null => {
  const n = (ctx as { ghg_category?: number | null }).ghg_category;
  if (typeof n === "number") return n;
  return scopeNumber(ctx.scope) === 3 ? ghgNumberFromName(ctx.category_name) : null;
};

/**
 * WTT_ALREADY_IN_FACTOR (D6): a Cat 4 or 9 row whose life-cycle factor
 * already sums in well-to-tank. The row's total is kept as it is; the
 * warning says the WTT part may also be counted in Category 3. Never blocks.
 */
export const wttDoubleCountWarning = (ctx: CategoryContext, factor: EmissionFactor | null): EngineIssue | null => {
  if (!factor) return null;
  const ghg = ghgCategoryOfContext(ctx);
  if (ghg !== 4 && ghg !== 9) return null;
  if (factorType(factor) !== "life_cycle" || !factor.includes_wtt) return null;
  return {
    code: "WTT_ALREADY_IN_FACTOR",
    message: `The factor "${factor.emission_category_name}" already includes well-to-tank (WTT) emissions, which may also be counted in Category 3. The total is kept as it is; upload new freight factors as life_cycle without WTT plus a separate wtt factor.`,
  };
};
