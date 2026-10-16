/**
 * Scope 3 contracts (S3-0) §2: emission factor metadata enums and the
 * allowed factor types per category. Copied from docs/scope3/01-contracts.md
 * §2, with the §10 additions (Cat 4/9 also allow `other`).
 *
 * The allowed-types check runs at save and only warns
 * (`FACTOR_TYPE_MISMATCH`); it never blocks.
 */
import { z } from "zod";
import type { GhgCategoryNumber } from "./ghgCategory";

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
export const FactorTypeSchema = z.enum(FACTOR_TYPES);
export type FactorType = z.infer<typeof FactorTypeSchema>;

export const GWP_SETS = ["AR4", "AR5", "AR6"] as const;
export const GwpSetSchema = z.enum(GWP_SETS);
export type GwpSet = z.infer<typeof GwpSetSchema>;
/** D7: new factors use AR6. */
export const DEFAULT_GWP_SET: GwpSet = "AR6";

export const GASES = ["CO2", "CH4", "N2O", "HFCs", "PFCs", "SF6", "NF3"] as const;
export const GasSchema = z.enum(GASES);
export type Gas = z.infer<typeof GasSchema>;

/**
 * Factor types each category accepts (§2, §10). Cats 8, 10, 13, 14 and 15
 * were added by S3-0 (#144) from what their forms use (S3-10, S3-11);
 * `other` covers reported partner emissions (D13) and refrigerant GWP.
 */
export const ALLOWED_FACTOR_TYPES: Partial<Record<GhgCategoryNumber, readonly FactorType[]>> = {
  1: ["cradle_to_gate", "eeio_spend", "supplier"],
  2: ["cradle_to_gate", "eeio_spend", "supplier"],
  3: ["wtt", "td_loss"],
  4: ["life_cycle", "combustion", "eeio_spend", "other"],
  5: ["process", "life_cycle"],
  6: ["life_cycle", "combustion", "eeio_spend"],
  7: ["life_cycle", "combustion", "eeio_spend"],
  8: ["life_cycle", "combustion", "other"],
  9: ["life_cycle", "combustion", "eeio_spend", "other"],
  10: ["process", "combustion", "life_cycle"],
  11: ["combustion", "other"],
  12: ["process", "life_cycle"],
  13: ["life_cycle", "combustion", "other"],
  14: ["life_cycle", "combustion", "other"],
  15: ["eeio_spend", "other"],
};

/**
 * Whether a factor type suits a category. True when the category has no list,
 * so an unlisted category never produces a `FACTOR_TYPE_MISMATCH` warning.
 */
export const factorTypeAllowed = (n: number, type: FactorType): boolean => {
  const allowed = ALLOWED_FACTOR_TYPES[n as GhgCategoryNumber];
  return !allowed || allowed.includes(type);
};

// S3-2 additions (factor upload and snapshot).
/** Gas parts a factor may carry, in kg per denominator unit (other_kgco2e in kgCO₂e). */
export const GAS_PART_FIELDS = ["co2_kg", "ch4_kg", "n2o_kg", "other_kgco2e"] as const;
export type GasPartField = (typeof GAS_PART_FIELDS)[number];

export const isFactorType = (v: unknown): v is FactorType => typeof v === "string" && (FACTOR_TYPES as readonly string[]).includes(v);
export const isGwpSet = (v: unknown): v is GwpSet => typeof v === "string" && (GWP_SETS as readonly string[]).includes(v);
