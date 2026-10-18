/**
 * D17 (wave D) · topic-wise assignment: each site (and the company level,
 * site null) maps each KPI topic to one owner, with an optional reviewer.
 *
 *   topicsInUse(m, company)                    [{topic, kpi_count, site_kpi_count, company_kpi_count}]
 *                                              in KPI_TOPICS order, for the selected KPIs
 *   topicAssignments(m, company)               [{id, site_id, topic, owner_user_id, reviewer_user_id}]
 *   suggestTopicAssignments(...)               default owners for empty slots: the site's first User
 *                                              for each topic in use there; company level: the first Admin
 *   saveTopicAssignments(m, caller, items)     PUT /kpi/setup {topic_assignments}: replaces the whole set
 *   getPeopleTopics(caller, user)              GET /kpi/people/:user_id/topics
 *   putPeopleTopics(caller, user, body)        PUT /kpi/people/:user_id/topics (also the
 *                                              PATCH /company-admin/users/:id {kpi_topics} alias)
 *
 * Owner rules (KPI_VALUE_INVALID, as kpi_assignment): a site topic's owner is a
 * User or Manager of that site (`user_of_the_site`); a company-level topic's
 * owner an Admin, Manager or User of the company (`user_of_the_company`); a
 * reviewer a Manager of the site (`manager_of_the_site`; company level: of any
 * company site). Every change writes an audit row (`kpi_setup`).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { KPI_TOPICS, type KpiTopic } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { TOPIC_LABELS } from "../contracts/labels";
import { KpiPeopleTopicsPutSchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { userSiteIds } from "./settings";

type Row = Record<string, any>;

export const KPI_TOPIC_LOCK_CLASS = 4152; // the setup lock: topic writes and setup writes serialise per company

const TOPIC_ORDER = new Map<string, number>(KPI_TOPICS.map((t, i) => [t, i]));
export const topicOrder = (t: string) => TOPIC_ORDER.get(t) ?? KPI_TOPICS.length;
export const sortTopics = <T extends string>(list: Iterable<T>): T[] => [...new Set(list)].sort((a, b) => topicOrder(a) - topicOrder(b));
export const topicLabel = (t: string) => TOPIC_LABELS[t as KpiTopic] ?? t;

const nameSql = (alias: string) => `NULLIF(TRIM(CONCAT(COALESCE(${alias}.name, ''), ' ', COALESCE(${alias}.last_name, ''))), '')`;

export const auditSetupRow = (m: EntityManager, companyId: number, action: string, changed: Record<string, unknown>, userId: number) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_setup', $1, $2, $3, NULL, $4)`, [companyId, action, JSON.stringify(changed), userId || null]);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TopicInUse {
  topic: string;
  /** Selected KPIs someone enters (manual), at either level. */
  kpi_count: number;
  site_kpi_count: number;
  company_kpi_count: number;
  /** Every selected KPI of the topic, auto and calculated ones included. */
  selected_count: number;
}

export async function topicsInUse(m: EntityManager, companyId: number): Promise<TopicInUse[]> {
  const rows: Row[] = await m.query(
    `SELECT d.topic, d.level, d.source, COUNT(*)::int AS n
       FROM company_kpi ck JOIN kpi_definition d ON d.id = ck.kpi_definition_id AND d.active AND (d.company_id IS NULL OR d.company_id = $1)
      WHERE ck.company_id = $1 AND ck.selected GROUP BY d.topic, d.level, d.source`,
    [companyId],
  );
  const by = new Map<string, TopicInUse>();
  for (const r of rows) {
    const t = by.get(r.topic) ?? { topic: r.topic, kpi_count: 0, site_kpi_count: 0, company_kpi_count: 0, selected_count: 0 };
    t.selected_count += Number(r.n);
    if (r.source === "manual") {
      t.kpi_count += Number(r.n);
      if (r.level === "company") t.company_kpi_count += Number(r.n);
      else t.site_kpi_count += Number(r.n);
    }
    by.set(r.topic, t);
  }
  return sortTopics(by.keys()).map((t) => by.get(t)!);
}

export interface TopicAssignmentOut {
  id: number;
  site_id: number | null;
  topic: string;
  owner_user_id: number;
  reviewer_user_id: number | null;
}

export async function topicAssignments(m: EntityManager, companyId: number): Promise<TopicAssignmentOut[]> {
  const rows: Row[] = await m.query(`SELECT id, site_id, topic, owner_user_id, reviewer_user_id FROM kpi_topic_assignment WHERE company_id = $1`, [companyId]);
  return rows
    .map((r) => ({ id: Number(r.id), site_id: r.site_id === null ? null : Number(r.site_id), topic: r.topic, owner_user_id: Number(r.owner_user_id), reviewer_user_id: r.reviewer_user_id === null ? null : Number(r.reviewer_user_id) }))
    .sort((a, b) => topicOrder(a.topic) - topicOrder(b.topic) || (a.site_id ?? 0) - (b.site_id ?? 0));
}

/**
 * Default owners for slots nobody owns yet (wave D: "for each site and each
 * topic in use, the site's first User; for the company level, the first
 * Admin"). Same shape as topic_assignments, `id` null.
 */
export function suggestTopicAssignments(
  inUse: TopicInUse[],
  sites: Array<{ site_id: number }>,
  people: Array<{ user_id: number; role: string; site_ids: number[] }>,
  taken: Array<{ site_id: number | null; topic: string }>,
): Array<{ id: null; site_id: number | null; topic: string; owner_user_id: number; reviewer_user_id: null }> {
  const has = new Set(taken.map((t) => `${t.site_id ?? ""}|${t.topic}`));
  const admin = people.find((p) => p.role === UserRole.ADMIN);
  const out: Array<{ id: null; site_id: number | null; topic: string; owner_user_id: number; reviewer_user_id: null }> = [];
  for (const t of inUse) {
    if (t.company_kpi_count > 0 && admin && !has.has(`|${t.topic}`)) out.push({ id: null, site_id: null, topic: t.topic, owner_user_id: admin.user_id, reviewer_user_id: null });
    if (t.site_kpi_count === 0) continue;
    for (const s of sites) {
      if (has.has(`${s.site_id}|${t.topic}`)) continue;
      const owner = people.find((p) => p.role === UserRole.USER && p.site_ids.includes(Number(s.site_id)));
      if (owner) out.push({ id: null, site_id: Number(s.site_id), topic: t.topic, owner_user_id: owner.user_id, reviewer_user_id: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Owner rules
// ---------------------------------------------------------------------------

/** Role and sites of people, cached per request. */
export function personLookup(m: EntityManager) {
  const cache = new Map<number, { role: string; sites: Set<number>; name: string | null }>();
  return async (userId: number) => {
    if (!cache.has(userId)) {
      const [u]: Row[] = await m.query(`SELECT role, ${nameSql("u")} AS name FROM "user" u WHERE user_id = $1`, [userId]);
      cache.set(userId, { role: u?.role ?? "", sites: u ? await userSiteIds(m, userId) : new Set(), name: u?.name ?? null });
    }
    return cache.get(userId)!;
  };
}

export async function assertTopicOwner(
  person: ReturnType<typeof personLookup>,
  companySites: Set<number>,
  slot: { site_id: number | null; owner_user_id: number; reviewer_user_id?: number | null },
  field: string,
): Promise<void> {
  const owner = await person(slot.owner_user_id);
  const inCompany = [...owner.sites].some((s) => companySites.has(s));
  const ok =
    slot.site_id === null
      ? inCompany && [UserRole.ADMIN, UserRole.MANAGER, UserRole.USER].includes(owner.role as UserRole)
      : [UserRole.USER, UserRole.MANAGER].includes(owner.role as UserRole) && owner.sites.has(slot.site_id);
  if (!ok) throw new KpiError("KPI_VALUE_INVALID", { field: `${field}.owner_user_id`, rule: slot.site_id === null ? "user_of_the_company" : "user_of_the_site" });
  const reviewerId = slot.reviewer_user_id ?? null;
  if (reviewerId !== null) {
    const r = await person(reviewerId);
    const rok = r.role === UserRole.MANAGER && (slot.site_id === null ? [...r.sites].some((s) => companySites.has(s)) : r.sites.has(slot.site_id));
    if (!rok) throw new KpiError("KPI_VALUE_INVALID", { field: `${field}.reviewer_user_id`, rule: "manager_of_the_site" });
  }
}

const companySiteSet = async (m: EntityManager, companyId: number) =>
  new Set<number>((await m.query(`SELECT site_id FROM site WHERE company_id = $1`, [companyId])).map((r: Row) => Number(r.site_id)));

/**
 * When a topic's owner changes or the topic row goes, per-KPI rows on that
 * site and topic that only repeated the old owner (same owner and reviewer)
 * are not real exceptions: drop them, so the KPIs follow the topic. Real
 * exceptions (another person) stay. Without this, wave B setups (one
 * kpi_assignment row per KPI) kept every KPI pinned to the old person.
 */
export async function dropEchoExceptions(
  m: EntityManager,
  companyId: number,
  siteId: number | null,
  topic: string,
  ownerUserId: number,
  reviewerUserId: number | null,
): Promise<number> {
  // data-loss-reviewed: removes only per-KPI rows identical to the topic owner being replaced; who owns each KPI is decided by the new topic row.
  const rows: Row[] = await m.query(
    `DELETE FROM kpi_assignment a USING kpi_definition d WHERE d.id = a.kpi_definition_id AND a.company_id = $1 AND COALESCE(a.site_id, 0) = COALESCE($2::int, 0) AND d.topic = $3 AND a.owner_user_id = $4 AND COALESCE(a.reviewer_user_id, 0) = COALESCE($5::int, 0) RETURNING a.id`,
    [companyId, siteId, topic, ownerUserId, reviewerUserId],
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// PUT /kpi/setup {topic_assignments}: the whole set
// ---------------------------------------------------------------------------

export async function saveTopicAssignments(
  m: EntityManager,
  caller: KpiCaller,
  items: Array<{ site_id: number | null; topic: string; owner_user_id: number | null; reviewer_user_id?: number | null }>,
): Promise<void> {
  const companyId = caller.companyId;
  const companySites = await companySiteSet(m, companyId);
  const person = personLookup(m);
  const wanted = new Map<string, { site_id: number | null; topic: string; owner_user_id: number; reviewer_user_id: number | null }>();
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (a.site_id !== null && !companySites.has(a.site_id)) throw new KpiError("KPI_NOT_FOUND", { site_id: a.site_id });
    const k = `${a.site_id ?? ""}|${a.topic}`;
    if (a.owner_user_id === null) {
      wanted.delete(k);
      continue;
    }
    await assertTopicOwner(person, companySites, { site_id: a.site_id, owner_user_id: a.owner_user_id, reviewer_user_id: a.reviewer_user_id ?? null }, `topic_assignments.${i}`);
    wanted.set(k, { site_id: a.site_id, topic: a.topic, owner_user_id: a.owner_user_id, reviewer_user_id: a.reviewer_user_id ?? null });
  }
  const before = await topicAssignments(m, companyId);
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  for (const b of before) {
    const k = `${b.site_id ?? ""}|${b.topic}`;
    const w = wanted.get(k);
    if (!w) {
      await m.query(`DELETE FROM kpi_topic_assignment WHERE id = $1`, [b.id]);
      await dropEchoExceptions(m, companyId, b.site_id, b.topic, b.owner_user_id, b.reviewer_user_id);
      changed[`${b.topic}@${b.site_id ?? "company"}`] = { old: { owner_user_id: b.owner_user_id, reviewer_user_id: b.reviewer_user_id }, new: null };
    }
  }
  for (const w of wanted.values()) {
    const b = before.find((x) => x.site_id === w.site_id && x.topic === w.topic);
    if (b && b.owner_user_id === w.owner_user_id && b.reviewer_user_id === w.reviewer_user_id) continue;
    if (b) await dropEchoExceptions(m, companyId, b.site_id, b.topic, b.owner_user_id, b.reviewer_user_id);
    await m.query(
      `INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id, reviewer_user_id, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, (COALESCE(site_id, 0)), topic) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, reviewer_user_id = EXCLUDED.reviewer_user_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [companyId, w.site_id, w.topic, w.owner_user_id, w.reviewer_user_id, caller.userId || null],
    );
    changed[`${w.topic}@${w.site_id ?? "company"}`] = { old: b ? { owner_user_id: b.owner_user_id, reviewer_user_id: b.reviewer_user_id } : null, new: { owner_user_id: w.owner_user_id, reviewer_user_id: w.reviewer_user_id } };
  }
  if (Object.keys(changed).length) await auditSetupRow(m, companyId, "topic_assignments", changed, caller.userId);
}

// ---------------------------------------------------------------------------
// /kpi/people/:user_id/topics
// ---------------------------------------------------------------------------

const PEOPLE_WRITERS = new Set<string>([UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.MANAGER]);

/** The person, if they belong to the company (another company's user: 404). */
async function companyPerson(m: EntityManager, companyId: number, userId: number) {
  const [u]: Row[] = await m.query(`SELECT user_id, role, ${nameSql("u")} AS name FROM "user" u WHERE user_id = $1`, [userId]);
  if (!u || u.role === UserRole.SUPERADMIN) throw new KpiError("KPI_NOT_FOUND", { user_id: userId });
  const companySites = await companySiteSet(m, companyId);
  const sites = [...(await userSiteIds(m, userId))].filter((s) => companySites.has(s)).sort((a, b) => a - b);
  if (!sites.length) throw new KpiError("KPI_NOT_FOUND", { user_id: userId });
  return { user_id: Number(u.user_id), role: String(u.role), name: (u.name as string | null) ?? null, sites, companySites };
}

export async function getPeopleTopics(caller: KpiCaller, userId: number) {
  const m = AppDataSource.manager;
  const p = await companyPerson(m, caller.companyId, userId);
  const self = caller.userId === userId;
  if (!self && !PEOPLE_WRITERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Admin", "Superadmin"] });
  if (!self && caller.role === UserRole.MANAGER && !p.sites.some((s) => caller.sites?.has(s))) throw new KpiError("KPI_NOT_FOUND", { user_id: userId });
  const rows: Row[] = await m.query(
    `SELECT t.site_id, t.topic, s.name AS site_name FROM kpi_topic_assignment t LEFT JOIN site s ON s.site_id = t.site_id WHERE t.company_id = $1 AND t.owner_user_id = $2`,
    [caller.companyId, userId],
  );
  const names: Row[] = await m.query(`SELECT site_id, name FROM site WHERE site_id = ANY($1::int[])`, [p.sites]);
  const nameOf = new Map(names.map((r) => [Number(r.site_id), String(r.name)]));
  const visible = (siteId: number | null) => siteId === null || caller.role !== UserRole.MANAGER || self || caller.sites?.has(siteId);
  const bySite = new Map<string, { site_id: number | null; site_name: string | null; topics: string[] }>();
  for (const s of p.sites) if (visible(s)) bySite.set(String(s), { site_id: s, site_name: nameOf.get(s) ?? null, topics: [] });
  for (const r of rows) {
    const siteId = r.site_id === null ? null : Number(r.site_id);
    if (!visible(siteId)) continue;
    const k = String(siteId ?? "company");
    const e = bySite.get(k) ?? { site_id: siteId, site_name: siteId === null ? "Company" : r.site_name ?? null, topics: [] as string[] };
    e.topics.push(r.topic);
    bySite.set(k, e);
  }
  const by_site = [...bySite.values()]
    .map((e) => ({ ...e, topics: sortTopics(e.topics) }))
    .sort((a, b) => (a.site_id === null ? -1 : b.site_id === null ? 1 : (a.site_name ?? "").localeCompare(b.site_name ?? "") || a.site_id - b.site_id));
  return { user_id: userId, topics: sortTopics(by_site.flatMap((e) => e.topics)), by_site };
}

export interface MovedNote {
  site_id: number;
  site_name: string | null;
  topic: string;
  topic_label: string;
  from_user_id: number;
  from_name: string | null;
}

/**
 * Makes the person the owner of `topics` on `site_ids` (default: all their
 * sites; a Manager: their sites among those) and removes them as owner of
 * any other topic on those sites. A slot owned by someone else moves; the
 * reviewer of a moved slot stays. Answers what moved, for the "Water at Noida
 * moved from Ravi to Priya" toast. Audited (`kpi_setup` `people_topics`).
 */
export async function putPeopleTopics(caller: KpiCaller, userId: number, raw: unknown) {
  if (!PEOPLE_WRITERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Admin", "Superadmin"] });
  const body = parse(KpiPeopleTopicsPutSchema, raw ?? {});
  const topics = sortTopics(body.topics);
  return AppDataSource.transaction(async (m) => {
    await m.query(`SELECT pg_advisory_xact_lock($1, $2)`, [KPI_TOPIC_LOCK_CLASS, caller.companyId]);
    const p = await companyPerson(m, caller.companyId, userId);
    const managerSites = caller.role === UserRole.MANAGER ? caller.sites ?? new Set<number>() : null;
    if (managerSites && !p.sites.some((s) => managerSites.has(s))) throw new KpiError("KPI_NOT_FOUND", { user_id: userId });
    let siteIds: number[];
    if (body.site_ids) {
      siteIds = [...new Set(body.site_ids)].sort((a, b) => a - b);
      for (const s of siteIds) {
        if (!p.companySites.has(s)) throw new KpiError("KPI_NOT_FOUND", { site_id: s });
        if (managerSites && !managerSites.has(s)) throw new KpiError("KPI_FORBIDDEN", { rule: "your_sites_only", site_id: s });
      }
    } else siteIds = managerSites ? p.sites.filter((s) => managerSites.has(s)) : p.sites;
    const person = personLookup(m);
    for (const s of siteIds) for (const t of topics) await assertTopicOwner(person, p.companySites, { site_id: s, owner_user_id: userId }, `site_ids.${s}`);

    const current: Row[] = siteIds.length
      ? await m.query(
          `SELECT t.id, t.site_id, t.topic, t.owner_user_id, t.reviewer_user_id, s.name AS site_name, ${nameSql("o")} AS owner_name
             FROM kpi_topic_assignment t JOIN site s ON s.site_id = t.site_id LEFT JOIN "user" o ON o.user_id = t.owner_user_id
            WHERE t.company_id = $1 AND t.site_id = ANY($2::int[])`,
          [caller.companyId, siteIds],
        )
      : [];
    const moved: MovedNote[] = [];
    const removed: Array<{ site_id: number; topic: string }> = [];
    const added: Array<{ site_id: number; topic: string }> = [];
    for (const s of siteIds) {
      for (const t of topics) {
        const c = current.find((r) => Number(r.site_id) === s && r.topic === t);
        if (c && Number(c.owner_user_id) === userId) continue;
        if (c) {
          moved.push({ site_id: s, site_name: c.site_name ?? null, topic: t, topic_label: topicLabel(t), from_user_id: Number(c.owner_user_id), from_name: c.owner_name ?? null });
          await dropEchoExceptions(m, caller.companyId, s, t, Number(c.owner_user_id), c.reviewer_user_id == null ? null : Number(c.reviewer_user_id));
          await m.query(`UPDATE kpi_topic_assignment SET owner_user_id = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [c.id, userId, caller.userId || null]);
        } else {
          await m.query(`INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id, updated_by) VALUES ($1, $2, $3, $4, $5)`, [caller.companyId, s, t, userId, caller.userId || null]);
        }
        added.push({ site_id: s, topic: t });
      }
      for (const c of current.filter((r) => Number(r.site_id) === s && Number(r.owner_user_id) === userId && !topics.includes(r.topic))) {
        await m.query(`DELETE FROM kpi_topic_assignment WHERE id = $1`, [c.id]);
        await dropEchoExceptions(m, caller.companyId, s, c.topic, userId, c.reviewer_user_id == null ? null : Number(c.reviewer_user_id));
        removed.push({ site_id: s, topic: c.topic });
      }
    }
    if (added.length || removed.length) {
      await auditSetupRow(m, caller.companyId, "people_topics", { [`user_${userId}`]: { old: { removed }, new: { added, site_ids: siteIds, topics } }, moved: moved.map((x) => ({ site_id: x.site_id, topic: x.topic, from_user_id: x.from_user_id })) }, caller.userId);
    }
    return { user_id: userId, topics, site_ids: siteIds, moved };
  });
}
