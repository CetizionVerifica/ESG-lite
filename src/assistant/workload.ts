/**
 * AS-2 · a short summary of the person's own work, for questions about it.
 *
 *   wantsWorkload(text)      true for "what's waiting for me?", false for "how do I…?"
 *   workloadFacts(caller)    the summary as plain lines, or null
 *
 * Every figure comes from the service behind the person's own screen: My month
 * for a User, Overview for a Manager or Admin, Console for a Superadmin. Nothing
 * is worked out here, so the assistant and the screen can't disagree. The same
 * sites apply as on those screens, narrowed to the person's client, and raw
 * entry rows never come here: they carry factors and methods a User can't see.
 * It's built only when a question needs it, and only reaches the model then.
 */
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { computeConsole, type ConsoleSummary } from "../services/console.service";
import { CONTRIBUTOR_RELATIONS, contributorSiteCategories } from "../services/contributorObligations";
import { computeManagerOverview, parseOverviewPeriod } from "../services/managerOverview.service";
import { computeMyMonth, previousMonth, type MyMonth } from "../services/myMonth.service";
import { UserRole } from "../types/type";
import { getCompanySiteIds, overseenSites } from "../utils/companyScope";
import type { AssistantRole } from "./kb";

const MAX_LINES = 40;
const MAX_PEOPLE = 15;
const MAX_CLIENTS = 15;

const HOW_TO = /^\s*(how (do|can|should|would) (i|we|you)\b|how to\b|what does\b|what do .*\bmean\b|what is an?\b|what's an?\b|where (do|can|should) (i|we)\b(?! stand)|why (is|are) there\b|can (i|you|we)\b|is it possible\b)/i;

const ABOUT_WORK =
  /\b(how many|how much|how('s| is| are) (my|our|we|it going|things)|what('s| is| are) (left|remaining|due|next|pending|missing|waiting|outstanding|up|still)|what (do|should|must) (i|we) (do|need|have|submit|file|enter)|which (sites?|people|person|users?|clients?|categor\w*)|who (has|have|hasn't|haven't|is|isn't|did|didn't)|waiting (for|on)|still (to|need|owe|have)|left to|(left|remaining|pending) for (me|us)|baa?ki|kitn[aei]|to ?do|overdue|outstanding|behind|catch me up|where (do|does) (i|we) stand|my (month|status|entries|entry|work|progress|data|totals?|queue|deadline|tasks?|checklist|pending|remaining)|our (month|status|entries|work|progress|data|totals?|emissions?|deadline)|am i (done|behind|missing)|are we (done|behind|on track)|anything (for me|waiting|due|pending)|summary|status of)\b/i;

/** A how-to question needs the articles, not the person's data, so it sends none. */
export function wantsWorkload(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.some((line) => {
    const counting = /\b(how many|how much)\b/i.test(line);
    return (counting || !HOW_TO.test(line)) && ABOUT_WORK.test(line);
  });
}

const tonnes = (n: number): string => `${Number(n).toFixed(3)} tCO2e`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const STATUS_WORDS: Record<string, string> = {
  todo: "To do",
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  covered: "Covered by a yearly filing",
  nothing: "Nothing this month",
};

/** A User's month, as My month shows it. */
export function userFacts(m: MyMonth): string {
  const s = m.summary;
  const lines = [
    `Month to report: ${m.month}. Due ${m.due_date}.`,
    `Categories: ${s.total} in all. To do ${s.due}, Pending ${s.pending}, Rejected ${s.rejected}, Done ${s.done}${s.draft !== undefined ? `, Draft ${s.draft}` : ""}.`,
  ];
  if (!m.sites.length) lines.push("They have no sites assigned.");
  const rows: string[] = [];
  for (const site of m.sites) {
    rows.push(`Site ${site.name}${"locked" in site && site.locked ? " (this month is closed)" : ""}:`);
    for (const c of site.categories) {
      const total = c.total_emission > 0 ? `, ${tonnes(c.total_emission)}` : "";
      rows.push(`- ${c.category_name}: ${STATUS_WORDS[c.status] ?? c.status}${total}`);
      for (const r of c.rejections) rows.push(`  Sent back${r.reviewed_by ? ` by ${r.reviewed_by}` : ""}: ${r.review_comment ?? "no reason given"}`);
    }
  }
  lines.push(...rows.slice(0, MAX_LINES));
  if (rows.length > MAX_LINES) lines.push(`(${rows.length - MAX_LINES} more lines are on the Current Month screen.)`);
  return lines.join("\n");
}

type Overview = Awaited<ReturnType<typeof computeManagerOverview>>;

/** A Manager's or Admin's queue and month, as Overview shows them. */
export function managerFacts(month: string, monthly: Overview, allTime: Overview): string {
  const k = monthly.kpis;
  const sub = monthly.submission;
  const missing = sub.users.filter((u) => u.status === "missing");
  const names = missing.slice(0, MAX_PEOPLE).map((u) => `${u.name} (${u.site_name})`);
  const lines = [
    `Waiting for approval, all periods: ${plural(allTime.kpis.pending_review_count, "entry", "entries")}.`,
    `Month to report: ${month}.`,
    `People for ${sub.month}: ${sub.submitted} submitted, ${sub.missing} missing.`,
  ];
  if (names.length) lines.push(`Missing: ${names.join(", ")}${missing.length > names.length ? `, and ${missing.length - names.length} more` : ""}.`);
  lines.push(`Entries for ${month}: ${k.approved_count} approved, ${k.pending_count} pending, ${k.rejected_count} rejected.`);
  lines.push(
    k.approved_count
      ? `Approved figures for ${month} (approved entries only): net ${tonnes(k.net)}, gross ${tonnes(k.gross)}, saved ${tonnes(k.saved)}; Scope 1 ${tonnes(k.scope_1)}, Scope 2 ${tonnes(k.scope_2)}, Scope 3 ${tonnes(k.scope_3)}.`
      : `Nothing is approved for ${month} yet.`,
  );
  return lines.join("\n");
}

type ClientRow = { company_id: number; entries_this_month: number; pending: number };

/** Every client's totals, and the rows of only the clients who allow it (A10). */
export function superadminFacts(c: ConsoleSummary, allowed: Map<number, string>): string {
  const t = c.totals;
  const rows = (c.clients as ClientRow[]).filter((r) => allowed.has(r.company_id));
  const shown = rows.slice(0, MAX_CLIENTS).map((r) => `- ${allowed.get(r.company_id)}: ${r.entries_this_month} entered in ${c.month}, ${r.pending} pending`);
  const recent = c.activity
    .filter((a) => a.company_id !== null && allowed.has(a.company_id))
    .slice(0, 5)
    .map((a) => `- ${a.at.slice(0, 10)}: ${a.kind.replace("_", " ")} for ${allowed.get(a.company_id as number)}${a.rows ? `, ${plural(a.rows, "row")}` : ""}`);
  return [
    `All clients: ${t.clients} clients (${t.active_clients} active), ${t.sites} sites, ${t.users} users.`,
    `Entries entered in ${c.month}: ${t.entries_this_month}. Pending across all clients: ${t.pending_entries}.`,
    ...(shown.length ? ["Clients who allow this summary:", ...shown] : ["No client allows a per-client summary yet."]),
    ...(rows.length > shown.length ? [`(${rows.length - shown.length} more on the Console.)`] : []),
    ...(recent.length ? ["Recent activity:", ...recent] : []),
  ].join("\n");
}

export interface WorkloadCaller {
  userId: number;
  role: AssistantRole;
  /** Null for a Superadmin. */
  companyId: number | null;
}

/** Someone can work across clients but the summary is one client's: "nothing waiting" must not read as everywhere. */
async function otherClientsNote(companyId: number, siteIds: number[], own: Set<number>): Promise<string | null> {
  if (siteIds.every((id) => own.has(id))) return null;
  const [client] = (await AppDataSource.query(`SELECT name FROM company WHERE company_id = $1`, [companyId])) as Array<{ name: string }>;
  return `This summary covers ${client?.name ?? "one client"} only. They also work for other clients, which it leaves out, so always name ${client?.name ?? "this client"} and say their screens show the rest.`;
}

const withNote = (note: string | null, facts: string): string => (note ? `${note}\n${facts}` : facts);

async function forUser(caller: WorkloadCaller): Promise<string | null> {
  const user = await AppDataSource.getRepository(User).findOne({ where: { user_id: caller.userId }, relations: CONTRIBUTOR_RELATIONS });
  if (!user || caller.companyId === null) return null;
  const own = await getCompanySiteIds(caller.companyId);
  const note = await otherClientsNote(caller.companyId, contributorSiteCategories(user).map((s) => s.site.site_id), own);
  return withNote(note, userFacts(await computeMyMonth(user, previousMonth(user.timezone), own)));
}

async function forManager(caller: WorkloadCaller): Promise<string | null> {
  if (caller.companyId === null) return null;
  const managed = await overseenSites(caller.userId, caller.role);
  if (!managed) return null;
  const own = await getCompanySiteIds(caller.companyId);
  const siteIds = [...managed.keys()].filter((id) => own.has(id)).sort((a, b) => a - b);
  const user = await AppDataSource.getRepository(User).findOne({ where: { user_id: caller.userId }, select: { user_id: true, timezone: true } });
  const month = previousMonth(user?.timezone);
  const period = parseOverviewPeriod(month);
  const allTime = parseOverviewPeriod(undefined);
  if (!period || !allTime) return null;
  const [monthly, everything] = await Promise.all([
    computeManagerOverview({ period, siteIds, managed, categoryIds: [] }),
    computeManagerOverview({ period: allTime, siteIds, managed, categoryIds: [] }),
  ]);
  return withNote(await otherClientsNote(caller.companyId, [...managed.keys()], own), managerFacts(month, monthly, everything));
}

async function forSuperadmin(): Promise<string> {
  const [summary, rows] = await Promise.all([
    computeConsole(20),
    AppDataSource.query(`SELECT company_id, name FROM company WHERE assistant_data_enabled = true`) as Promise<Array<{ company_id: number; name: string }>>,
  ]);
  return superadminFacts(summary, new Map(rows.map((r) => [Number(r.company_id), r.name])));
}

export async function workloadFacts(caller: WorkloadCaller): Promise<string | null> {
  if (caller.role === UserRole.USER) return forUser(caller);
  if (caller.role === UserRole.SUPERADMIN) return forSuperadmin();
  return forManager(caller);
}
