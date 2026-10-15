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
  method?: Method;
  dq?: Dq;
  data_type?: DataType;
}

export type ComputeResult = { ok: true; computed: Computed } | { ok: false; issue: EngineIssue };

/** One row as the method files see it. */
export interface EngineRow {
  factor: EmissionFactor;
  /** Spec categories write the computed product into `activity_value`. */
  activity_data: Record<string, any>;
  activity_unit: string;
  /** The row's calculation method; missing means the category's default. */
  method?: Method | null;
  /** Set on estimated rows (S3-12). */
  proxy?: unknown;
}

/** Every method file exports `compute(ctx, row)`. */
type MethodFile = { compute: (ctx: CategoryContext, row: EngineRow) => ComputeResult };

/**
 * The method file for a row. Spec categories always use the spec; otherwise
 * the row's method, falling back to activity × factor.
 * TODO(S3-3): fall back to the form's `method_options[0]` when the row has none.
 */
const methodFileFor = (ctx: CategoryContext, row: EngineRow): MethodFile => {
  if (ctx.spec) return spec;
  if (row.proxy) return proxy;
  switch (row.method) {
    case "spend_based":
      return spend;
    case "supplier_specific":
      return supplier;
    case "hybrid":
      return hybrid;
    default:
      return activity;
  }
};

/** One row's total, from the method file the row picks. */
export const computeRow = (ctx: CategoryContext, row: EngineRow): ComputeResult => methodFileFor(ctx, row).compute(ctx, row);

/**
 * One row's total (the pre-S3 signature, used by index.ts).
 * `activity_data` may be updated: spec categories write the computed product
 * into `activity_value`, as the typed-entry path does.
 */
export const computeTotal = (
  ctx: CategoryContext,
  factor: EmissionFactor,
  activity_data: Record<string, any>,
  activity_unit: string,
): ComputeResult & { activity_unit?: string } => computeRow(ctx, { factor, activity_data, activity_unit });

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
