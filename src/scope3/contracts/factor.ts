/**
 * Factor metadata vocabulary (docs/scope3/01-contracts.md §2).
 *
 * S3-0 owns this folder. S3-2 wrote this file from §2 because it needs it
 * before S3-0 merges; if S3-0 lands its own factor.ts, theirs wins and S3-2
 * imports from it.
 */
export const FACTOR_TYPES = [
  "combustion",
  "wtt",
  "td_loss",
  "life_cycle",
  "cradle_to_gate",
  "eeio_spend",
  "supplier",
  "process",
  "other",
] as const;
export type FactorType = (typeof FACTOR_TYPES)[number];

export const GWP_SETS = ["AR4", "AR5", "AR6"] as const;
export type GwpSet = (typeof GWP_SETS)[number];
/** D7: new factors default to AR6. */
export const DEFAULT_GWP_SET: GwpSet = "AR6";

export const GASES = ["CO2", "CH4", "N2O", "HFCs", "PFCs", "SF6", "NF3"] as const;
export type Gas = (typeof GASES)[number];

/** Gas parts a factor may carry, in kg per denominator unit (other_kgco2e in kgCO₂e). */
export const GAS_PART_FIELDS = ["co2_kg", "ch4_kg", "n2o_kg", "other_kgco2e"] as const;
export type GasPartField = (typeof GAS_PART_FIELDS)[number];

/**
 * Factor types allowed per GHG Protocol Scope 3 category. Checked at save as
 * the warning FACTOR_TYPE_MISMATCH, never blocking. Categories not listed
 * accept any type.
 */
export const ALLOWED_FACTOR_TYPES: Partial<Record<number, readonly FactorType[]>> = {
  1: ["cradle_to_gate", "eeio_spend", "supplier"],
  2: ["cradle_to_gate", "eeio_spend", "supplier"],
  3: ["wtt", "td_loss"],
  4: ["life_cycle", "combustion", "eeio_spend"],
  5: ["process", "life_cycle"],
  6: ["life_cycle", "combustion", "eeio_spend"],
  7: ["life_cycle", "combustion", "eeio_spend"],
  9: ["life_cycle", "combustion", "eeio_spend"],
  11: ["combustion", "other"],
  12: ["process", "life_cycle"],
};

export const isFactorType = (v: unknown): v is FactorType => typeof v === "string" && (FACTOR_TYPES as readonly string[]).includes(v);
export const isGwpSet = (v: unknown): v is GwpSet => typeof v === "string" && (GWP_SETS as readonly string[]).includes(v);
