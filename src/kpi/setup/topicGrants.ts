/**
 * KPI-3 · the KPI topic grant on the company user update
 * (`PATCH /company-admin/users/:id {kpi_topics}`, Admin). Like `user_categories`
 * for emissions: a user with grants enters only KPIs of those topics on their
 * sites; no grants = every topic. Needs the company's KPI switch on.
 *
 *   parseKpiTopics(raw)                         the topics, or KPI_VALIDATION
 *   saveKpiTopics(company, user, topics, by)    replaces the user's grants, audited (`kpi_setup`)
 */
import { z } from "zod";
import { AppDataSource } from "../../config/data-source";
import { KpiTopicSchema, type KpiTopic } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { kpiTrackingEnabled } from "../guard";
import { parse } from "../http";

const TopicsSchema = z.array(KpiTopicSchema).max(20);

export const parseKpiTopics = (raw: unknown): KpiTopic[] => [...new Set(parse(TopicsSchema, raw))].sort();

export async function saveKpiTopics(companyId: number, userId: number, topics: KpiTopic[], changedBy: number): Promise<KpiTopic[]> {
  if (!(await kpiTrackingEnabled(companyId))) throw new KpiError("KPI_TRACKING_OFF");
  return AppDataSource.transaction(async (m) => {
    const before: string[] = (await m.query(`SELECT topic FROM kpi_topic_grant WHERE user_id = $1 ORDER BY topic`, [userId])).map((r: { topic: string }) => r.topic);
    await m.query(`DELETE FROM kpi_topic_grant WHERE user_id = $1 AND NOT (topic = ANY($2::text[]))`, [userId, topics]);
    for (const t of topics) await m.query(`INSERT INTO kpi_topic_grant (user_id, topic) VALUES ($1, $2) ON CONFLICT (user_id, topic) DO NOTHING`, [userId, t]);
    if (JSON.stringify(before) !== JSON.stringify(topics)) {
      await m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_setup', $1, 'topic_grant', $2, NULL, $3)`, [
        companyId,
        JSON.stringify({ [`user_${userId}`]: { old: before, new: topics } }),
        changedBy || null,
      ]);
    }
    return topics;
  });
}
