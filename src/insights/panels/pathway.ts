/**
 * IN-4 · GET /insights/pathway → PanelResponse<Pathway> (01-contracts §3, story panel C).
 *
 *   base_year … target_year   the SBTi set-up (sources/targets sbtiSetup: the company base year,
 *                             near-term 2030 kept 5–10 years out, 4.2 %/yr)
 *   pathway                   POST /user/targets/tables table1 `targetEmission` per year
 *   actual.s1/s2/s3           table3 actual Scope 1 / 2 / 3 per year (null for a year without data;
 *                             s3 only when Scope 3 is in the boundary, ≥ 40 % of the base year)
 *   levers                    renewable_share (% of electricity kWh, sources/energy) and, when
 *                             every site's production shares one unit, energy_intensity (kWh per unit)
 *   gap_band                  max(0, actual − pathway) for each year with an actual (derive/pathway)
 *   events                    Insights events from base year to target year
 * SBTi years are calendar years, as on the Targets page, whatever the period's year type.
 * no_data: no base year ("Set a base year in Targets"), or no approved emissions in it.
 */
import { Router } from "express";
import type { Pathway } from "../contracts/panels";
import { energyIntensities, gapBand, renewableShares } from "../derive/pathway";
import { eventsInRange } from "../events/crud";
import { panelRoute, type PanelBuild } from "../panel";
import type { InsightsScope } from "../scope";
import { electricityByYear } from "../sources/energy";
import { outputBySiteYear } from "../sources/production";
import { sbtiNearTerm, sbtiSetup } from "../sources/targets";

export const NO_BASE_YEAR = "Set a base year in Targets to see your pathway.";

export async function buildPathway(scope: InsightsScope): Promise<PanelBuild<Pathway>> {
  const setup = await sbtiSetup(scope);
  if (!setup) return { availability: "no_data", reason: NO_BASE_YEAR, links: { setup: "/targets" } };
  const near = await sbtiNearTerm(scope);
  if (!near) return { availability: "no_data", reason: `Add approved emissions for ${setup.base_year}, your base year, to see your pathway.`, links: { setup: "/data/entries" } };

  const years = near.tables.table1.map((r) => r.year);
  const t3 = new Map(near.tables.table3.map((r) => [r.year, r]));
  const has = (y: number) => {
    const r = t3.get(y);
    return !!r && (r.status !== "No Data" || y === near.baseYear);
  };
  const actual = {
    s1: years.map((y) => (has(y) ? t3.get(y)!.actualScope1 : null)),
    s2: years.map((y) => (has(y) ? t3.get(y)!.actualScope2 : null)),
    s3: years.map((y) => (has(y) && near.scope3TargetRequired ? t3.get(y)!.actualScope3 : null)),
  };
  const pathway = near.tables.table1.map((r) => r.targetEmission);

  // Levers, on calendar years.
  const cy: InsightsScope = { ...scope, period: { year: scope.period.year, yearType: "CY" } };
  const elec = await electricityByYear(cy, years);
  const levers: Pathway["levers"] = [{ key: "renewable_share", label: "Renewable electricity", unit: "%", values: renewableShares(elec) }];
  const output = await outputBySiteYear(cy, years);
  const units = [...new Set(output.flatMap((y) => y.sites.flatMap((s) => s.units)))];
  if (units.length === 1) {
    const q = output.map((y) => {
      const total = y.sites.reduce((a, s) => a + s.production, 0);
      return total > 0 ? total : null;
    });
    levers.push({ key: "energy_intensity", label: "Electricity per unit of output", unit: `kWh per ${units[0]}`, values: energyIntensities(elec.map((e) => (e ? e.total_kwh : null)), q) });
  }

  const data: Pathway = {
    base_year: near.baseYear,
    target_year: near.targetYear,
    annual_rate_pct: near.annualRate * 100,
    years,
    pathway,
    actual,
    levers,
    gap_band: gapBand(years.map((y) => ({ year: y, actual: has(y) ? t3.get(y)!.actualTotal : null, pathway: t3.get(y)?.targetTotal ?? null }))),
    events: await eventsInRange(scope, `${near.baseYear}-01-01`, `${near.targetYear}-12-31`),
  };
  const links: Record<string, string> = { targets: `/targets?baseYear=${near.baseYear}&targetYear=${near.targetYear}` };
  for (const y of years) links[`year:${y}`] = `/overview?period=${y}`;
  return { data, links };
}

export const pathwayPanel = panelRoute<Pathway>("pathway", buildPathway);

const router = Router();
router.get("/pathway", pathwayPanel);
export default router;
