/**
 * IN-2 · GET /insights/target-wall → PanelResponse<TargetWall> (H, 01-contracts §3, I6).
 *
 * Items, progress normalised so 0 = the baseline and 100 = the target whichever way is good:
 *   sbti:near   the SBTi near-term target (sources/targets sbtiNearTerm: the Targets page's tables):
 *               baseline = the base year's boundary emissions, target = the target year's
 *               pathway figure, latest = the last year after the base with approved data
 *   sbti:long   the net-zero target (sbtiLongTerm, 90 % by 2050), the same way
 *   kpi:<id>    KPI targets (KPI tracking on and set up): KPI-9's progress_pct and the I6
 *               status from sources/targets kpiTargetStatuses
 * expected_pct = the I6 straight line at today; status = derive targetStatus (reached ≥ 100).
 * `pillar` in the query narrows the wall to that pillar (SBTi items are environment).
 * Sorted worst first (derive wallOrder).
 */
import type { TargetStatus } from "../contracts/enums";
import type { TargetWall, TargetWallItem } from "../contracts/panels";
import { expectedProgress, targetStatus, towardsTarget, wallOrder } from "../derive";
import { panelRoute, type PanelBuild } from "../panel";
import type { InsightsScope } from "../scope";
import { kpiTargetStatuses, sbtiLongTerm, sbtiNearTerm, sbtiSetup } from "../sources/targets";

const today = () => new Date().toISOString().slice(0, 10);

function sbtiItem(id: string, name: string, base: { year: number; value: number }, target: { year: number; value: number }, latest: { year: number; value: number } | null): TargetWallItem {
  const progress = latest ? towardsTarget(base.value, target.value, latest.value) : null;
  const expected = expectedProgress(base.year, target.year, today());
  const status: TargetStatus = targetStatus(progress, expected);
  return { id, source: "sbti", pillar: "environment", name, unit: "tCO2e", progress_pct: progress, expected_pct: expected, status, baseline: base, target, latest, direction_good: "down", link: "/targets" };
}

export async function buildTargetWall(scope: InsightsScope): Promise<PanelBuild<TargetWall>> {
  const items: TargetWallItem[] = [];
  const setup = await sbtiSetup(scope);
  if (setup) {
    const near = await sbtiNearTerm(scope);
    if (near) {
      const t1 = near.tables.table1;
      const after = near.tables.table3.filter((r) => r.year > setup.base_year && r.status !== "No Data");
      const latest = after.length ? { year: after[after.length - 1].year, value: after[after.length - 1].actualTotal } : null;
      items.push(sbtiItem("sbti:near", `Near-term SBTi target (${near.scope3TargetRequired ? "Scopes 1–3" : "Scopes 1 and 2"})`, { year: setup.base_year, value: near.targetBoundaryBase }, { year: setup.target_year, value: t1[t1.length - 1].targetEmission }, latest));
    }
    const long = await sbtiLongTerm(scope);
    if (long) {
      const after = long.actualVsTarget.filter((r) => r.year > setup.base_year && r.actualTotal !== null && r.status !== "No Data");
      const latest = after.length ? { year: after[after.length - 1].year, value: after[after.length - 1].actualTotal as number } : null;
      items.push(sbtiItem("sbti:long", "Net-zero target (90 % by 2050)", { year: long.baseYear, value: long.baseEmissions }, { year: long.targetYear, value: long.targetEmissions }, latest));
    }
  }
  for (const k of await kpiTargetStatuses(scope)) {
    const t = k.target;
    const name = t.site_name ? `${t.kpi_name} · ${t.site_name}` : String(t.kpi_name ?? t.kpi_code);
    items.push({
      id: `kpi:${t.id}`,
      source: "kpi",
      pillar: (t.pillar ?? "environment") as TargetWallItem["pillar"],
      name,
      unit: t.unit ?? "",
      progress_pct: k.progress,
      expected_pct: k.expected,
      status: k.status,
      baseline: { year: t.baseline_year, value: t.baseline_value },
      target: { year: t.target_year, value: t.target_value },
      latest: t.progress.current_year === null || t.progress.current_value === null ? null : { year: t.progress.current_year, value: t.progress.current_value },
      direction_good: t.direction === "increase" ? "up" : "down",
      link: `/kpi/targets?kpi=${t.kpi_definition_id}`,
    });
  }
  const pillar = scope.query.pillar;
  const shown = (pillar ? items.filter((i) => i.pillar === pillar) : items).sort(wallOrder);
  return { data: { items: shown }, links: Object.fromEntries(shown.map((i) => [i.id, i.link])) };
}

export const targetWallPanel = panelRoute<TargetWall>("target_wall", buildTargetWall);
