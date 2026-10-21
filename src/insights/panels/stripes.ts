/**
 * IN-8 · GET /insights/stripes → PanelResponse<Stripes> (01-contracts §3, 05-ux §4 "Stripes").
 *
 *   months   up to STRIPES_MONTHS_MAX (72) months ending at the period end: the six reporting
 *            years up to the period's year in its year type (CY or FY), from Overview's by_month
 *            (sources/emissions `monthly`), starting at the first month with a value
 *   values   the month's approved net tCO₂e; null for a month with no approved monthly entry
 *            (yearly batches are left out, as Overview's by_month leaves them out)
 *   min/max  over the values (derive/stripes.ts)
 *   no_data  fewer than 12 months with a value (the FE hides the band)
 */
import { Router } from "express";
import { STRIPES_MONTHS_MAX } from "../contracts/enums";
import type { Stripes } from "../contracts/panels";
import { stripesSeries, type MonthNet } from "../derive/stripes";
import { panelRoute, type PanelBuild } from "../panel";
import { periodMonths, type InsightsScope } from "../scope";
import { monthly } from "../sources/emissions";

export const STRIPES_MIN_MONTHS = 12;
export const NO_STRIPES_REASON = "Add at least twelve months of approved monthly entries to see the emission stripes.";

export async function buildStripes(scope: InsightsScope): Promise<PanelBuild<Stripes>> {
  const years = STRIPES_MONTHS_MAX / 12;
  const months: string[] = [];
  const byMonth = new Map<string, MonthNet>();
  for (let y = scope.period.year - years + 1; y <= scope.period.year; y++) {
    const period = { year: y, yearType: scope.period.yearType };
    months.push(...periodMonths(period));
    for (const b of await monthly(scope, period)) byMonth.set(b.month, b);
  }
  const s = stripesSeries(months, byMonth, STRIPES_MONTHS_MAX);
  if (s.count < STRIPES_MIN_MONTHS) return { availability: "no_data", reason: NO_STRIPES_REASON };
  return { data: { months: s.months, values: s.values, unit: "tCO2e", min: s.min, max: s.max }, links: { band: "/overview" } };
}

export const stripesPanel = panelRoute<Stripes>("stripes", buildStripes);
