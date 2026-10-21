/**
 * IN-4 · derive (layer rule 4) for the pathway and completeness panels. Pure.
 *
 *   gapBand(rows)                 per year with an actual: max(0, actual − pathway)
 *   renewableShares(years)        renewable kWh ÷ electricity kWh × 100 per year; null without data
 *   energyIntensities(kwh, output) kWh per output unit per year; null without either
 *   completenessPct(cell, future) (approved emissions + KPI) ÷ (expected) × 100; null for a future
 *                                 month or when nothing is expected
 */
import { share } from "./index";

export function gapBand(rows: Array<{ year: number; actual: number | null; pathway: number | null }>): Array<{ year: number; gap: number }> {
  return rows.filter((r) => r.actual !== null && r.pathway !== null).map((r) => ({ year: r.year, gap: Math.max(0, (r.actual as number) - (r.pathway as number)) }));
}

export const renewableShares = (rows: Array<{ total_kwh: number; renewable_kwh: number } | null>): Array<number | null> =>
  rows.map((r) => (r ? share(r.renewable_kwh, r.total_kwh) : null));

export function energyIntensities(kwh: Array<number | null>, output: Array<number | null>): Array<number | null> {
  return kwh.map((k, i) => {
    const q = output[i];
    return k === null || q === null || q === undefined || !(q > 0) ? null : k / q;
  });
}

export function completenessPct(c: { emissions_expected: number; emissions_approved: number; kpi_expected: number; kpi_approved: number }, future: boolean): number | null {
  if (future) return null;
  const expected = c.emissions_expected + c.kpi_expected;
  return expected > 0 ? ((c.emissions_approved + c.kpi_approved) / expected) * 100 : null;
}
