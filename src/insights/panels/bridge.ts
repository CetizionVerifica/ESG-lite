/**
 * IN-5 · GET /insights/bridge?compare=prior|base → PanelResponse<Bridge> (D, 01-contracts §3, I8).
 *
 *   from / to   approved net tCO₂e of the compared year and the period year (Overview's figures,
 *               sources/emissions)
 *               compare=prior: the year before; compare=base: the SBTi base year when it is
 *               earlier than the period year, else the first year with an approved row
 *   steps       derive/lmdi.ts `bridgeSteps`: additive LMDI over Scope 1 = Q × I₁ and Scope 2 =
 *               Q × kWh/Q × tCO₂e/kWh, Scope 3 as one block, Other for savings and any scope that
 *               lacks inputs; Σ steps = to − from exactly
 *   Q           approved production (sources/production): the sum when every site uses one unit,
 *               else a combined output index (from = 100; sites indexed in their own unit and
 *               weighted by their first-year emissions, I7 / derive combinedOutputIndex)
 *   kWh         approved electricity (sources/energy: Scope 2 + renewable rows)
 *   notes       why a step is missing or folded, substitutions, and the events between the years
 *   no_data     either year has no approved entry, or there is no earlier year to compare with
 */
import { Router } from "express";
import type { Bridge } from "../contracts/panels";
import { combinedOutputIndex, share } from "../derive";
import { bridgeSteps, type BridgeYear } from "../derive/lmdi";
import { eventsInRange } from "../events/crud";
import { panelRoute, type PanelBuild } from "../panel";
import { overviewKey, periodRange, type InsightsScope } from "../scope";
import { firstApprovedYear } from "../sources/bridge";
import { overview } from "../sources/emissions";
import { electricityByYear } from "../sources/energy";
import { outputBySiteYear } from "../sources/production";
import { sbtiSetup } from "../sources/targets";

export const NO_EMISSIONS_REASON = "Add approved emissions for both years to see what moved them.";
export const NO_EARLIER_REASON = "There is no earlier year with approved emissions to compare with.";
const MAX_EVENTS_IN_NOTES = 3;

async function compareYear(scope: InsightsScope): Promise<number | null> {
  const year = scope.period.year;
  if (scope.query.compare === "prior") return year - 1;
  const setup = await sbtiSetup(scope);
  if (setup && setup.base_year < year) return setup.base_year;
  const first = await firstApprovedYear(scope);
  return first !== null && first < year ? first : null;
}

export async function buildBridge(scope: InsightsScope): Promise<PanelBuild<Bridge>> {
  const y0 = await compareYear(scope);
  if (y0 === null) return { availability: "no_data", reason: NO_EARLIER_REASON };
  const yT = scope.period.year;
  const yt = scope.period.yearType;
  const [o0, oT] = await Promise.all([overview(scope, { year: y0, yearType: yt }), overview(scope, { year: yT, yearType: yt })]);
  if (!o0.kpis.approved_count || !oT.kpis.approved_count) return { availability: "no_data", reason: NO_EMISSIONS_REASON, links: { emissions: "/data/entries" } };

  const [output, elec] = await Promise.all([outputBySiteYear(scope, [y0, yT]), electricityByYear(scope, [y0, yT])]);
  const units = [...new Set(output.flatMap((y) => y.sites.flatMap((s) => s.units)))].sort();
  let q: [number | null, number | null];
  let outputIndex = false;
  if (units.length <= 1) {
    q = output.map((y) => {
      const t = y.sites.reduce((a, s) => a + s.production, 0);
      return t > 0 ? t : null;
    }) as [number | null, number | null];
  } else {
    outputIndex = true;
    const perSite = scope.siteIds.map((id) => output.map((y) => {
      const s = y.sites.find((x) => x.site_id === id);
      return s && s.production > 0 ? s.production : null;
    }));
    const weights = scope.siteIds.map((id, k) => (perSite[k][0] === null ? 0 : (output[0].sites.find((x) => x.site_id === id)?.emissions ?? 0)));
    const idx = combinedOutputIndex(perSite, weights, 0);
    q = [idx[0] ?? null, idx[1] ?? null];
  }
  const year = (o: typeof o0, y: number, i: 0 | 1): BridgeYear => ({
    year: y,
    net: o.kpis.net,
    s1: o.kpis.scope_1,
    s2: o.kpis.scope_2,
    s3: o.kpis.scope_3,
    saved: o.kpis.saved,
    q: q[i],
    kwh: elec[i]?.total_kwh ?? null,
    renewable_pct: elec[i] ? share(elec[i]!.renewable_kwh, elec[i]!.total_kwh) : null,
  });
  const { steps, notes } = bridgeSteps(year(o0, y0, 0), year(oT, yT, 1), { unit: units.length === 1 ? units[0] : null, outputIndex });

  const events = await eventsInRange(scope, periodRange({ year: y0, yearType: yt }).start, periodRange({ year: yT, yearType: yt }).end);
  if (events.length) {
    const shown = events.slice(0, MAX_EVENTS_IN_NOTES).map((e) => `${e.label} (${e.date})`);
    notes.push(`Events in this time: ${shown.join("; ")}${events.length > MAX_EVENTS_IN_NOTES ? ` and ${events.length - MAX_EVENTS_IN_NOTES} more` : ""}.`);
  }
  const data: Bridge = { from: { year: y0, value: o0.kpis.net }, to: { year: yT, value: oT.kpis.net }, steps, method: "lmdi_additive", notes };
  return {
    data,
    links: {
      from: `/overview?period=${encodeURIComponent(overviewKey({ year: y0, yearType: yt }))}`,
      to: `/overview?period=${encodeURIComponent(overviewKey({ year: yT, yearType: yt }))}`,
      activity: "/production",
      scope3: "/overview#categories",
    },
  };
}

export const bridgePanel = panelRoute<Bridge>("bridge", buildBridge);

const router = Router();
router.get("/bridge", bridgePanel);
export default router;
