/**
 * IN-6 · GET /insights/flow → PanelResponse<Flow> (01-contracts §3, I9): how approved
 * entries flow into framework disclosures.
 *
 *   KPI tracking on and set up:  sites → Scope 1/2/3 → GHG KPIs (tCO₂e) → disclosures (count,
 *                                one per mapping row of the enabled frameworks, with its fit);
 *                                energy / intensity KPIs fed by auto or formula sources are
 *                                column-2 nodes with count links only.
 *   KPI tracking off (or not set up):  sites → scopes → the top 6 categories (tCO₂e), no column 3.
 *   no_data when the sites have no approved emission in the period.
 * links: every node id → its drill-down route.
 */
import { Router } from "express";
import type { Flow } from "../contracts/panels";
import { flowGraph } from "../derive/flow";
import { panelRoute, type PanelBuild } from "../panel";
import { overviewKey, type InsightsScope } from "../scope";
import { byCategory } from "../sources/emissions";
import { flowKpis, flowMappings, scopesBySite } from "../sources/flow";
import { kpiSetupDone } from "../sources/kpi";

export const TOP_CATEGORIES = 6;
const SCOPE_NO: Record<string, 1 | 2 | 3> = { "Scope 1": 1, "Scope 2": 2, "Scope 3": 3 };

export async function buildFlow(scope: InsightsScope): Promise<PanelBuild<Flow>> {
  const sites = await scopesBySite(scope);
  if (!sites.some((s) => s.scope_1 + s.scope_2 + s.scope_3 > 0)) {
    return { availability: "no_data", reason: "Approved emissions for this period are needed to draw the flow. Add or approve entries for these sites." };
  }
  const year = scope.period.year;
  let flow: Flow;
  if (scope.kpiOn && (await kpiSetupDone(scope))) {
    const kpis = await flowKpis(scope);
    const mappings = await flowMappings(scope, kpis.map((k) => k.id));
    flow = flowGraph({ sites, kpis, mappings });
  } else {
    const categories = (await byCategory(scope))
      .filter((c) => SCOPE_NO[c.scope])
      .slice(0, TOP_CATEGORIES)
      .map((c) => ({ category_id: Number(c.category_id), name: String(c.category_name), scope: SCOPE_NO[c.scope], total: c.total }));
    flow = flowGraph({ sites, categories });
  }
  const period = encodeURIComponent(overviewKey(scope.period));
  const links: Record<string, string> = {};
  for (const n of flow.nodes) {
    const [kind, a, b] = n.id.split(":");
    if (kind === "site") links[n.id] = `/data/emissions?siteIds=${a}&period=${period}`;
    else if (kind === "scope") links[n.id] = `/overview?period=${period}`;
    else if (kind === "cat") links[n.id] = `/data/emissions?categoryIds=${a}&period=${period}`;
    else if (kind === "kpi") links[n.id] = `/kpi/esg?year=${year}&kpi=${encodeURIComponent(a)}`;
    else if (kind === "disc") links[n.id] = `/kpi/reports/${a}?year=${year}#${encodeURIComponent(b)}`;
  }
  return { data: flow, links };
}

export const flowPanel = panelRoute<Flow>("flow", buildFlow);

const router = Router();
router.get("/flow", flowPanel);
export default router;
