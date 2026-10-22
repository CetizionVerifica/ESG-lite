/**
 * IN-11 · the Sites tab's figures (pure, unit tested in ci/unit/in-11-sites.test.cjs).
 *
 *   siteCompletenessPct(cells, thisMonth)  Σ approved ÷ Σ expected (emissions + KPI) over the
 *                                          completeness cells of months up to `thisMonth`
 *                                          ('YYYY-MM'); null with nothing expected or no month
 *                                          started (the Completeness tab's cell rule, summed)
 *   siteOrder(a, b)                        net descending, then site id
 */
import { completenessPct } from "./pathway";

export interface CompletenessCounts {
  month: string;
  emissions_expected: number;
  emissions_approved: number;
  kpi_expected: number;
  kpi_approved: number;
}

export function siteCompletenessPct(cells: CompletenessCounts[], thisMonth: string): number | null {
  const started = cells.filter((c) => c.month <= thisMonth);
  if (!started.length) return null;
  const sum = started.reduce(
    (a, c) => ({
      emissions_expected: a.emissions_expected + c.emissions_expected,
      emissions_approved: a.emissions_approved + c.emissions_approved,
      kpi_expected: a.kpi_expected + c.kpi_expected,
      kpi_approved: a.kpi_approved + c.kpi_approved,
    }),
    { emissions_expected: 0, emissions_approved: 0, kpi_expected: 0, kpi_approved: 0 },
  );
  return completenessPct(sum, false);
}

export const siteOrder = (a: { net: number; site_id: number }, b: { net: number; site_id: number }): number => b.net - a.net || a.site_id - b.site_id;
