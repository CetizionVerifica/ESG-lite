/**
 * IN-7 · GET /insights/materiality → PanelResponse<Materiality> (01-contracts §3, I10). KPI panel.
 *
 *   points      one per material topic (company_material_topic.material = true), ESRS order;
 *               `?pillar=` keeps E*, S* or G* topics
 *   impact / financial   the DS-2 scores (0–10; null when not scored)
 *   kpis        the company's selected, active KPIs mapped (kpi_disclosure_map) to a disclosure whose
 *               `esrs_topic` is the topic — the same topic link the KPI-11 ESRS list and KPI-3's
 *               materiality recommendations use
 *   status      the worst status of those KPIs' targets (I6, sources/targets kpiTargetStatuses);
 *               no_data without targets
 *   on_track / off_track   KPIs whose own (worst) target status is on_track or reached / off_track
 *   weight      derive/materiality: 1 + 9 × share ÷ 100, share = 100 % for E1 when the period has
 *               approved tCO₂e, else the topic's share of the material topics' KPIs
 *   scored      false when any material topic lacks either score (the FE lists topics instead)
 * Availability: kpi_off while KPI tracking is off; setup_incomplete before KPI setup or with no
 * material topic. Links: `<topic>` → /kpi/esg?topic=<esrs topic>, `scores` → KPI setup's step.
 */
import { Router } from "express";
import { AppDataSource } from "../../config/data-source";
import { ESRS_TOPIC_LABELS } from "../../kpi/contracts/labels";
import type { Pillar } from "../contracts/enums";
import type { Materiality } from "../contracts/panels";
import { kpiStatuses, topicShares, weightOf, worstStatus } from "../derive/materiality";
import { panelRoute, type PanelBuild } from "../panel";
import type { InsightsScope } from "../scope";
import { netGross } from "../sources/emissions";
import { kpiSetupDone } from "../sources/kpi";
import { kpiTargetStatuses } from "../sources/targets";

type Row = Record<string, any>;

const PILLAR_LETTER: Record<Pillar, string> = { environment: "E", social: "S", governance: "G" };
const labelOf = (topic: string) => ((ESRS_TOPIC_LABELS as Record<string, string>)[topic] ?? topic).replace(/^[ESG]\d\s+/, "");
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Selected, active KPIs of the company by the ESRS topic of the disclosures they answer. */
async function kpisByTopic(companyId: number): Promise<Map<string, number[]>> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT DISTINCT d.esrs_topic, k.id
       FROM kpi_disclosure_map dm
       JOIN kpi_disclosure d ON d.id = dm.disclosure_id
       JOIN kpi_definition k ON k.id = dm.kpi_definition_id
       JOIN company_kpi ck ON ck.kpi_definition_id = k.id AND ck.company_id = $1 AND ck.selected = true
      WHERE d.esrs_topic IS NOT NULL AND k.active = true AND (k.company_id IS NULL OR k.company_id = $1)
      ORDER BY d.esrs_topic, k.id`,
    [companyId],
  );
  const out = new Map<string, number[]>();
  for (const r of rows) out.set(String(r.esrs_topic), [...(out.get(String(r.esrs_topic)) ?? []), Number(r.id)]);
  return out;
}

export async function buildMateriality(scope: InsightsScope): Promise<PanelBuild<Materiality>> {
  if (!(await kpiSetupDone(scope))) return { availability: "setup_incomplete", reason: "Finish KPI setup to see materiality against performance." };
  const rows: Row[] = await AppDataSource.query(
    `SELECT esrs_topic, impact_score, financial_score FROM company_material_topic WHERE company_id = $1 AND material = true ORDER BY esrs_topic`,
    [scope.companyId],
  );
  if (!rows.length) return { availability: "setup_incomplete", reason: "Mark your material topics in KPI setup to see this chart." };
  const byTopic = await kpisByTopic(scope.companyId);
  const statuses = kpiStatuses((await kpiTargetStatuses(scope)).map((t) => ({ kpi_definition_id: Number(t.target.kpi_definition_id), status: t.status })));
  const topics = rows.map((r) => String(r.esrs_topic));
  const counts = Object.fromEntries(topics.map((t) => [t, (byTopic.get(t) ?? []).length]));
  const shares = topicShares(counts, (await netGross(scope)).gross > 0);
  const letter = scope.query.pillar ? PILLAR_LETTER[scope.query.pillar] : null;

  const links: Record<string, string> = { scores: "/kpi/setup?step=materiality" };
  const points: Materiality["points"] = rows
    .filter((r) => !letter || String(r.esrs_topic).startsWith(letter))
    .map((r) => {
      const topic = String(r.esrs_topic);
      const ids = byTopic.get(topic) ?? [];
      const known = ids.map((id) => statuses.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
      const link = `/kpi/esg?topic=${topic}`;
      links[topic] = link;
      return {
        esrs_topic: topic,
        label: labelOf(topic),
        impact: num(r.impact_score),
        financial: num(r.financial_score),
        weight: weightOf(shares[topic] ?? 0),
        status: worstStatus(known),
        kpis: ids.length,
        on_track: known.filter((s) => s === "on_track" || s === "reached").length,
        off_track: known.filter((s) => s === "off_track").length,
        link,
      };
    });
  const scored = rows.every((r) => r.impact_score !== null && r.financial_score !== null);
  return { data: { scored, points }, links };
}

export const materialityPanel = panelRoute<Materiality>("materiality", buildMateriality, { kpi: true });

const router = Router();
router.get("/materiality", materialityPanel);
export default router;
