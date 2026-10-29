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
 *
 * D6a: a Category 4, 6, 7 or 9 row makes no twin; the WTT factor the twin
 * would have used is added to the row's own total (`wttPartFor`, below).
 */
import type { EmissionFactor } from "../../../entities/EmissionFactor";
import { pickActivityValue } from "../../activityValue";
import { getConversionFactor, unitsMatchExact } from "../units";
import type { FactorIndex } from "../resolve";
import { ghgNumberFromName, scopeNumber } from "../../../scope3/factors/backfill";
import type { CategoryContext, EngineIssue } from "../compute";
import { roundTonnes } from "../round";
import { factorHasUnit, gasesFor, kgFor } from "./activity";
import type { Gas } from "../../../scope3/contracts/factor";
import type { Scope3Sub } from "../../../scope3/contracts/ghgCategory";

export type { Scope3Sub };

export interface FeraTwin {
  category_id: number;
  factor: EmissionFactor;
  activityValue: number;
  total: number;
  /** kgCO₂e at 4 dp (S3-4). */
  total_kgco2e: string;
  /** kg of each gas and biogenic CO₂ from the factor's gas parts (S3-4); unset when it has none. */
  gas_kg?: Partial<Record<Gas, number>>;
  biogenic_kg?: string;
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
    total: roundTonnes((activityValue * conv * factor.factor_value) / 1000),
    total_kgco2e: kgFor(activityValue * conv, factor),
    ...gasesFor(activityValue * conv, factor),
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
 * Why a row that could have a 3a/3b FERA twin has none, for an edit that must
 * say so (S3-4, FERA_FACTOR_MISSING): the site has a FERA category, the
 * activity is named and the category has no spec. Null when a twin is possible
 * or FERA does not apply. Uses the same lookup as `feraTwinFor`, so a td_loss
 * factor (the 3c twin's) never hides a missing upstream factor or is named as
 * the near match.
 */
export const feraGap = (ctx: CategoryContext, emissionCategory: string, activity_unit: string | null | undefined, targetYear: number): string | null => {
  if (!ctx.fera || ctx.spec || !emissionCategory) return null;
  const factor = upstreamFeraFactor(ctx, emissionCategory, targetYear);
  if (!factor) {
    // FERA applies when the site has any FERA factor for this activity, a
    // td_loss one included (a site with only the T&D factor still misses 3a/3b).
    if (!ctx.fera.factors.knows(emissionCategory)) return null;
    // FERA names must match exactly; say so when only the spelling differs. The
    // hint never names a td_loss factor (built from the instance's class, so this
    // file stays free of resolve.ts's database imports, like compute.ts).
    const Index = ctx.fera.factors.constructor as new (factors: EmissionFactor[]) => FactorIndex;
    const near = new Index(ctx.fera.factors.factors.filter((f) => !isTdLossFactor(f))).find(emissionCategory, targetYear);
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
 * (S3-1, loaded by ContextCache), else read from a Scope 3 category's name
 * ("Upstream transportation and distribution" → 4).
 */
export const ghgCategoryOfContext = (ctx: CategoryContext): number | null => {
  const n = ctx.ghg_category;
  if (typeof n === "number") return n;
  return scopeNumber(ctx.scope) === 3 ? ghgNumberFromName(ctx.category_name) : null;
};

/**
 * D6a · WTT in the row. Scope 3 transport and travel (Categories 4, 6, 7
 * and 9) use life-cycle factors (GHG Protocol Scope 3 Technical Guidance,
 * pp. 14 and 51), so the well-to-tank part of the carrier's or traveller's
 * fuel is added to the row's own total. Category 3 holds the upstream of the
 * reporting company's own fuels and energy only, so these rows get no FERA
 * twin. The WTT factor is the one the twin would have used: the FERA factor
 * of the same name (or global name) for the target year.
 */
export const WTT_IN_ROW_CATEGORIES = [4, 6, 7, 9] as const;

export const wttInRow = (ctx: CategoryContext): boolean => (WTT_IN_ROW_CATEGORIES as readonly number[]).includes(ghgCategoryOfContext(ctx) ?? 0);

/** The WTT part a row's total includes (D6a), kept in its factor snapshot as `wtt`. */
export interface WttPart {
  factor: EmissionFactor;
  /** kgCO₂e at 4 dp. */
  total_kgco2e: string;
  /** kg of each gas and of biogenic CO₂ from the WTT factor's gas parts, as its twin stored them; unset when it has none. */
  gas_kg?: Partial<Record<Gas, number>>;
  biogenic_kg?: string;
}

/** The WTT part of a Category 4, 6, 7 or 9 row: the FERA twin it would have had. Null when there is none. */
export const wttPartFor = (ctx: CategoryContext, emissionCategory: string, activity_data: Record<string, any>, activity_unit: string | null | undefined, targetYear: number): WttPart | null => {
  const twin = feraTwinFor(ctx, emissionCategory, activity_data, activity_unit, targetYear);
  if (!twin) return null;
  return {
    factor: twin.factor,
    total_kgco2e: twin.total_kgco2e,
    ...(twin.gas_kg ? { gas_kg: twin.gas_kg } : {}),
    ...(twin.biogenic_kg !== undefined ? { biogenic_kg: twin.biogenic_kg } : {}),
  };
};

/**
 * The row's total with its WTT part added: kgCO₂e summed at 4 dp, tCO₂e at 2 dp from that sum.
 * The WTT factor's gases and biogenic CO₂ are added too, so per-gas totals keep what the twin held.
 */
export const withWtt = <C extends { total: number; total_kgco2e?: string; gas_kg?: Partial<Record<Gas, number>>; biogenic_kg?: string }>(computed: C, part: WttPart): C => {
  const kg = Number(computed.total_kgco2e ?? computed.total * 1000) + Number(part.total_kgco2e);
  const out: C = { ...computed, total: Math.round((kg / 1000) * 100) / 100, total_kgco2e: kg.toFixed(4) };
  if (part.gas_kg) {
    const gases: Partial<Record<Gas, number>> = { ...(computed.gas_kg ?? {}) };
    for (const [gas, v] of Object.entries(part.gas_kg) as [Gas, number][]) gases[gas] = Math.round(((gases[gas] ?? 0) + v) * 10000) / 10000;
    out.gas_kg = gases;
  }
  if (part.biogenic_kg !== undefined) out.biogenic_kg = (Number(computed.biogenic_kg ?? 0) + Number(part.biogenic_kg)).toFixed(4);
  return out;
};

/**
 * WTT_ALREADY_IN_FACTOR: a Category 4, 6, 7 or 9 row whose life-cycle factor
 * already sums in well-to-tank, so no WTT part is added (D6a). The total is
 * the factor's own. Never blocks.
 */
export const wttDoubleCountWarning = (ctx: CategoryContext, factor: EmissionFactor | null): EngineIssue | null => {
  if (!factor || !wttInRow(ctx)) return null;
  if (factorType(factor) !== "life_cycle" || !factor.includes_wtt) return null;
  return {
    code: "WTT_ALREADY_IN_FACTOR",
    message: `The factor "${factor.emission_category_name}" already includes well-to-tank (WTT) emissions, so no WTT was added to the total.`,
  };
};
