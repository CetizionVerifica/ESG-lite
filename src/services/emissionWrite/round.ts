/**
 * #209 · how a tCO₂e total is rounded when it is stored: 3 decimals, for every
 * method. The FE preview (ESG-lite_FE src/lib/emissions/emissionCalc.ts)
 * mirrors this so the figure on screen is the figure saved. kgCO₂e stays at 4.
 */

/** Decimal places of every stored tCO₂e total. */
export const TONNES_DP = 3;

/** A tCO₂e figure rounded as every total is stored (half away from zero for positives). */
export const roundTonnes = (t: number): number => Math.round(t * 1000) / 1000;
