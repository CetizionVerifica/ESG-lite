// PCF calculation engine (E1). Pure: no database, no clock, no randomness.
// Spec: docs/pcf/foundation/E1-data-and-engine/CLAUDE.md ("Calculation"),
// method rules: docs/pcf/phase0/method-note.md. Golden file:
// docs/pcf/phase0/pilot-golden.json (every expected value within ±0.5%).
//
// The whole input is stored as PcfResult.factor_snapshot; feeding it back
// through regenerateFromSnapshot() gives a byte-identical result.
// A PCF result is never a CBAM "specific embedded emissions" figure.

export const ENGINE_VERSION = "pcf-1.0.0";

export type PcfStage = "A1" | "A2" | "A3_packaging" | "A3_waste";
export type ResultStage = PcfStage | "A3_energy";
export const RESULT_STAGES: ResultStage[] = ["A1", "A2", "A3_energy", "A3_packaging", "A3_waste"];

export interface Dqr {
  technology: number;
  geography: number;
  time: number;
}

export interface EngineFactor {
  id: string;
  name: string;
  unit: string; // unit of the denominator: kg, t, tonne.km, kWh, unit...
  value_kgco2e: number;
  source?: string | null;
  licence?: string | null;
  gwp_set?: string | null;
}

export interface EngineInput {
  id: string;
  stage: PcfStage;
  name: string;
  // Per declared unit, losses included. A2 legs use payload_t instead.
  quantity: number;
  unit: string;
  factor_id?: string | null;
  recycled_factor_id?: string | null;
  recycled_share_pct?: number;
  // Supplier-specific kg CO2e per unit of `unit`; replaces the factors.
  supplier_pcf_kgco2e?: number | null;
  // A2 only: tonnes carried per declared unit, and the leg's distance.
  payload_t?: number | null;
  distance_km?: number | null;
  data_type: "primary" | "secondary";
  dqr: Dqr;
}

// One approved Scope 1 or 2 category total at the study's site and period.
export interface EngineEnergySource {
  id: string;
  category_id?: number | null;
  category_name: string;
  scope: number;
  period_total_tco2e: number;
}

export interface EngineAllocation {
  key_value_product: number;
  key_value_site_total: number;
  // Product output in the period expressed in declared units.
  product_output_units: number;
  dqr: Dqr;
}

export interface EngineStudy {
  cut_off_rule_pct: number;
  cut_off_max_total_pct: number;
}

export interface PcfEngineInput {
  study: EngineStudy;
  factors: EngineFactor[];
  inputs: EngineInput[];
  energy: EngineEnergySource[];
  allocation: EngineAllocation | null;
}

export interface PcfLine {
  id: string;
  stage: ResultStage;
  name: string;
  kgco2e_per_unit: number;
  data_type: "primary" | "secondary";
  cut_off_candidate: boolean;
  dqr: Dqr;
}

export interface PcfEngineResult {
  engine_version: string;
  total_kg_per_unit: number;
  fossil_kg_per_unit: number;
  biogenic_kg_per_unit: number;
  aircraft_kg_per_unit: number;
  luc_kg_per_unit: number;
  by_stage: Record<ResultStage, number>;
  by_input: Record<string, number>;
  lines: PcfLine[];
  allocation: { share_pct: number; product_output_units: number } | null;
  cut_off: { below_threshold_ids: string[]; below_threshold_total_pct: number; within_limit: boolean };
  primary_data_share_pct: number;
  dqr: Dqr & { overall: number };
}

export class PcfInputError extends Error {}

// Mass units convert; anything else must match the factor's unit exactly.
const MASS_TO_KG: Record<string, number> = { g: 0.001, kg: 1, t: 1000, tonne: 1000, tonnes: 1000 };

function toFactorUnit(qty: number, from: string, to: string, lineId: string): number {
  const f = from.trim().toLowerCase();
  const t = to.trim().toLowerCase();
  if (f === t) return qty;
  if (f in MASS_TO_KG && t in MASS_TO_KG) return (qty * MASS_TO_KG[f]) / MASS_TO_KG[t];
  throw new PcfInputError(`Line ${lineId}: unit "${from}" can't be converted to the factor's unit "${to}"`);
}

function checkDqr(d: Dqr, lineId: string) {
  for (const v of [d.technology, d.geography, d.time]) {
    if (!(v >= 1 && v <= 3)) throw new PcfInputError(`Line ${lineId}: DQR scores must be between 1 and 3`);
  }
}

function lineEmission(input: EngineInput, factors: Map<string, EngineFactor>): number {
  const need = (id: string | null | undefined, what: string) => {
    const f = id ? factors.get(id) : undefined;
    if (!f) throw new PcfInputError(`Line ${input.id}: ${what} factor ${id ?? "(none)"} not found`);
    return f;
  };

  if (input.stage === "A2") {
    if (input.payload_t == null || input.distance_km == null) {
      throw new PcfInputError(`Line ${input.id}: a transport leg needs payload_t and distance_km`);
    }
    const f = need(input.factor_id, "transport");
    if (f.unit.trim().toLowerCase() !== "tonne.km") {
      throw new PcfInputError(`Line ${input.id}: transport factor must be per tonne.km`);
    }
    return input.payload_t * input.distance_km * f.value_kgco2e;
  }

  if (input.supplier_pcf_kgco2e != null) return input.quantity * input.supplier_pcf_kgco2e;

  const virgin = need(input.factor_id, "material");
  const r = (input.recycled_share_pct ?? 0) / 100;
  if (r < 0 || r > 1) throw new PcfInputError(`Line ${input.id}: recycled share must be 0–100%`);
  const qty = toFactorUnit(input.quantity, input.unit, virgin.unit, input.id);
  if (r === 0) return qty * virgin.value_kgco2e;
  const recycled = need(input.recycled_factor_id, "recycled");
  const qtyR = toFactorUnit(input.quantity, input.unit, recycled.unit, input.id);
  // Cut-off: the recycled share carries only collection and reprocessing.
  return (1 - r) * qty * virgin.value_kgco2e + r * qtyR * recycled.value_kgco2e;
}

export function computePcf(data: PcfEngineInput): PcfEngineResult {
  const factors = new Map(data.factors.map((f) => [f.id, f]));
  const lines: PcfLine[] = [];

  for (const input of data.inputs) {
    checkDqr(input.dqr, input.id);
    lines.push({
      id: input.id,
      stage: input.stage,
      name: input.name,
      kgco2e_per_unit: lineEmission(input, factors),
      data_type: input.data_type,
      cut_off_candidate: true,
      dqr: input.dqr,
    });
  }

  let allocation: PcfEngineResult["allocation"] = null;
  if (data.energy.length) {
    const a = data.allocation;
    if (!a || !(a.key_value_site_total > 0) || !(a.product_output_units > 0)) {
      throw new PcfInputError("A3 energy needs an allocation key with a site total and product output above 0");
    }
    checkDqr(a.dqr, "allocation");
    const share = a.key_value_product / a.key_value_site_total;
    allocation = { share_pct: share * 100, product_output_units: a.product_output_units };
    for (const e of data.energy) {
      if (e.scope !== 1 && e.scope !== 2) throw new PcfInputError(`Energy source ${e.id}: only Scope 1 and 2 are allocated`);
      lines.push({
        id: e.id,
        stage: "A3_energy",
        name: e.category_name,
        kgco2e_per_unit: (e.period_total_tco2e * 1000 * share) / a.product_output_units,
        data_type: "primary", // measured and approved plant data (method note §2.12)
        cut_off_candidate: false, // never a cut-off candidate (method note §2.9)
        dqr: a.dqr,
      });
    }
  }

  const total = lines.reduce((s, l) => s + l.kgco2e_per_unit, 0);
  const by_stage = Object.fromEntries(RESULT_STAGES.map((s) => [s, 0])) as Record<ResultStage, number>;
  const by_input: Record<string, number> = {};
  for (const l of lines) {
    by_stage[l.stage] += l.kgco2e_per_unit;
    by_input[l.id] = l.kgco2e_per_unit;
  }

  const pct = (v: number) => (total === 0 ? 0 : (v / total) * 100);
  const below = lines.filter((l) => l.cut_off_candidate && pct(l.kgco2e_per_unit) < data.study.cut_off_rule_pct);
  const belowPct = pct(below.reduce((s, l) => s + l.kgco2e_per_unit, 0));
  const primary = pct(lines.filter((l) => l.data_type === "primary").reduce((s, l) => s + l.kgco2e_per_unit, 0));
  const weighted = (k: keyof Dqr) =>
    total === 0 ? 0 : lines.reduce((s, l) => s + l.kgco2e_per_unit * l.dqr[k], 0) / total;
  const dqr = { technology: weighted("technology"), geography: weighted("geography"), time: weighted("time") };

  return {
    engine_version: ENGINE_VERSION,
    total_kg_per_unit: total,
    // No biogenic, aircraft or land-use-change inputs are modelled yet, so the
    // whole total is fossil (method note §2.13).
    fossil_kg_per_unit: total,
    biogenic_kg_per_unit: 0,
    aircraft_kg_per_unit: 0,
    luc_kg_per_unit: 0,
    by_stage,
    by_input,
    lines,
    allocation,
    cut_off: {
      below_threshold_ids: below.map((l) => l.id),
      below_threshold_total_pct: belowPct,
      within_limit: belowPct < data.study.cut_off_max_total_pct,
    },
    primary_data_share_pct: primary,
    dqr: { ...dqr, overall: (dqr.technology + dqr.geography + dqr.time) / 3 },
  };
}

// JSON with sorted object keys, so equal values always serialise to equal bytes.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}

// What PcfResult.factor_snapshot stores: the full engine input plus the engine version.
export function makeSnapshot(data: PcfEngineInput): { engine_version: string; input: PcfEngineInput } {
  return JSON.parse(canonicalJson({ engine_version: ENGINE_VERSION, input: data }));
}

export function regenerateFromSnapshot(snapshot: { engine_version: string; input: PcfEngineInput }): PcfEngineResult {
  if (snapshot.engine_version !== ENGINE_VERSION) {
    throw new PcfInputError(
      `Snapshot was calculated with ${snapshot.engine_version}; this engine is ${ENGINE_VERSION}. Create a new version instead.`,
    );
  }
  return computePcf(snapshot.input);
}
