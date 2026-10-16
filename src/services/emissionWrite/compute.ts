/**
 * The calculation (IM1, split by S3-0): picks the method file for a row and
 * returns its total. Pure of database access; the caller supplies the loaded
 * CategoryContext.
 *
 * The bodies live in `methods/` (01-contracts.md §6). Today every row goes to
 * `methods/spec.ts` (categories with a spec) or `methods/activity.ts`, with
 * the same expressions as before, so stored numbers do not move (ci/golden).
 */
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
  /** The methods this form offers, most specific first (S3-3). The first is the default. */
  method_options?: Method[] | null;
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
  /** The year the row is reported in, for the DQ time rule (S3-3). */
  reportingYear?: number;
  /** An evidence document is already attached (S3-3). */
  hasEvidence?: boolean;
  /** A data quality the caller entered by hand; used as it is, never overwritten (S3-3). */
  manualDq?: Dq | null;
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
 * The method a row is calculated by (§6): the row's own, else the form's first
 * offered method, else average data. Null outside Scope 3 — a method is a
 * Scope 3 idea, and Scope 1 and Scope 2 rows carry none (S3-3).
 *
 * `average_data` is the fallback rather than `unknown`: an activity figure
 * times a published factor *is* the average-data method. `unknown` is kept for
 * legacy rows that never recorded anything.
 */
export const methodFor = (ctx: CategoryContext, row: Pick<EngineRow, "method">): Method | null => {
  if (ctx.scope !== SCOPE_3) return null;
  return row.method ?? ctx.method_options?.[0] ?? "average_data";
};

/**
 * The method file for a row. Supplier-specific and hybrid rows go to their
 * own files on any category, spec or not (01-contracts.md §6, rule 2): their
 * figure is the supplier's, so a form's spec has nothing to add. Otherwise
 * spec categories always use the spec. No row carried either method before
 * S3-6 (the backfill writes neither), so moving them ahead of the spec moves
 * no stored number.
 */
const methodFileFor = (ctx: CategoryContext, row: EngineRow, method: Method | null): MethodFile | SupplierMethodFile => {
  if (method === "supplier_specific") return supplier;
  if (method === "hybrid") return hybrid;
  if (ctx.spec) return spec;
  if (row.proxy) return proxy;
  switch (method) {
    case "spend_based":
      return spend;
    default:
      return activity;
  }
};

const isSupplierMethod = (file: MethodFile | SupplierMethodFile): file is SupplierMethodFile => file === supplier || file === hybrid;

/**
 * One row's total, from the method file the row picks, plus how it was
 * calculated and how good its data is (S3-3). The quality never changes the
 * total: it is worked out from the method, the factor's own metadata, the
 * site's country and the reporting year, and attached to the result.
 */
export const computeRow = (ctx: CategoryContext, row: EngineRow): ComputeResult => {
  const method = methodFor(ctx, row);
  const file = methodFileFor(ctx, row, method);
  let result: ComputeResult;
  if (isSupplierMethod(file)) result = file.compute(ctx, row);
  else if (row.factor) result = file.compute(ctx, row as FactorRow);
  else return { ok: false, issue: { code: "NO_FACTOR_FOR_YEAR", message: "No emission factor was found for this activity." } };
  if (!result.ok) return result;

  const { quality, ...computed } = result.computed;
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
      data_type: dataTypeFor({ method, hasEvidence }),
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
  /** S3-3: what the row says about its own method and quality, when it says anything. */
  quality: Pick<EngineRow, "method" | "reportingYear" | "hasEvidence" | "manualDq" | "proxy" | "supplier"> = {},
): ComputeResult & { activity_unit?: string } => computeRow(ctx, { factor, activity_data, activity_unit, ...quality });

export const factorSnapshot = (f: EmissionFactor) => ({
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
});
