/**
 * The calculation (IM1): activity data × factor → tCO₂e, plus the FERA twin.
 * Pure of database access; the caller supplies the loaded CategoryContext.
 *
 * Every expression here is the one createEmission used, in the same order of
 * operations, so stored numbers do not move (ci/golden).
 */
import type { EmissionFactor } from "../../entities/EmissionFactor";
import type { CalculationSpec } from "../../entities/ColumnConfig";
import { computeSpecActivityValue } from "../calculationSpec";
import { pickActivityValue } from "../activityValue";
import { getConversionFactor, unitsMatchExact } from "./units";
import type { FactorIndex } from "./resolve";
import type { RowIssueCode } from "../../imports/errors";

/** Loaded once per site × category and shared by every row of that pair. */
export interface CategoryContext {
  site_id: number;
  category_id: number;
  category_name: string;
  scope: string | null;
  /** The site has this category assigned. */
  assigned: boolean;
  /** A column config exists for site × category. */
  hasForm: boolean;
  spec: CalculationSpec | null;
  selectColumns: Set<string>;
  factors: FactorIndex;
  /** The site's FERA category and its factors, when the site has one. */
  fera: { category_id: number; factors: FactorIndex } | null;
}

export interface EngineIssue {
  code: RowIssueCode;
  message: string;
  field?: string;
  /** Extra response fields the typed-entry endpoint returns (expected_unit…). */
  extra?: Record<string, unknown>;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** tCO₂e for a value in the factor's unit, rounded as the controller did. */
export const totalFor = (activityValue: number, factor: EmissionFactor): number =>
  Math.round(((activityValue * factor.factor_value) / 1000) * 100) / 100;

export interface Computed {
  activityValue: number;
  activity_unit: string;
  conversion?: number;
  total: number;
}

export type ComputeResult = { ok: true; computed: Computed } | { ok: false; issue: EngineIssue };

/**
 * One row's total, given its (possibly spec-computed) activity value.
 * `activity_data` may be updated: spec categories write the computed product
 * into `activity_value`, as the typed-entry path does.
 */
export const computeTotal = (
  ctx: CategoryContext,
  factor: EmissionFactor,
  activity_data: Record<string, any>,
  activity_unit: string,
): ComputeResult & { activity_unit?: string } => {
  let activityValue = 0;
  let unit = activity_unit;
  if (ctx.spec) {
    const computed = computeSpecActivityValue(ctx.spec, activity_data, unit);
    if (!computed.ok) {
      return { ok: false, issue: { code: specIssueCode(computed.message), message: computed.message } };
    }
    activityValue = computed.value;
    if (computed.unitKey) unit = computed.unitKey;
    activity_data.activity_value = String(activityValue);
  } else {
    activityValue = pickActivityValue(activity_data, ctx.selectColumns);
  }

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

/** Spec messages that mean "a field is missing" vs "a field holds a wrong option". */
const specIssueCode = (message: string): RowIssueCode =>
  /not configured|cannot be more than 100|Please select a unit|Please choose/.test(message) ? "FIELD_INVALID" : "FIELD_REQUIRED";

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

export const factorSnapshot = (f: EmissionFactor) => ({
  emission_factor_id: f.emission_factor_id,
  emission_category_name: f.emission_category_name,
  global_category_name: f.global_category_name || undefined,
  factor_value: f.factor_value,
  denominator_unit: f.denominator_unit,
  source: f.source,
  year: f.year,
});
