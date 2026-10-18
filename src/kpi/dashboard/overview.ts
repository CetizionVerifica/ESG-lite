/**
 * KPI-10 follow-up (wave D fix 3) · GET /kpi/overview — the two Overview tiles:
 *
 *   → {period, year, readiness:[{framework, version, percent}], due:{due, sent_back, done}, setup_completed}
 *
 *   readiness   "KPI readiness": the dashboard's coverage percent per enabled framework
 *               for the caller's scope (their sites and the company-level KPIs), in the
 *               current reporting year. Manager, Admin and Superadmin (the people who
 *               open the dashboard); a User gets [] (the tile links to the dashboard,
 *               which they can't open).
 *   due         "KPIs due this month": the caller's My KPIs counts (values/my.ts) for the
 *               items due this month, i.e. periods ending last month (due on due_day).
 *   period      that YYYY-MM (the My KPIs link: /kpi?period=<period>).
 *
 * Before setup is finished it answers the empty shape with setup_completed false
 * (the tiles say "Finish KPI setup"), not 409. Any role; the switch first, as
 * every /kpi route.
 */
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import type { KpiCaller } from "../guard";
import { kpiSettings, setupCompleted } from "../setup/settings";
import { reportingYearOf } from "../values/period";
import { myKpis } from "../values/my";
import { dashboard } from "./service";

/** YYYY-MM of the month before today (server's local calendar). */
const previousMonth = (now = new Date()) => {
  const t = now.getFullYear() * 12 + now.getMonth() - 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const localToday = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export async function overview(caller: KpiCaller) {
  const m = AppDataSource.manager;
  const period = previousMonth();
  const settings = await kpiSettings(m, caller.companyId);
  const year = reportingYearOf(localToday(), settings.year_type);
  if (!(await setupCompleted(m, caller.companyId))) {
    return { period, year, readiness: [], due: { due: 0, sent_back: 0, done: 0 }, setup_completed: false };
  }
  const my = await myKpis(caller, { period });
  const readiness =
    caller.role === UserRole.USER
      ? []
      : ((await dashboard(caller, { year: String(year) })).coverage as Array<{ framework: string; version: string; percent: number }>).map((c) => ({ framework: c.framework, version: c.version, percent: c.percent }));
  return { period, year, readiness, due: { due: my.counts.due, sent_back: my.counts.sent_back, done: my.counts.done }, setup_completed: true };
}
