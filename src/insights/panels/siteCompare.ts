/**
 * IN-11 · GET /insights/site-compare → PanelResponse<SiteCompare> (01-contracts §3, the Sites tab).
 *
 * One row per site in scope, largest net first:
 *   net, pending        Overview's by_site for the period (approved rows; pending as Overview counts it)
 *   prior, change_pct   Overview's last_year.by_site net (null while last year isn't due) and
 *                       by_site net_vs_last_year_pct; good when it fell
 *   share_pct           the site's net ÷ the scope's net (derive `share`)
 *   scope_1/2/3         the site's Overview kpis (sources/flow scopesBySite, shared with the Data flow tab)
 *   intensity           the site's approved emissions ÷ approved production (the emission-intensity
 *                       comparison, derive `combinedIntensity` over that one site); change on the
 *                       same period last year when the unit is the same
 *   completeness_pct    the Completeness tab's counts for the site, summed over the months started
 *   link                the Overview for the period and that site
 * no_data: no sites, or no approved entry in the period.
 */
import { Router } from "express";
import type { SiteCompare, SiteCompareRow } from "../contracts/panels";
import { changePct, combinedIntensity, goodWhenDown, share } from "../derive";
import { siteCompletenessPct, siteOrder } from "../derive/sites";
import { panelRoute, type PanelBuild } from "../panel";
import type { InsightsScope } from "../scope";
import { overview } from "../sources/emissions";
import { scopesBySite } from "../sources/flow";
import { outputBySiteYear } from "../sources/production";
import { buildCompleteness } from "./completeness";

export const NO_SITES_REASON = "There's no approved data for these sites in this period yet.";

export async function buildSiteCompare(scope: InsightsScope, today = new Date().toISOString().slice(0, 10)): Promise<PanelBuild<SiteCompare>> {
  if (!scope.siteIds.length) return { availability: "no_data", reason: "No sites to show." };
  const ov = await overview(scope);
  if (ov.kpis.approved_count === 0) return { availability: "no_data", reason: NO_SITES_REASON };
  const ly = ov.last_year && ov.last_year.status !== "not_due" ? ov.last_year : null;
  const year = scope.period.year;
  const [scopes, [now, before], completeness] = await Promise.all([scopesBySite(scope), outputBySiteYear(scope, [year, year - 1]), buildCompleteness(scope, today)]);
  const cells = new Map((completeness.data?.rows ?? []).map((r) => [r.site_id, r.cells]));
  const thisMonth = today.slice(0, 7);
  const links: Record<string, string> = {};

  const rows: SiteCompareRow[] = ov.by_site.map((s) => {
    const id = s.site_id;
    const sc = scopes.find((x) => x.site_id === id);
    const nowI = combinedIntensity(now.sites.filter((x) => x.site_id === id));
    const prevI = combinedIntensity(before.sites.filter((x) => x.site_id === id));
    const iChange = nowI.unit !== null && prevI.unit === nowI.unit ? changePct(nowI.value, prevI.value) : null;
    const link = `/overview?period=${encodeURIComponent(ov.period.key)}&siteIds=${id}`;
    links[`site:${id}`] = link;
    return {
      site_id: id,
      site: s.name ?? scope.siteNames.get(id) ?? `Site ${id}`,
      net: s.net,
      prior: ly ? (ly.by_site.find((x) => x.site_id === id)?.net ?? null) : null,
      change_pct: s.net_vs_last_year_pct,
      good: goodWhenDown(s.net_vs_last_year_pct),
      share_pct: share(s.net, ov.kpis.net),
      scope_1: sc?.scope_1 ?? 0,
      scope_2: sc?.scope_2 ?? 0,
      scope_3: sc?.scope_3 ?? 0,
      intensity: { value: nowI.value, unit: nowI.unit, change_pct: iChange, good: goodWhenDown(iChange) },
      completeness_pct: siteCompletenessPct(cells.get(id) ?? [], thisMonth),
      pending: s.pending,
      link,
    };
  });
  rows.sort(siteOrder);
  return { data: { rows }, links };
}

export const siteComparePanel = panelRoute<SiteCompare>("site_compare", (scope) => buildSiteCompare(scope));

const router = Router();
router.get("/site-compare", siteComparePanel);
export default router;
