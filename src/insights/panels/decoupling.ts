/**
 * IN-2 · GET /insights/decoupling?years=5 → PanelResponse<Decoupling> (B, 01-contracts §3, I7).
 *
 *   years      the last N reporting years up to the period's year (default 5, 2–10)
 *   base_year  the SBTi base year (sources/targets) when it is one of those years and has both
 *              approved emissions and production; else the first year that has both
 *   output     each site's approved production indexed to the base year in its own unit, then
 *              averaged by the sites' base-year emissions (derive combinedOutputIndex); `raw` is
 *              the sum only when every site uses one unit (else null); combined_output when the
 *              units differ or a site in scope had no production in the base year
 *   emissions  approved net tCO₂e per year as Overview (sources/emissions netByYear), indexed
 *   intensity  the summary's intensity per year (Σ scoped emissions ÷ Σ production, derive
 *              combinedIntensity), indexed
 *   decoupled  output index > 100 and emissions index < 100 in the last year
 *   headline   last value of each index − 100 (percent change on the base year)
 *   no_data    fewer than 2 years with both approved emissions and production
 */
import type { Decoupling } from "../contracts/panels";
import { DecouplingQuerySchema, type DecouplingQuery } from "../contracts/schemas";
import { combinedIntensity, combinedOutputIndex, indexSeries, lastValue } from "../derive";
import { panelRoute, type PanelBuild } from "../panel";
import { overviewKey, type InsightsScope } from "../scope";
import { netByYear } from "../sources/emissions";
import { outputBySiteYear } from "../sources/production";
import { sbtiSetup } from "../sources/targets";

export const NO_DATA_REASON = "Add approved emissions and production data for at least two years to see decoupling. Add production →";

export async function buildDecoupling(scope: InsightsScope<DecouplingQuery>): Promise<PanelBuild<Decoupling>> {
  const n = scope.query.years;
  const last = scope.period.year;
  const years = Array.from({ length: n }, (_, i) => last - n + 1 + i);
  const [net, output, setup] = await Promise.all([netByYear(scope, years), outputBySiteYear(scope, years), sbtiSetup(scope)]);
  const production = output.map((y) => y.sites.reduce((a, s) => a + s.production, 0));
  const both = years.map((_, i) => net[i] !== null && production[i] > 0);
  if (both.filter(Boolean).length < 2) return { availability: "no_data", reason: NO_DATA_REASON, links: { production: "/production" } };
  const sbtiIdx = setup ? years.indexOf(setup.base_year) : -1;
  const baseIdx = sbtiIdx >= 0 && both[sbtiIdx] ? sbtiIdx : both.indexOf(true);

  const siteIds = scope.siteIds;
  const perSite = siteIds.map((id) => output.map((y) => {
    const s = y.sites.find((x) => x.site_id === id);
    return s && s.production > 0 ? s.production : null;
  }));
  const weights = siteIds.map((id, k) => (perSite[k][baseIdx] === null ? 0 : (output[baseIdx].sites.find((x) => x.site_id === id)?.emissions ?? 0)));
  const outputIndex = combinedOutputIndex(perSite, weights, baseIdx);
  const units = [...new Set(output.flatMap((y) => y.sites.flatMap((s) => s.units)))].sort();
  const combined_output = units.length > 1 || perSite.some((s) => s[baseIdx] === null);
  const outputRaw = units.length === 1 ? production.map((p) => (p > 0 ? p : null)) : years.map(() => null);

  const intensity = output.map((y) => combinedIntensity(y.sites).value);
  const iUnit = units.length === 1 ? `tCO2e/${units[0]}` : "tCO2e per unit of output";
  const emissionsIndex = indexSeries(net, baseIdx);
  const intensityIndex = indexSeries(intensity, baseIdx);
  const lastOut = lastValue(outputIndex);
  const lastEm = lastValue(emissionsIndex);
  const lastInt = lastValue(intensityIndex);
  const data: Decoupling = {
    base_year: years[baseIdx],
    years,
    series: [
      { key: "output", label: combined_output ? "Combined output index" : "Output", index: outputIndex, raw: outputRaw, unit: units.length === 1 ? units[0] : "index" },
      { key: "emissions", label: "Emissions", index: emissionsIndex, raw: net, unit: "tCO2e" },
      { key: "intensity", label: "Intensity", index: intensityIndex, raw: intensity, unit: iUnit },
    ],
    combined_output,
    decoupled: lastOut !== null && lastEm !== null && lastOut > 100 && lastEm < 100,
    headline: {
      output_change_pct: lastOut === null ? 0 : lastOut - 100,
      emissions_change_pct: lastEm === null ? 0 : lastEm - 100,
      intensity_change_pct: lastInt === null ? 0 : lastInt - 100,
    },
  };
  return { data, links: { output: "/production", emissions: `/overview?period=${encodeURIComponent(overviewKey(scope.period))}`, intensity: "/production" } };
}

export const decouplingPanel = panelRoute<Decoupling, DecouplingQuery>("decoupling", buildDecoupling, { schema: DecouplingQuerySchema, extras: (q) => ({ years: q.years }) });
