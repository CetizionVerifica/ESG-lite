/**
 * KPI-10 · POST /kpi/dashboard/remind {kpi, site} (Manager, Admin, Superadmin):
 * a `kpi_due` notification to whoever owes the KPI there — the assignment's
 * owner; with no assignment, the site's Users who have the KPI's topic (none
 * granted = every topic), or for a company-level KPI the company's Admins (the
 * entry rule of values/service.ts and My KPIs). At most once a day per person
 * and item: a second call the same day sends nothing.
 *
 *   → {sent, notified: [user ids], already_today: [user ids]}
 *
 * Refusals: a KPI that isn't the company's or a site outside the caller's
 * scope → 404; not selected → KPI_NOT_SELECTED; auto or calculated →
 * KPI_AUTO_READ_ONLY (nobody enters them); level and site disagree or nobody
 * owes it → 422 KPI_VALUE_INVALID.
 */
import { AppDataSource } from "../../config/data-source";
import { KpiError } from "../contracts/errors";
import { KpiRemindSchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { alreadyReminded, kpiDueNotification } from "../review/reminders";
import { companyAdminIds } from "../switch";
import { assignmentFor, kpiSettings } from "../setup/settings";
import { findKpi, isKpiSelected } from "../values/service";
import { dashboardScope } from "./service";

type Row = Record<string, any>;

async function ownersOf(companyId: number, kpi: Row, siteId: number | null): Promise<number[]> {
  const m = AppDataSource.manager;
  const a = await assignmentFor(m, companyId, Number(kpi.id), siteId);
  if (a) return [Number(a.owner_user_id)];
  if (siteId === null) return companyAdminIds(companyId);
  const rows: Row[] = await m.query(
    `SELECT DISTINCT u.user_id FROM "user" u LEFT JOIN user_sites us ON us.user_id = u.user_id
      WHERE u.role = 'User' AND (u.site_id = $1 OR us.site_id = $1)
        AND (NOT EXISTS (SELECT 1 FROM kpi_topic_grant g WHERE g.user_id = u.user_id)
             OR EXISTS (SELECT 1 FROM kpi_topic_grant g WHERE g.user_id = u.user_id AND g.topic = $2))
      ORDER BY u.user_id`,
    [siteId, kpi.topic],
  );
  return rows.map((r) => Number(r.user_id));
}

export async function remind(caller: KpiCaller, body: unknown) {
  const b = parse(KpiRemindSchema, body ?? {});
  const m = AppDataSource.manager;
  const scope = await dashboardScope(m, caller, b.site ?? undefined);
  const kpi = await findKpi(m, caller.companyId, { id: b.kpi });
  if (!(await isKpiSelected(m, caller.companyId, kpi))) throw new KpiError("KPI_NOT_SELECTED", { kpi: kpi.code });
  if (kpi.source !== "manual") throw new KpiError("KPI_AUTO_READ_ONLY", { kpi: kpi.code, source: kpi.source });
  if ((kpi.level === "company") !== (b.site === null)) throw new KpiError("KPI_VALUE_INVALID", { field: "site", rule: kpi.level === "company" ? "company_level_kpi" : "site_level_kpi" });
  const owners = await ownersOf(caller.companyId, kpi, b.site);
  if (!owners.length) throw new KpiError("KPI_VALUE_INVALID", { field: "kpi", rule: "nobody_owes_it" });

  const where = b.site === null ? "the company" : scope.sites[0].name;
  const match = { kind: "remind", kpi: String(kpi.id), site: String(b.site ?? "company") };
  const notified: number[] = [];
  const already: number[] = [];
  const settings = await kpiSettings(m, caller.companyId);
  for (const userId of owners) {
    if (await alreadyReminded(userId, match)) {
      already.push(userId);
      continue;
    }
    await kpiDueNotification(userId, "Reminder: KPI values due", `Please enter ${kpi.name} for ${where}. Values are due on day ${settings.due_day} after each period ends.`, b.site === null ? "/kpi" : `/kpi?site=${b.site}`, {
      ...match,
      kpi_definition_id: Number(kpi.id),
      site_id: b.site,
      by: caller.userId,
    });
    notified.push(userId);
  }
  return { sent: notified.length > 0, notified, already_today: already };
}
