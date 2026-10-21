/**
 * IN-5 · additive LMDI (log-mean Divisia index) decomposition, pure (I8,
 * docs/insights/research.md §4).
 *
 * An aggregate E = Σᵢ Eᵢ where each component is a product of factors,
 * Eᵢ = Πₖ xᵢₖ. Between years 0 and T the additive effect of factor k is
 *
 *     Δₖ = Σᵢ L(Eᵢᵀ, Eᵢ⁰) · ln(xᵢₖᵀ / xᵢₖ⁰),   L(a, b) = (a − b) / (ln a − ln b),  L(a, a) = a
 *
 * and the effects add up exactly to Eᵀ − E⁰ (the log ratios of a component's
 * factors sum to ln(Eᵢᵀ / Eᵢ⁰), so each component's effects sum to Eᵢᵀ − Eᵢ⁰).
 *
 * Zero or negative values have no logarithm: they are replaced by SMALL (1e-9,
 * the standard small-value substitution) and named in `substituted`, so the
 * caller can say so in its notes. Each component's E is the product of its
 * (substituted) factors, so the identity holds for what was decomposed.
 *
 *   logMean(a, b)                       L(a, b) for a, b > 0
 *   lmdiAdditive(components)            {effects (by factor name, summed over components),
 *                                        components: [{name, e0, eT, weight, factors: [{name,
 *                                        x0, xT, ln_ratio, effect}]}], substituted}
 */

export const SMALL = 1e-9;

export function logMean(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) throw new Error("logMean needs positive values");
  if (Math.abs(a - b) <= 1e-12 * Math.max(a, b)) return (a + b) / 2;
  return (a - b) / (Math.log(a) - Math.log(b));
}

export interface LmdiFactor {
  /** Shared names add up across components (e.g. "activity" in Scope 1 and Scope 2). */
  name: string;
  x0: number;
  xT: number;
}

export interface LmdiComponent {
  name: string;
  factors: LmdiFactor[];
}

export interface LmdiComponentResult {
  name: string;
  e0: number;
  eT: number;
  /** L(Eᵀ, E⁰). */
  weight: number;
  factors: Array<LmdiFactor & { ln_ratio: number; effect: number }>;
}

export interface LmdiResult {
  effects: Record<string, number>;
  components: LmdiComponentResult[];
  /** "component.factor@0|T" for every value replaced by SMALL. */
  substituted: string[];
}

export function lmdiAdditive(components: LmdiComponent[]): LmdiResult {
  const effects: Record<string, number> = {};
  const substituted: string[] = [];
  const out: LmdiComponentResult[] = [];
  for (const c of components) {
    const fs = c.factors.map((f) => {
      let x0 = f.x0;
      let xT = f.xT;
      if (!(x0 > 0) || !Number.isFinite(x0)) {
        substituted.push(`${c.name}.${f.name}@0`);
        x0 = SMALL;
      }
      if (!(xT > 0) || !Number.isFinite(xT)) {
        substituted.push(`${c.name}.${f.name}@T`);
        xT = SMALL;
      }
      return { name: f.name, x0, xT };
    });
    const e0 = fs.reduce((a, f) => a * f.x0, 1);
    const eT = fs.reduce((a, f) => a * f.xT, 1);
    const weight = logMean(eT, e0);
    const factors = fs.map((f) => {
      const ln_ratio = Math.log(f.xT / f.x0);
      const effect = weight * ln_ratio;
      effects[f.name] = (effects[f.name] ?? 0) + effect;
      return { ...f, ln_ratio, effect };
    });
    out.push({ name: c.name, e0, eT, weight, factors });
  }
  return { effects, components: out, substituted };
}

// ── The emissions bridge (I8) ─────────────────────────────────────────────────
//
//   bridgeSteps(from, to, opts)  the Bridge steps between two years:
//     Scope 1 = Q × I₁                    (I₁ = S1 ÷ Q)
//     Scope 2 = Q × (kWh ÷ Q) × (S2 ÷ kWh)
//     Scope 3 as one block (its change is its own step)
//     other   = the change in saved (null-scope) tCO₂e (net = gross − saved), plus the whole
//               change of any scope that lacks inputs (no output, or no kWh for Scope 2)
//   Steps in order activity, intensity_s1, energy_intensity_s2, grid_and_renewables_s2, scope3,
//   other; a step is listed only when its inputs exist (other only when it isn't 0). Σ steps =
//   to.net − from.net: what's left after the logarithms (float residue, ≤ 1e-9 of the figures)
//   and Overview's 3-decimal rounding of each figure (≤ 0.002 t) is added to the largest step,
//   so the waterfall closes exactly; anything larger is a bug and throws.

export interface BridgeYear {
  year: number;
  net: number;
  s1: number;
  s2: number;
  s3: number;
  saved: number;
  /** Output (or an output index when units differ); null without production. */
  q: number | null;
  /** Electricity kWh (Scope 2 + renewable); null without electricity rows. */
  kwh: number | null;
  /** Renewable share of that electricity, % (drawer input only). */
  renewable_pct: number | null;
}

export type BridgeDriver = "activity" | "intensity_s1" | "energy_intensity_s2" | "grid_and_renewables_s2" | "scope3" | "other";

export interface BridgeStep {
  driver: BridgeDriver;
  label: string;
  value: number;
  inputs: Record<string, number>;
}

/** Largest residue the waterfall absorbs, t (Overview rounds each tCO₂e figure to 3 decimals). */
export const RESIDUE_MAX = 0.005;

export const NO_PRODUCTION_NOTE = "Add production data to split by driver.";

const per = (unit: string | null) => (unit ? `per ${unit}` : "per unit of output");

/** Plain-word labels (05-ux §4 D), by direction. */
export function stepLabel(driver: BridgeDriver, value: number, unit: string | null): string {
  const down = value < 0;
  switch (driver) {
    case "activity":
      return down ? "Less output" : "More output";
    case "intensity_s1":
      return down ? "Better process efficiency" : "Worse process efficiency";
    case "energy_intensity_s2":
      return down ? `Less electricity ${per(unit)}` : `More electricity ${per(unit)}`;
    case "grid_and_renewables_s2":
      return down ? "Cleaner electricity" : "More carbon-intensive electricity";
    case "scope3":
      return "Supply chain (Scope 3)";
    default:
      return "Other";
  }
}

const ORDER: BridgeDriver[] = ["activity", "intensity_s1", "energy_intensity_s2", "grid_and_renewables_s2", "scope3", "other"];

export function bridgeSteps(from: BridgeYear, to: BridgeYear, opts: { unit: string | null; outputIndex: boolean }): { steps: BridgeStep[]; notes: string[] } {
  const notes: string[] = [];
  const hasQ = from.q !== null && to.q !== null && from.q > 0 && to.q > 0;
  const kwhOk = from.kwh !== null && to.kwh !== null && from.kwh > 0 && to.kwh > 0;
  const s2Used = from.s2 > 0 || to.s2 > 0;
  const values: Partial<Record<BridgeDriver, number>> = {};
  const inputs: Partial<Record<BridgeDriver, Record<string, number>>> = {};
  let other = -(to.saved - from.saved);
  const otherInputs: Record<string, number> = { saved_from: from.saved, saved_to: to.saved };
  if (Math.abs(other) > 1e-9) notes.push("Other includes the change in renewable and other no-scope savings.");

  if (!hasQ) {
    notes.push(NO_PRODUCTION_NOTE);
    other += to.s1 - from.s1 + (to.s2 - from.s2);
    otherInputs.scope1_change = to.s1 - from.s1;
    otherInputs.scope2_change = to.s2 - from.s2;
  } else {
    const q0 = from.q as number;
    const qT = to.q as number;
    const components: LmdiComponent[] = [{ name: "scope1", factors: [{ name: "activity", x0: q0, xT: qT }, { name: "intensity_s1", x0: from.s1 / q0, xT: to.s1 / qT }] }];
    const scope2Split = s2Used && kwhOk;
    if (scope2Split) {
      components.push({
        name: "scope2",
        factors: [
          { name: "activity", x0: q0, xT: qT },
          { name: "energy_intensity_s2", x0: (from.kwh as number) / q0, xT: (to.kwh as number) / qT },
          { name: "grid_and_renewables_s2", x0: from.s2 / (from.kwh as number), xT: to.s2 / (to.kwh as number) },
        ],
      });
    } else if (s2Used) {
      notes.push(`Scope 2 has no electricity kWh in ${!(from.kwh && from.kwh > 0) ? from.year : to.year}: its whole change is in Other.`);
      other += to.s2 - from.s2;
      otherInputs.scope2_change = to.s2 - from.s2;
    }
    const r = lmdiAdditive(components.filter((c) => c.name !== "scope1" || from.s1 > 0 || to.s1 > 0));
    if (r.substituted.length) notes.push(`A zero value was replaced by ${SMALL} to take its logarithm (${r.substituted.join(", ")}).`);
    const c1 = r.components.find((c) => c.name === "scope1");
    const c2 = r.components.find((c) => c.name === "scope2");
    values.activity = r.effects.activity ?? 0;
    inputs.activity = {
      q_from: q0,
      q_to: qT,
      ln_ratio: Math.log(qT / q0),
      ...(c1 ? { l_scope1: c1.weight } : {}),
      ...(c2 ? { l_scope2: c2.weight } : {}),
    };
    values.intensity_s1 = r.effects.intensity_s1 ?? 0;
    inputs.intensity_s1 = { i_from: from.s1 / q0, i_to: to.s1 / qT, l: c1?.weight ?? 0, ln_ratio: c1 ? c1.factors[1].ln_ratio : 0, scope1_from: from.s1, scope1_to: to.s1 };
    if (scope2Split) {
      values.energy_intensity_s2 = r.effects.energy_intensity_s2;
      inputs.energy_intensity_s2 = {
        kwh_per_q_from: (from.kwh as number) / q0,
        kwh_per_q_to: (to.kwh as number) / qT,
        kwh_from: from.kwh as number,
        kwh_to: to.kwh as number,
        l: c2!.weight,
        ln_ratio: c2!.factors[1].ln_ratio,
      };
      values.grid_and_renewables_s2 = r.effects.grid_and_renewables_s2;
      inputs.grid_and_renewables_s2 = {
        tco2e_per_kwh_from: from.s2 / (from.kwh as number),
        tco2e_per_kwh_to: to.s2 / (to.kwh as number),
        scope2_from: from.s2,
        scope2_to: to.s2,
        l: c2!.weight,
        ln_ratio: c2!.factors[2].ln_ratio,
        ...(from.renewable_pct !== null ? { renewable_pct_from: from.renewable_pct } : {}),
        ...(to.renewable_pct !== null ? { renewable_pct_to: to.renewable_pct } : {}),
      };
    }
    if (opts.outputIndex) notes.push("Output is a combined index (sites use different units), weighted by each site's emissions in the first year.");
  }
  values.scope3 = to.s3 - from.s3;
  inputs.scope3 = { scope3_from: from.s3, scope3_to: to.s3 };
  if (Math.abs(other) > 1e-9) {
    values.other = other;
    inputs.other = otherInputs;
  }

  // Close the waterfall exactly: the residue goes to the largest step.
  const listed = ORDER.filter((d) => values[d] !== undefined);
  const total = listed.reduce((a, d) => a + (values[d] as number), 0);
  const residue = to.net - from.net - total;
  if (Math.abs(residue) > RESIDUE_MAX + 1e-6 * Math.max(1, Math.abs(from.net), Math.abs(to.net))) throw new Error(`bridge does not close: residue ${residue}`);
  if (residue !== 0 && listed.length) {
    const big = listed.reduce((a, d) => (Math.abs(values[d] as number) > Math.abs(values[a] as number) ? d : a), listed[0]);
    values[big] = (values[big] as number) + residue;
  }
  const steps = listed.map((d) => ({ driver: d, label: stepLabel(d, values[d] as number, opts.unit), value: values[d] as number, inputs: inputs[d] ?? {} }));
  return { steps, notes };
}
