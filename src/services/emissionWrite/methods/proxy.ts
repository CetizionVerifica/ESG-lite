/**
 * Proxy method (S3-12): a row estimated from other rows, never measured
 * (guidance L1384-1399, coffee example L1189-1196). The row's `proxy`
 * (`emission.proxy`, ProxySchema) says how:
 *
 *   coverage   quantity = Σ source kgCO₂e, factor = 1 kgCO₂e per kgCO₂e;
 *              kg = quantity × factor × (100 − coverage_pct) ÷ coverage_pct
 *              (850,000 kg known at 85 % → 150,000 kg for the missing 15 %)
 *   intensity  quantity = output at the sites without data, factor = Σ source
 *              kg ÷ Σ output at the sites with data (kg per unit of output);
 *              kg = quantity × factor
 *              (1,000 t for 500 t output, missing site 250 t → 500,000 kg)
 *   sample     a survey already scaled by its form (S3-9 commuting): the
 *              category's own method, unchanged.
 *
 * Pure: src/scope3/screening/extrapolate.ts sums the sources and builds the
 * row; this file only multiplies. The tCO₂e total is rounded at the end only.
 */
import { ProxySchema } from "../../../scope3/contracts/schemas";
import type { CategoryContext, ComputeResult, FactorRow } from "../compute";
import * as activity from "./activity";
import * as specMethod from "./spec";
import { pickActivityValue } from "../../activityValue";

/** (100 − c) ÷ c: what the known share must be multiplied by to give the missing share. */
export const coverageScale = (coveragePct: number): number => (100 - coveragePct) / coveragePct;

/** kg → stored tCO₂e (2 dp) and kgCO₂e (4 dp). */
const totals = (kg: number) => ({ total: Math.round((kg / 1000) * 100) / 100, total_kgco2e: (Math.round(kg * 10000) / 10000).toFixed(4) });

export const compute = (ctx: CategoryContext, row: FactorRow): ComputeResult => {
  const parsed = ProxySchema.safeParse(row.proxy);
  if (!parsed.success) {
    return {
      ok: false,
      issue: { code: "FIELD_INVALID", field: "proxy", message: "This estimated row's basis isn't valid (coverage needs a share from 1 to 99 %)." },
    };
  }
  const proxy = parsed.data;
  // Every proxy row scales a factor (coverage: 1 kgCO₂e per kgCO₂e; intensity: kg per output
  // unit; sample: its form's own). The engine only routes factored rows here; the guard also
  // narrows S3-6's nullable factor.
  const factor = row.factor;
  if (!factor) return { ok: false, issue: { code: "FIELD_REQUIRED", field: "emission_category", message: "An estimated row needs an emission factor." } };
  // A survey row is scaled by its own form's fields (S3-9); the proxy only labels it.
  if (proxy.basis === "sample") return (ctx.spec ? specMethod : activity).compute(ctx, { ...row, factor });
  const quantity = pickActivityValue(row.activity_data, ctx.selectColumns);
  // The activity step checks and converts the unit (kgCO₂e, or the output unit for intensity).
  const base = activity.applyFactor(quantity, row.activity_unit, factor);
  if (!base.ok) return base;
  if (!(quantity > 0)) return base;

  const scale = proxy.basis === "coverage" ? coverageScale(proxy.coverage_pct!) : 1;
  const inFactorUnit = quantity * (base.computed.conversion ?? 1) * scale;
  const kg = inFactorUnit * Number(factor.factor_value);
  return {
    ok: true,
    computed: {
      ...base.computed,
      ...totals(kg),
      ...activity.gasesFor(inFactorUnit, factor),
      ...(row.method && row.method !== "unknown" ? { method: row.method } : {}),
      data_type: "secondary",
    },
  };
};
