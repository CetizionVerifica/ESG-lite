/**
 * DS-13 · who a design's collaborators can be (D13): the company's Managers
 * and Admins (studio access, D5) who can read every site the design covers
 * (a company-wide design needs all-site access, as DS-5's loadDocRow). Users
 * (contributors) are never listed, mentioned, assigned or asked to approve.
 *
 *   docPeople(companyId, sites)   StudioPerson[] + email (internal) for notifications
 *   personFor(people, id)         the person, or null when they have no access
 */
import { AppDataSource } from "../../config/data-source";
import { callerSites } from "../../kpi/guard";
import type { StudioPerson } from "../contracts";
import { readableSites } from "../sources/resolve";

type Row = Record<string, any>;

export interface Person extends StudioPerson {
  email: string | null;
}

export const fullName = (r: { name?: string | null; last_name?: string | null }) => `${r.name ?? ""} ${r.last_name ?? ""}`.trim() || "Someone";

export async function docPeople(companyId: number, sites: "all" | number[]): Promise<Person[]> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT DISTINCT u.user_id, u.role, u.name, u.last_name, u.email FROM "user" u
       LEFT JOIN user_sites us ON us.user_id = u.user_id
       LEFT JOIN site s ON s.site_id IN (u.site_id, us.site_id) AND s.company_id = $1
      WHERE (s.site_id IS NOT NULL OR u.company_id = $1) AND u.role IN ('Manager', 'Admin')
      ORDER BY u.user_id`,
    [companyId],
  );
  const out: Person[] = [];
  for (const r of rows) {
    const id = Number(r.user_id);
    const role = String(r.role) as "Manager" | "Admin";
    const mine = await callerSites(id, role, companyId);
    const { readable, all } = await readableSites({ companyId, sites: mine });
    const ok = sites === "all" ? all : sites.every((s) => readable.includes(s));
    if (!ok) continue;
    out.push({ id, name: fullName(r), role, canApprove: role === "Manager", email: r.email ?? null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export const publicPerson = ({ email: _e, ...p }: Person): StudioPerson => p;

export const personFor = (people: Person[], id: number | null | undefined): Person | null => (id ? people.find((p) => p.id === id) ?? null : null);

/** Display names for user ids (any user; for authors who have since left the company). */
export async function namesFor(ids: number[]): Promise<Map<number, string>> {
  const uniq = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!uniq.length) return new Map();
  const rows: Row[] = await AppDataSource.query(`SELECT user_id, name, last_name FROM "user" WHERE user_id = ANY($1::int[])`, [uniq]);
  return new Map(rows.map((r) => [Number(r.user_id), fullName(r)]));
}
