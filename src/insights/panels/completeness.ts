/**
 * IN-4 · GET /insights/completeness → PanelResponse<Completeness> (01-contracts §3, tab G).
 *
 * One row per site in scope, one cell per month of the period ('YYYY-MM'):
 *   emissions_expected  the site's categories (FERA left out), the contributor obligation of
 *                       src/services/contributorObligations.ts at site level
 *   emissions_approved  those with an approved monthly entry dated in the month or an approved
 *                       yearly batch covering it (`yearlyCoversDateSql`, the same rule as
 *                       "what's left to file" in My month)
 *   kpi_expected        (KPI tracking on and set up) selected manual site-level KPIs whose period
 *                       ends in the month, on the sites they're expected (`expectedSites`, KPI-8's
 *                       rule): monthly every month, quarterly in the quarter's last month, annual
 *                       in the year's last month, in the company's KPI year type
 *   kpi_approved        those with an approved value for that site and period
 *   pct                 (approved) ÷ (expected) × 100 (derive/pathway completenessPct); null for a
 *                       month that hasn't started yet or with nothing expected
 *   link                the Overview for that month and site
 * Company-level KPIs and auto/formula KPIs (filled from data) are not cells: nobody files them per site.
 */
import { Router } from "express";
import { AppDataSource } from "../../config/data-source";
import { Emission } from "../../entities/Emission";
import { expectedSites } from "../../kpi/review/lock";
import { ownerIndex } from "../../kpi/setup/owners";
import { kpiSettings } from "../../kpi/setup/settings";
import { figureDefs } from "../../kpi/targets/service";
import { periodsFor } from "../../kpi/values/period";
import { loadValues } from "../../kpi/values/yearly";
import { monthBounds } from "../../services/contributorObligations";
import { yearlyCoversDateSql } from "../../services/reportingPeriod";
import type { Completeness, CompletenessCell } from "../contracts/panels";
import { completenessPct } from "../derive/pathway";
import { panelRoute, type PanelBuild } from "../panel";
import { periodMonths, type InsightsScope } from "../scope";
import { kpiSetupDone } from "../sources/kpi";

type Row = Record<string, any>;
const key = (site: number, month: string) => `${site}|${month}`;

/** Per site: its expected categories (FERA left out). */
async function siteCategories(scope: InsightsScope): Promise<Map<number, number[]>> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT sc.site_id, c.category_id FROM site_categories sc JOIN category c ON c.category_id = sc.category_id JOIN site s ON s.site_id = sc.site_id
      WHERE s.company_id = $1 AND sc.site_id = ANY($2::int[]) AND LOWER(c.category_name) <> 'fera'
      ORDER BY sc.site_id, c.category_id`,
    [scope.companyId, scope.siteIds],
  );
  const out = new Map<number, number[]>(scope.siteIds.map((s) => [s, []]));
  for (const r of rows) out.get(Number(r.site_id))!.push(Number(r.category_id));
  return out;
}

/** Approved (site, category) pairs per month: a monthly entry in the month or a yearly batch covering it. */
async function approvedPairs(scope: InsightsScope, months: string[]): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  for (const month of months) {
    const { monthStart, monthEnd } = monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
    const rows: Row[] = await AppDataSource.getRepository(Emission)
      .createQueryBuilder("e")
      .select("DISTINCT e.site_id", "site_id")
      .addSelect("e.category_id", "category_id")
      .where("e.site_id IN (:...siteIds)", { siteIds: scope.siteIds })
      .andWhere("e.status = 'approved'")
      .andWhere(`((e.reporting_period IS DISTINCT FROM 'yearly' AND e.date_of_reporting BETWEEN :monthStart AND :monthEnd) OR ${yearlyCoversDateSql("e")})`, {
        monthStart,
        monthEnd,
        coveredDate: monthStart,
      })
      .getRawMany();
    for (const r of rows) {
      const k = key(Number(r.site_id), month);
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(Number(r.category_id));
    }
  }
  return out;
}

/** KPI cells: expected and approved per (site, month). */
async function kpiCells(scope: InsightsScope, months: string[]): Promise<Map<string, { expected: number; approved: number }>> {
  const out = new Map<string, { expected: number; approved: number }>();
  if (!scope.kpiOn || !(await kpiSetupDone(scope))) return out;
  const m = AppDataSource.manager;
  const yearType = (await kpiSettings(m, scope.companyId)).year_type;
  const { byId } = await figureDefs(m, scope.companyId);
  const manual = [...byId.values()].filter((d) => d.selected && d.active && d.source === "manual" && d.level === "site");
  if (!manual.length) return out;
  const owners = await ownerIndex(m, scope.companyId);
  const allSites: number[] = (await m.query(`SELECT site_id FROM site WHERE company_id = $1`, [scope.companyId])).map((r: Row) => Number(r.site_id));
  const assignments = owners.ownedPairs(manual.map((d) => ({ id: d.id, topic: String(d.topic), level: d.level })), allSites);
  const inMonths = new Set(months);
  const first = `${months[0]}-01`;
  const last = monthBounds(Number(months[months.length - 1].slice(0, 4)), Number(months[months.length - 1].slice(5, 7))).monthEnd;
  const values = await loadValues(m, scope.companyId, { from: `${Number(first.slice(0, 4)) - 1}${first.slice(4)}`, to: last, statuses: ["approved"] });
  const approved = new Set(values.filter((v) => v.site_id !== null).map((v) => `${v.kpi_definition_id}|${v.site_id}|${v.period_start}|${v.frequency}`));
  const years = [...new Set(months.map((mm) => Number(mm.slice(0, 4))))];
  for (const d of manual) {
    const periods = [...new Set([years[0] - 1, ...years, years[years.length - 1] + 1])].flatMap((y) => periodsFor(d.frequency, yearType, y)).filter((p) => inMonths.has(p.end.slice(0, 7)));
    for (const site of expectedSites(d.id, scope.siteIds, assignments)) {
      for (const p of periods) {
        const k = key(site, p.end.slice(0, 7));
        const c = out.get(k) ?? { expected: 0, approved: 0 };
        c.expected++;
        if (approved.has(`${d.id}|${site}|${p.start}|${p.frequency}`)) c.approved++;
        out.set(k, c);
      }
    }
  }
  return out;
}

export async function buildCompleteness(scope: InsightsScope, today = new Date().toISOString().slice(0, 10)): Promise<PanelBuild<Completeness>> {
  const months = periodMonths(scope.period);
  if (!scope.siteIds.length) return { availability: "no_data", reason: "No sites to show." };
  const [cats, done, kpi] = await Promise.all([siteCategories(scope), approvedPairs(scope, months), kpiCells(scope, months)]);
  const thisMonth = today.slice(0, 7);
  const links: Record<string, string> = {};
  const rows: Completeness["rows"] = scope.siteIds.map((site) => ({
    site_id: site,
    site: scope.siteNames.get(site) ?? String(site),
    cells: months.map((month): CompletenessCell => {
      const expectedCats = cats.get(site) ?? [];
      const filed = done.get(key(site, month)) ?? new Set<number>();
      const k = kpi.get(key(site, month)) ?? { expected: 0, approved: 0 };
      const counts = {
        emissions_expected: expectedCats.length,
        emissions_approved: expectedCats.filter((c) => filed.has(c)).length,
        kpi_expected: k.expected,
        kpi_approved: k.approved,
      };
      const link = `/overview?period=${month}&siteIds=${site}`;
      links[`${site}:${month}`] = link;
      return { month, pct: completenessPct(counts, month > thisMonth), ...counts, link };
    }),
  }));
  return { data: { months, rows }, links };
}

export const completenessPanel = panelRoute<Completeness>("completeness", (scope) => buildCompleteness(scope));

const router = Router();
router.get("/completeness", completenessPanel);
export default router;
