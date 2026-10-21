/**
 * IN-2 · GET /insights/esg-ring → PanelResponse<EsgRing> (A, 01-contracts §3). KPI panel.
 *
 * Pillars and topics are /kpi/esg's (sources/kpi `esg`, approved values only): KPI counts and
 * states by KPI-10's rule. coverage_pct = approved ÷ (approved + pending + missing) × 100
 * unrounded (/kpi/esg shows the same share rounded); a pillar or topic with nothing counted
 * yet (everything not due) is 0. pct = the same share over every pillar.
 * auto_share = selected auto KPIs of the topic with an approved value this year ÷ the topic's
 * KPIs × 100 (sources/kpiAuto).
 *   kpi_off           KPI tracking off (panel.ts)
 *   setup_incomplete  KPI setup not finished
 */
import type { EsgRing } from "../contracts/panels";
import { readinessOf, share } from "../derive";
import { panelRoute, type PanelBuild } from "../panel";
import type { InsightsScope } from "../scope";
import { esg } from "../sources/kpi";
import { autoFilledByTopic } from "../sources/kpiAuto";

const pctOf = (c: { approved: number; pending: number; missing: number }) => share(c.approved, c.approved + c.pending + c.missing) ?? 0;

export async function buildEsgRing(scope: InsightsScope): Promise<PanelBuild<EsgRing>> {
  const e = await esg(scope);
  if (!e) return { availability: "setup_incomplete", reason: "Finish KPI setup to see how complete your ESG data is." };
  const auto = await autoFilledByTopic(scope);
  const year = scope.period.year;
  const links: Record<string, string> = { centre: `/kpi/esg?year=${year}` };
  const pillars: EsgRing["pillars"] = e.pillars.map((p) => {
    links[`pillar:${p.pillar}`] = `/kpi/esg?year=${year}&pillar=${p.pillar}`;
    return {
      pillar: p.pillar,
      label: p.label,
      kpis: p.kpis,
      approved: p.approved,
      coverage_pct: pctOf(p),
      topics: p.topics.map((t) => {
        links[`topic:${t.topic}`] = `/kpi/esg?year=${year}&topic=${t.topic}`;
        return { topic: t.topic, label: t.label, kpis: t.kpis, approved: t.approved, coverage_pct: pctOf(t), auto_share: share(auto.get(t.topic) ?? 0, t.kpis) ?? 0 };
      }),
    };
  });
  return { data: { pct: readinessOf(e.pillars)?.pct ?? 0, pillars }, links };
}

export const esgRingPanel = panelRoute<EsgRing>("esg_ring", buildEsgRing, { kpi: true });
