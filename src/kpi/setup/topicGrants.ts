/**
 * The KPI topics field on the company user update (wave B
 * `PATCH /company-admin/users/:id {kpi_topics}`, Admin; and since D18 the same
 * field on the Superadmin's `PATCH /admin/users/:id`). Since D17 (wave D) it is
 * a thin alias of `PUT /kpi/people/:user_id/topics {topics}` (topics.ts): the
 * person becomes the owner of those topics on all their sites and stops owning
 * any other topic there. `kpi_topic_grant` is no longer written. Needs the
 * company's KPI switch on.
 *
 *   parseKpiTopics(raw)                                   the topics, or KPI_VALIDATION
 *   saveKpiTopics(company, user, topics, by, role, m?)    → {topics, site_ids, moved}
 */
import type { EntityManager } from "typeorm";
import { z } from "zod";
import { UserRole } from "../../types/type";
import { KpiTopicSchema, type KpiTopic } from "../contracts/enums";
import { KpiError } from "../contracts/errors";
import { callerSites, kpiTrackingEnabled } from "../guard";
import { parse } from "../http";
import { putPeopleTopics, sortTopics } from "./topics";

const TopicsSchema = z.array(KpiTopicSchema).max(20);

export const parseKpiTopics = (raw: unknown): KpiTopic[] => sortTopics(parse(TopicsSchema, raw));

export async function assertKpiSwitchOn(companyId: number): Promise<void> {
  if (!(await kpiTrackingEnabled(companyId))) throw new KpiError("KPI_TRACKING_OFF");
}

export async function saveKpiTopics(companyId: number, userId: number, topics: KpiTopic[], changedBy: number, role: string = UserRole.ADMIN, manager?: EntityManager) {
  await assertKpiSwitchOn(companyId);
  const caller = { companyId, userId: changedBy, role, sites: await callerSites(changedBy, role, companyId) };
  return putPeopleTopics(caller, userId, { topics }, manager);
}
