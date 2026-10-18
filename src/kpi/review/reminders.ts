/**
 * KPI-8 · due reminders (D16): a daily job sends `kpi_due` to everyone who
 * still owes KPI values 5 days before the due date and on the due date.
 *
 *   sendDueReminders(today?)   for each company with the switch on and setup finished, each of
 *                              its people: their My KPIs items (values/my.ts, the same rule as
 *                              entry) due on `today` or `today + 5` that are still due (nothing
 *                              yet, or a draft) or sent back → one notification per person and
 *                              due date. Never twice for the same person and due date; muted
 *                              with `notification_preferences.kpi_due = false`.
 *   startKpiDueScheduler()     node-cron at 07:15 server time; off with KPI_DUE_JOB=off and
 *                              under NODE_ENV=test (tests call sendDueReminders directly)
 *   alreadyReminded / kpiDueNotification   shared with KPI-10's "Remind"
 *
 * Logs counts and ids only.
 */
import cron from "node-cron";
import { AppDataSource } from "../../config/data-source";
import { createNotification } from "../../services/notificationService";
import { callerSites } from "../guard";
import { myKpis } from "../values/my";
import { todayIso } from "../setup/settings";

type Row = Record<string, any>;

export const REMINDER_DAYS_BEFORE = 5;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** YYYY-MM of the month before `iso`'s month (a period ending then is due in `iso`'s month). */
const monthBefore = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) - 1;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/** Whether `userId` muted KPI reminders. */
const muted = async (userId: number): Promise<boolean> => {
  const [u]: Row[] = await AppDataSource.query(`SELECT notification_preferences FROM "user" WHERE user_id = $1`, [userId]);
  return u?.notification_preferences?.kpi_due === false;
};

/** A kpi_due notification sent today to `userId` whose meta matches `match` (string values). */
export async function alreadyReminded(userId: number, match: Record<string, string>): Promise<Date | null> {
  const keys = Object.keys(match);
  const rows: Row[] = await AppDataSource.query(
    `SELECT created_at FROM notification WHERE user_id = $1 AND type = 'kpi_due' AND created_at >= date_trunc('day', now())
       ${keys.map((k, i) => `AND meta->>'${k.replace(/[^a-z_]/g, "")}' = $${i + 2}`).join(" ")} ORDER BY id DESC LIMIT 1`,
    [userId, ...keys.map((k) => match[k])],
  );
  return rows[0]?.created_at ?? null;
}

export const kpiDueNotification = (userId: number, title: string, message: string, link: string, meta: Record<string, unknown>) =>
  createNotification(userId, "kpi_due", title, message, link, meta as never);

const prettyDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export interface ReminderRun {
  companies: number;
  notified: number;
  muted: number;
  already: number;
}

export async function sendDueReminders(today = todayIso()): Promise<ReminderRun> {
  const out: ReminderRun = { companies: 0, notified: 0, muted: 0, already: 0 };
  const companies: Row[] = await AppDataSource.query(
    `SELECT c.company_id FROM company c JOIN company_kpi_settings s ON s.company_id = c.company_id
      WHERE c.kpi_tracking_enabled = true AND s.setup_completed_at IS NOT NULL ORDER BY c.company_id`,
  );
  const dates = [today, addDays(today, REMINDER_DAYS_BEFORE)];
  for (const c of companies) {
    const companyId = Number(c.company_id);
    out.companies++;
    const people: Row[] = await AppDataSource.query(
      `SELECT DISTINCT u.user_id, u.role FROM "user" u LEFT JOIN user_sites us ON us.user_id = u.user_id
         LEFT JOIN site s ON s.site_id IN (u.site_id, us.site_id) AND s.company_id = $1
        WHERE (s.site_id IS NOT NULL OR u.company_id = $1) AND u.role IN ('User', 'Manager', 'Admin') ORDER BY u.user_id`,
      [companyId],
    );
    for (const p of people) {
      const userId = Number(p.user_id);
      try {
        const caller = { companyId, userId, role: String(p.role), sites: await callerSites(userId, String(p.role), companyId) };
        for (const due of dates) {
          const ym = monthBefore(due);
          const items = (await myKpis(caller, { period: ym })).items.filter((i) => i.due_date === due && (i.group === "due" || i.group === "sent_back"));
          if (!items.length) continue;
          if (await muted(userId)) {
            out.muted++;
            continue;
          }
          if (await alreadyReminded(userId, { kind: "due_date", due_date: due })) {
            out.already++;
            continue;
          }
          const n = items.length;
          const label = items[0].period_label;
          await kpiDueNotification(
            userId,
            due === today ? "KPIs due today" : `KPIs due in ${REMINDER_DAYS_BEFORE} days`,
            `${n} KPI value${n === 1 ? " is" : "s are"} due on ${prettyDate(due)} (${label}${items.some((i) => i.period_label !== label) ? " and more" : ""}).`,
            `/kpi?period=${ym}`,
            { kind: "due_date", due_date: due, period: ym, count: n },
          );
          out.notified++;
        }
      } catch (err) {
        console.error(`[kpi] due reminder failed (company ${companyId}, user ${userId}):`, (err as Error)?.message);
      }
    }
  }
  return out;
}

let started = false;

export function startKpiDueScheduler() {
  if (started || process.env.KPI_DUE_JOB === "off" || process.env.NODE_ENV === "test") return;
  started = true;
  cron.schedule("15 7 * * *", async () => {
    try {
      console.log("[kpi] due reminders:", JSON.stringify(await sendDueReminders()));
    } catch (err) {
      console.error("[kpi] due reminders failed:", (err as Error)?.message);
    }
  });
}
