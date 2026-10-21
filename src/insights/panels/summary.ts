/**
 * IN-1 · GET /insights/summary → PanelResponse<Summary> (01-contracts §3, hero strip).
 *
 *   net          Overview's kpis.net for the period and sites; prior = Overview's last_year net
 *                (the same months while the year runs; null when nothing is due yet), change_pct
 *                = Overview's net_vs_last_year_pct; good when it fell.
 *   pathway      the SBTi status for the period year (sources/targets sbtiStatus, I6); null
 *                without a base year.
 *   intensity    Σ approved emissions ÷ Σ approved production over the sites, from the
 *                emission-intensity comparison Overview reads; `combined` when units differ;
 *                change on the same period last year; good when it fell.
 *   readiness    /kpi/esg pillar coverage (null when KPI tracking is off or not set up).
 *   attention    approvals (pending entries + production + KPI values), KPI gaps (/kpi/dashboard),
 *                off-track targets (SBTi pathway + KPI targets, I6), contributors who haven't
 *                filed this month (Overview's submission), categories above the change threshold
 *                (emission_threshold, default 5 %) — only items with a count, each with a link.
 *   renewable_share_pct  renewable kWh ÷ electricity kWh in the period (sources/energy).
 */
import { Router } from "express";
import { AppDataSource } from "../../config/data-source";
import { computeManagerOverview } from "../../services/managerOverview.service";
import type { AttentionKind } from "../contracts/enums";
import type { Summary } from "../contracts/panels";
import { changePct, combinedIntensity, countAbove, goodWhenDown, readinessOf, share } from "../derive";
import { panelRoute, type PanelBuild } from "../panel";
import { once, type InsightsScope } from "../scope";
import { overview } from "../sources/emissions";
import { electricityByYear } from "../sources/energy";
import { esg, gaps } from "../sources/kpi";
import { APPROVALS_LINK } from "../sources/pending";
import { outputBySiteYear, pendingProduction } from "../sources/production";
import { kpiTargetStatuses, sbtiStatus } from "../sources/targets";

/** The company's change limit (emission_threshold), default 5 % as the review checks. */
export const DEFAULT_THRESHOLD_PCT = 5;

const thresholdPct = async (companyId: number): Promise<number> => {
  const rows: Array<{ threshold_percentage: string }> = await AppDataSource.query(`SELECT threshold_percentage FROM emission_threshold WHERE company_id = $1`, [companyId]);
  const n = rows.length ? Number(rows[0].threshold_percentage) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD_PCT;
};

/** Intensity of one period: the comparison rows combined over the scope's sites. */
const intensityOf = async (scope: InsightsScope, year: number) => {
  const [y] = await outputBySiteYear(scope, [year]);
  return combinedIntensity(y.sites);
};

export async function buildSummary(scope: InsightsScope): Promise<PanelBuild<Summary>> {
  const year = scope.period.year;
  const ov = await overview(scope);
  const k = ov.kpis;
  const ly = ov.last_year && ov.last_year.status !== "not_due" ? ov.last_year : null;

  // Net, as Overview.
  const net: Summary["net"] = { value: k.net, unit: "tCO2e", prior: ly ? ly.kpis.net : null, change_pct: k.net_vs_last_year_pct, good: goodWhenDown(k.net_vs_last_year_pct) };

  // Pathway (SBTi).
  const sbti = await sbtiStatus(scope);
  const pathway: Summary["pathway"] = sbti ? { status: sbti.status, gap_pct: sbti.gap_pct, target_year: sbti.target_year } : null;

  // Intensity.
  const nowI = await intensityOf(scope, year);
  const prevI = await intensityOf(scope, year - 1);
  const iChange = prevI.unit === nowI.unit ? changePct(nowI.value, prevI.value) : null;
  const intensity: Summary["intensity"] = { value: nowI.value, unit: nowI.unit ?? "unit", combined: nowI.combined, change_pct: iChange, good: goodWhenDown(iChange) };

  // Readiness (KPI).
  const e = scope.kpiOn ? await esg(scope) : null;
  const r = e ? readinessOf(e.pillars) : null;
  const readiness: Summary["readiness"] = r ? { pct: r.pct, by_pillar: r.by_pillar } : null;

  // Renewable share.
  const [elec] = await electricityByYear(scope, [year]);
  const renewable_share_pct = elec ? share(elec.renewable_kwh, elec.total_kwh) : null;

  // Attention.
  const items: Summary["attention"]["items"] = [];
  const push = (kind: AttentionKind, count: number, link: string) => {
    if (count > 0) items.push({ kind, count, link });
  };
  const kpiPending = e?.pending_not_in.count ?? 0;
  push("approvals", k.pending_review_count + (await pendingProduction(scope)) + kpiPending, APPROVALS_LINK);
  const g = scope.kpiOn ? await gaps(scope) : null;
  push("kpi_gaps", g?.length ?? 0, `/kpi/dashboard?year=${year}`);
  const offKpi = (await kpiTargetStatuses(scope)).filter((t) => t.status === "off_track").length;
  push("off_track", offKpi + (sbti?.status === "off_track" ? 1 : 0), offKpi ? "/kpi/targets" : "/targets");
  push("missing_submitters", ov.submission.missing, "/overview#submissions");
  if (ly && ov.last_year) {
    const before = await once(scope, `overview-ly:${ov.last_year.period.key}:${ov.last_year.period.end}`, () =>
      computeManagerOverview({ period: ov.last_year!.period, siteIds: scope.siteIds, managed: scope.siteNames, categoryIds: [] }),
    );
    const limit = await thresholdPct(scope.companyId);
    push("threshold", countAbove(ov.by_category, before.by_category, (c) => c.category_id, (c) => c.total, limit), "/overview#categories");
  }
  const attention = { total: items.reduce((a, i) => a + i.count, 0), items };

  const links: Record<string, string> = {
    net: `/overview?period=${encodeURIComponent(ov.period.key)}`,
    intensity: "/production",
    pathway: "/targets",
    readiness: `/kpi/esg?year=${year}`,
    pending: APPROVALS_LINK,
  };
  return { data: { net, pathway, intensity, readiness, attention, renewable_share_pct }, links };
}

export const summaryPanel = panelRoute<Summary>("summary", buildSummary);

const router = Router();
router.get("/summary", summaryPanel);
export default router;
