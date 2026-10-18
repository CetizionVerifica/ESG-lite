/**
 * KPI-10 · POST /kpi/dashboard/remind {kpi, site} (Manager, Admin, Superadmin):
 * a `kpi_due` notification to whoever owes the KPI there — its owner through
 * `resolveOwner` (D17: the per-KPI assignment, else the topic assignment);
 * unassigned = nobody (KPI_VALUE_INVALID nobody_owes_it). At most once a day per person
 * and item: a second call the same day sends nothing.
 *
 *   → {reminded, owner_name, message, sent (= reminded), notified: [user ids], already_today: [user ids]}
 *     reminded false = everyone who owes it was already reminded today
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
import { kpiSettings } from "../setup/settings";
import { resolveOwner } from "../setup/owners";
import { findKpi, isKpiSelected } from "../values/service";
import { DASHBOARD_ROLES, dashboardScope } from "./service";

type Row = Record<string, any>;

/** D17: whoever owns the KPI there through the resolver (override, else topic owner); nobody = []. */
async function ownersOf(companyId: number, kpi: Row, siteId: number | null): Promise<number[]> {
  const o = await resolveOwner(AppDataSource.manager, companyId, { id: Number(kpi.id), topic: String(kpi.topic) }, siteId);
  return o.owner_user_id === null ? [] : [o.owner_user_id];
}

export async function remind(caller: KpiCaller, body: unknown) {
  // The role first (KPI-13 probes): a User gets 403, not a validation error.
  if (!DASHBOARD_ROLES.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Admin", "Superadmin"] });
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
  const names: Row[] = await m.query(`SELECT NULLIF(TRIM(CONCAT(COALESCE(name, ''), ' ', COALESCE(last_name, ''))), '') AS name FROM "user" WHERE user_id = ANY($1::int[]) ORDER BY user_id`, [owners]);
  const owner_name = names.map((n) => n.name).filter(Boolean).join(", ") || null;
  const sent = notified.length > 0;
  return {
    reminded: sent,
    owner_name,
    message: sent ? `Reminder sent to ${owner_name ?? "the owner"}.` : `${owner_name ?? "The owner"} was already reminded today.`,
    sent,
    notified,
    already_today: already,
  };
}
