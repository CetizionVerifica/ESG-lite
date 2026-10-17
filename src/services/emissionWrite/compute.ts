/**
 * The calculation (IM1, split by S3-0): picks the method file for a row and
 * returns its total. Pure of database access; the caller supplies the loaded
 * CategoryContext.
 *
 * The bodies live in `methods/` (01-contracts.md §6). Today every row goes to
 * `methods/spec.ts` (categories with a spec) or `methods/activity.ts`, with
 * the same expressions as before, so stored numbers do not move (ci/golden).
 */
import { normalizeUnitKey } from "../calculationSpec";
import type { EmissionFactor } from "../../entities/EmissionFactor";
import type { CalculationSpec } from "../../entities/ColumnConfig";
import type { FactorIndex } from "./resolve";
import type { RowIssueCode } from "../../imports/errors";
import { factorValueText, metaSnapshot } from "../../scope3/factors/meta";
import type { Method } from "../../scope3/contracts/ghgCategory";
import type { Dq, DataType } from "../../scope3/contracts/dq";
import { autoDq, dataTypeFor, type DqFactorInput } from "../../scope3/dq/defaults";
import type { SupplierEngineInput } from "../../scope3/suppliers/engineInput";
import type { Gas } from "../../scope3/contracts/factor";
import type { DeflatorUsed, EmissionFx, SpendQuote } from "../../scope3/spend/types";
import * as activity from "./methods/activity";
import * as spec from "./methods/spec";
import * as spend from "./methods/spend";
import * as supplier from "./methods/supplier";
import * as hybrid from "./methods/hybrid";
import * as proxy from "./methods/proxy";

export { totalFor, kgFor, factorHasUnit } from "./methods/activity";
export { feraTwinFor, feraGap, type FeraTwin } from "./methods/fera";

/** Loaded once per site × category and shared by every row of that pair. */
export interface CategoryContext {
  site_id: number;
  category_id: number;
  category_name: string;
  scope: string | null;
  /** The category's GHG Protocol Scope 3 number (S3-1), when it has one. */
  ghg_category?: number | null;
  /** The site has this category assigned. */
  assigned: boolean;
  /** A column config exists for site × category. */
  hasForm: boolean;
  spec: CalculationSpec | null;
  selectColumns: Set<string>;
  factors: FactorIndex;
  /** The site's FERA category and its factors, when the site has one. */
  fera: { category_id: number; factors: FactorIndex } | null;
  /** The form's unit options for site × category (`unit` table). With exactly one, an entry without a unit is in that unit (S3-4). */
  formUnits?: string[];
  /** The site's country as an ISO-3166 alpha-2 code, for the DQ geography rule (S3-3). */
  site_country?: string | null;
  /**
   * The method keys this form offers, most specific first (S3-3). The first
   * is the default. Read from `column_config.method_options` (`{method, units}`
   * entries) with `offeredMethods`, so the engine only ever sees keys.
   */
  method_options?: Method[] | null;
  /**
   * S3-8: the units each offered method shows, as normalised unit keys
   * (`normalizeUnitKey`), from the same `method_options` entries. A legacy bare
   * key has none. Used only to pick the method a row records when it names none.
   */
  method_units?: Partial<Record<Method, string[]>> | null;
}

export interface EngineIssue {
  code: RowIssueCode;
  message: string;
  field?: string;
  /** Extra response fields the typed-entry endpoint returns (expected_unit…). */
  extra?: Record<string, unknown>;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface Computed {
  activityValue: number;
  activity_unit: string;
  conversion?: number;
  total: number;
  /** Scope 3 fields (01-contracts.md §6). Unset until their modules fill them; S3-4 fills total_kgco2e (kgCO₂e at 4 dp). */
  total_kgco2e?: string;
  /** kg of each gas and of biogenic CO₂ from the factor's gas parts (S3-4, §4); unset when the factor has none. */
  gas_kg?: Partial<Record<Gas, number>>;
  biogenic_kg?: string;
  method?: Method;
  dq?: Dq;
  data_type?: DataType;
  /** S3-5: the rate a spend row used (stored as `emission.fx`) and the deflator (stored in the snapshot). */
  fx?: EmissionFx;
  deflator?: DeflatorUsed;
  /** Warnings the method raised (never block): FX_RATE_FALLBACK, NO_DEFLATOR. */
  warnings?: EngineIssue[];
  /**
   * S3-6: the stored factor snapshot when the method's figure is not the row's
   * emission factor (a supplier's figure, or a hybrid row's components).
   * Unset means `factorSnapshot(row factor)`, as before.
   */
  snapshot?: Record<string, unknown>;
  /** S3-6: the supplier whose figures the row was calculated from. */
  supplier_id?: number;
  /**
   * S3-6: what the DQ rules should read instead of the row's emission factor,
   * when the method used another figure. Consumed by computeRow, never stored.
   */
  quality?: { factor: DqFactorInput; siteCountry?: string | null; hasEvidence?: boolean };
}

export type ComputeResult = { ok: true; computed: Computed } | { ok: false; issue: EngineIssue };

/** One row as the method files see it. */
export interface EngineRow {
  /**
   * The activity's emission factor. Null only on a supplier-specific or hybrid
   * row whose activity has no factor of its own: those methods use the
   * supplier's figures instead (S3-6).
   */
  factor: EmissionFactor | null;
  /** Spec categories write the computed product into `activity_value`. */
  activity_data: Record<string, any>;
  activity_unit: string;
  /** The row's calculation method; missing means the category's default. */
  method?: Method | null;
  /** Set on estimated rows (S3-12). */
  proxy?: unknown;
  /**
   * S3-3: the method the row names in `activity_data["@method"]` (S3-9 forms and
   * rows sent before rows had a `method`). Recorded as the row's method when
   * `method` is unset; it never picks the method file, so totals stay put.
   */
  rowMethod?: Method | null;
  /** The year the row is reported in, for the DQ time rule (S3-3). */
  reportingYear?: number;
  /** An evidence document is already attached (S3-3). */
  hasEvidence?: boolean;
  /** A data quality the caller entered by hand; used as it is, never overwritten (S3-3). */
  manualDq?: Dq | null;
  /** S3-5: amount, rate and deflator of a spend row, loaded before the engine runs (src/scope3/spend/rates.ts). */
  spend?: SpendQuote;
  /** S3-6: the supplier's figures, loaded by `src/scope3/suppliers` for supplier-specific and hybrid rows. */
  supplier?: SupplierEngineInput | null;
}

/** A row the factor methods (activity, spec, spend, proxy) get: it always has its emission factor. */
export type FactorRow = EngineRow & { factor: EmissionFactor };

/** Every method file exports `compute(ctx, row)`. */
type MethodFile = { compute: (ctx: CategoryContext, row: FactorRow) => ComputeResult };
type SupplierMethodFile = { compute: (ctx: CategoryContext, row: EngineRow) => ComputeResult };

const SCOPE_3 = "Scope 3";

/**
 * The method a row records (§6, S3-3): the row's own (`method`, else its
 * `@method`), else the form's first offered method, else average data. Null
 * outside Scope 3: a method is a Scope 3 idea, and Scope 1 and Scope 2 rows
 * carry none.
 *
 * `average_data` is the fallback rather than `unknown`: an activity figure
 * times a published factor *is* the average-data method. `unknown` is kept for
 * legacy rows that never recorded anything.
 */
export const methodFor = (ctx: CategoryContext, row: Pick<EngineRow, "method" | "rowMethod" | "activity_unit">): Method | null => {
  if (ctx.scope !== SCOPE_3) return null;
  return row.method ?? row.rowMethod ?? methodForUnit(ctx, row.activity_unit) ?? ctx.method_options?.[0] ?? "average_data";
};

/**
 * S3-8: the form's default method for a row that names none, read from its
 * unit: the first offered method (in the form's order, most specific first)
 * whose unit list holds the row's unit, both compared as `normalizeUnitKey`
 * keys. So a Category 4 transport row in tonne.km records distance_based and
 * one in litres fuel_based, where `method_options[0]` alone would call both
 * fuel_based. When several methods list the unit (kWh is fuel_based and
 * site_specific on the transport forms) the form's order decides, as it does
 * for `method_options[0]`. Null when no method lists the unit, or the list has
 * no units (legacy bare keys): the caller then falls back to
 * `method_options[0]`, as before.
 *
 * Labels and data quality only: the method file is still picked from the
 * method the caller sent (`methodFileFor`), so no total moves.
 */
export const methodForUnit = (ctx: CategoryContext, unit: unknown): Method | null => {
  const key = normalizeUnitKey(unit);
  if (!key || !ctx.method_options?.length || !ctx.method_units) return null;
  return ctx.method_options.find((m) => ctx.method_units?.[m]?.includes(key)) ?? null;
};

/**
 * The method file for a row, in the order of 01-contracts §6: a proxy row;
 * then the row's method spend_based / supplier_specific / hybrid on any
 * category, spec or not; then a row carrying a spend quote; then the
 * category's spec; else activity × factor.
 *
 * Only the method the caller sends (`row.method`) picks a file here. The form's
 * default (`method_options[0]`) reaches the engine another way: index.ts asks
 * for a spend quote when it is spend_based, and that quote picks the spend
 * file. S3-6: supplier-specific and hybrid are real methods now. index.ts
 * passes them as `row.method` whenever the row asks for one (its `method`,
 * its `@method`, or the form's default when the row names a supplier); an
 * `@method` naming one, with the supplier's figures on the row, routes the
 * same way here for callers that don't.
 */
const methodFileFor = (ctx: CategoryContext, row: EngineRow): MethodFile | SupplierMethodFile => {
  if (row.proxy) return proxy;
  const named = row.method ?? (row.supplier && (row.rowMethod === "supplier_specific" || row.rowMethod === "hybrid") ? row.rowMethod : null);
  switch (named) {
    case "spend_based":
      return spend;
    case "supplier_specific":
      return supplier;
    case "hybrid":
      return hybrid;
  }
  // S3-5: a spend row is the amount spent whatever fields the form multiplies (a Category 6 trip paid in INR).
  if (row.spend) return spend;
  if (ctx.spec) return spec;
  return activity;
};

/**
 * One row's total, from the method file the row picks, plus how it was
 * calculated and how good its data is (S3-3). The quality never changes the
 * total: it is worked out from the method, the factor's own metadata, the
 * site's country and the reporting year, and attached to the result.
 */
const isSupplierMethod = (file: MethodFile | SupplierMethodFile): file is SupplierMethodFile => file === supplier || file === hybrid;

export const computeRow = (ctx: CategoryContext, row: EngineRow): ComputeResult => {
  const file = methodFileFor(ctx, row);
  let result: ComputeResult;
  if (isSupplierMethod(file)) result = file.compute(ctx, row);
  else if (row.factor) result = file.compute(ctx, row as FactorRow);
  else return { ok: false, issue: { code: "NO_FACTOR_FOR_YEAR", message: "No emission factor was found for this activity." } };
  if (!result.ok) return result;
  if (ctx.scope !== SCOPE_3) {
    // Scope 1 and Scope 2 rows carry no method, even when a file names one (a Scope 2 bill in INR takes the spend file).
    const { method: _method, dq: _dq, data_type: _dataType, quality: _quality, ...rest } = result.computed;
    return { ok: true, computed: rest };
  }
  const { quality, ...computed } = result.computed;
  // The method file's own word wins (a spend quote makes a spend row, S3-5), then the row's, then the form's.
  const method = computed.method ?? methodFor(ctx, row);
  if (!method) return { ok: true, computed };

  // S3-6: a supplier's figure (or the evidence on it) speaks for the row.
  const hasEvidence = !!row.hasEvidence || !!quality?.hasEvidence;
  const dq =
    row.manualDq ??
    autoDq({
      method,
      factor: quality?.factor ?? { geography: row.factor?.geography, year: row.factor?.year, factor_type: row.factor?.factor_type },
      siteCountry: quality ? quality.siteCountry : ctx.site_country,
      // The row is being written now, so this year stands in when the caller
      // names no period; every write path in index.ts passes the real one.
      reportingYear: row.reportingYear ?? new Date().getUTCFullYear(),
      hasEvidence,
      isProxy: !!row.proxy,
    });

  return {
    ok: true,
    computed: {
      ...computed,
      method,
      dq,
      // A method file's own word wins here too: a proxy row is secondary data
      // whatever method its sources used (S3-12, guidance L1289-1291).
      data_type: result.computed.data_type ?? dataTypeFor({ method, hasEvidence }),
    },
  };
};

/**
 * One row's total (the pre-S3 signature, used by index.ts).
 * `activity_data` may be updated: spec categories write the computed product
 * into `activity_value`, as the typed-entry path does.
 */
export const computeTotal = (
  ctx: CategoryContext,
  factor: EmissionFactor | null,
  activity_data: Record<string, any>,
  activity_unit: string,
  /** S3-3, S3-5 and S3-6: what the row says about its own method and quality, a spend row's quote, a supplier row's figures. */
  extra: Pick<EngineRow, "method" | "rowMethod" | "reportingYear" | "hasEvidence" | "manualDq" | "proxy" | "spend" | "supplier"> = {},
): ComputeResult & { activity_unit?: string } => computeRow(ctx, { factor, activity_data, activity_unit, ...extra });

/** The stored factor snapshot; a spend row adds the deflator it used (S3-5). */
export const factorSnapshot = (f: EmissionFactor, deflator?: DeflatorUsed) => ({
  emission_factor_id: f.emission_factor_id,
  emission_category_name: f.emission_category_name,
  global_category_name: f.global_category_name || undefined,
  // numeric(18,8) since S3-2: written with 4 decimals or more, as before.
  factor_value: factorValueText(f.factor_value) as EmissionFactor["factor_value"],
  denominator_unit: f.denominator_unit,
  source: f.source,
  year: f.year,
  // S3-2: factor_type, gwp_set, geography, dataset, dataset_version, gases.
  ...metaSnapshot(f),
  ...(deflator ? { deflator } : {}),
});
