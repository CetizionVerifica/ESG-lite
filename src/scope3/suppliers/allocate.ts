/**
 * S3-6 · Allocating a facility's Scope 1 and 2 to part of what it made.
 *
 * Extracted from the PCF engine (src/pcf/engine/computePcf.ts, A3 energy),
 * which now calls these, so a product footprint and a hybrid Cat 1 row share
 * one allocation rule (Scope 3 Standard ch. 8; guidance formulas [1.2] and
 * [1.3]). The arithmetic is exactly what PCF did, in the same order, so no
 * PCF result moves (ci/unit/pcf-engine.test.cjs and the pilot golden).
 *
 * Pure: no database, no clock.
 */

/** How the share is measured: by mass (or another physical unit) or by value. */
export type AllocationKey = "mass" | "economic";
export const ALLOCATION_KEYS: readonly AllocationKey[] = ["mass", "economic"];

/**
 * The share of the whole that the part stands for: the product's key value
 * over the site's (PCF), or what we bought over what the facility made
 * (hybrid). The caller checks that `whole` is above 0.
 */
export const allocationShare = (part: number, whole: number): number => part / whole;

/** kgCO₂e of a tCO₂e total allocated by `share`. */
export const allocatedKg = (totalTco2e: number, share: number): number => totalTco2e * 1000 * share;
