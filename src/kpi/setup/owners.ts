/**
 * D17 · who owns a KPI × site (or the company, site null): the ONE resolver
 * every module uses (My KPIs, the write rule, submit notifications, reminders,
 * invite, dashboard gaps and remind, the lock's "left" list, expected sites).
 *
 *   1. an explicit `kpi_assignment` row for that KPI × site (a per-KPI override);
 *   2. otherwise the `kpi_topic_assignment` for (site, the KPI's topic);
 *   3. otherwise nobody (unassigned).
 *
 * The reviewer comes from the same row (null = the site's Managers).
 * `kpi_topic_grant` is no longer read (wave D): topics come from topic assignments.
 *
 *   ownerIndex(m, company)            loads both tables once; `resolve(kpi, site)` is then pure
 *   resolveOwner(m, company, kpi, s)  one lookup
 */
import type { EntityManager } from "typeorm";

type Row = Record<string, any>;

export type OwnerVia = "kpi" | "topic" | null;

export interface ResolvedOwner {
  owner_user_id: number | null;
  owner_name: string | null;
  reviewer_user_id: number | null;
  reviewer_name: string | null;
  /** Which path gave the owner: the per-KPI override, the topic, or nothing. */
  via: OwnerVia;
}

export interface KpiRef {
  id: number | string;
  topic: string;
}

const NOBODY: ResolvedOwner = { owner_user_id: null, owner_name: null, reviewer_user_id: null, reviewer_name: null, via: null };

const nameSql = (alias: string) => `NULLIF(TRIM(CONCAT(COALESCE(${alias}.name, ''), ' ', COALESCE(${alias}.last_name, ''))), '')`;

export interface OwnerIndex {
  resolve(kpi: KpiRef, siteId: number | null): ResolvedOwner;
  /** The per-KPI override row, if any (the "Different from topic owner" marker reads it). */
  override(kpiId: number, siteId: number | null): ResolvedOwner | null;
  /** The topic owner of (site, topic), if any. */
  topicOwner(topic: string, siteId: number | null): ResolvedOwner | null;
  /** Every (KPI, site) pair of `kpis` × `sites` (null = company level for company KPIs) that has an owner. */
  ownedPairs(kpis: Array<KpiRef & { level: string }>, sites: number[]): Array<{ kpi_definition_id: number; site_id: number | null }>;
}

const key = (a: number | string, s: number | null) => `${a}|${s ?? ""}`;

const toOwner = (r: Row, via: OwnerVia): ResolvedOwner => ({
  owner_user_id: Number(r.owner_user_id),
  owner_name: r.owner_name ?? null,
  reviewer_user_id: r.reviewer_user_id === null || r.reviewer_user_id === undefined ? null : Number(r.reviewer_user_id),
  reviewer_name: r.reviewer_name ?? null,
  via,
});

export async function ownerIndex(m: EntityManager, companyId: number): Promise<OwnerIndex> {
  const perKpi: Row[] = await m.query(
    `SELECT a.kpi_definition_id, a.site_id, a.owner_user_id, a.reviewer_user_id, ${nameSql("o")} AS owner_name, ${nameSql("r")} AS reviewer_name
       FROM kpi_assignment a LEFT JOIN "user" o ON o.user_id = a.owner_user_id LEFT JOIN "user" r ON r.user_id = a.reviewer_user_id
      WHERE a.company_id = $1`,
    [companyId],
  );
  const perTopic: Row[] = await m.query(
    `SELECT t.topic, t.site_id, t.owner_user_id, t.reviewer_user_id, ${nameSql("o")} AS owner_name, ${nameSql("r")} AS reviewer_name
       FROM kpi_topic_assignment t LEFT JOIN "user" o ON o.user_id = t.owner_user_id LEFT JOIN "user" r ON r.user_id = t.reviewer_user_id
      WHERE t.company_id = $1`,
    [companyId],
  );
  const byKpi = new Map(perKpi.map((r) => [key(Number(r.kpi_definition_id), r.site_id === null ? null : Number(r.site_id)), toOwner(r, "kpi")]));
  const byTopic = new Map(perTopic.map((r) => [key(String(r.topic), r.site_id === null ? null : Number(r.site_id)), toOwner(r, "topic")]));
  const resolve = (kpi: KpiRef, siteId: number | null) => byKpi.get(key(Number(kpi.id), siteId)) ?? byTopic.get(key(String(kpi.topic), siteId)) ?? NOBODY;
  return {
    resolve,
    override: (kpiId, siteId) => byKpi.get(key(kpiId, siteId)) ?? null,
    topicOwner: (topic, siteId) => byTopic.get(key(topic, siteId)) ?? null,
    ownedPairs: (kpis, sites) => {
      const out: Array<{ kpi_definition_id: number; site_id: number | null }> = [];
      for (const k of kpis) {
        for (const s of k.level === "company" ? [null] : sites) if (resolve(k, s).owner_user_id !== null) out.push({ kpi_definition_id: Number(k.id), site_id: s });
      }
      return out;
    },
  };
}

export async function resolveOwner(m: EntityManager, companyId: number, kpi: KpiRef, siteId: number | null): Promise<ResolvedOwner> {
  const [a]: Row[] = await m.query(
    `SELECT a.owner_user_id, a.reviewer_user_id, ${nameSql("o")} AS owner_name, ${nameSql("r")} AS reviewer_name
       FROM kpi_assignment a LEFT JOIN "user" o ON o.user_id = a.owner_user_id LEFT JOIN "user" r ON r.user_id = a.reviewer_user_id
      WHERE a.company_id = $1 AND a.kpi_definition_id = $2 AND a.site_id IS NOT DISTINCT FROM $3`,
    [companyId, Number(kpi.id), siteId],
  );
  if (a) return toOwner(a, "kpi");
  const [t]: Row[] = await m.query(
    `SELECT t.owner_user_id, t.reviewer_user_id, ${nameSql("o")} AS owner_name, ${nameSql("r")} AS reviewer_name
       FROM kpi_topic_assignment t LEFT JOIN "user" o ON o.user_id = t.owner_user_id LEFT JOIN "user" r ON r.user_id = t.reviewer_user_id
      WHERE t.company_id = $1 AND t.topic = $2 AND t.site_id IS NOT DISTINCT FROM $3`,
    [companyId, String(kpi.topic), siteId],
  );
  return t ? toOwner(t, "topic") : NOBODY;
}
