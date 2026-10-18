/**
 * KPI-8 · review notifications (01-contracts §3, notification kinds):
 *
 *   notifySubmitted(company, valueIds, submitter)   `kpi_submitted`, one per reviewer per submit:
 *                                                   the resolved owner row's reviewer (D17: per-KPI
 *                                                   override, else topic assignment), else the Managers of
 *                                                   the value's site (company level: the company's
 *                                                   Managers); never the submitter
 *   notifyRejected(company, rejected, reason)       `kpi_rejected` to whoever entered each value,
 *                                                   one per person, with the reason
 *
 * Both are best effort: a failed notification is logged (ids only) and never
 * fails the submit or the review.
 */
import { AppDataSource } from "../../config/data-source";
import { createNotification } from "../../services/notificationService";
import { ownerIndex } from "../setup/owners";

type Row = Record<string, any>;

export const REVIEW_LINK = "/data/approvals?view=kpi";

/** Managers of a site (their own site or through user_sites), or of every site of the company when `siteId` is null. */
async function managersOf(companyId: number, siteId: number | null): Promise<number[]> {
  const rows: Row[] = await AppDataSource.query(
    `SELECT DISTINCT u.user_id FROM "user" u
       LEFT JOIN user_sites us ON us.user_id = u.user_id
       JOIN site s ON s.site_id IN (u.site_id, us.site_id)
      WHERE u.role = 'Manager' AND s.company_id = $1 AND ($2::int IS NULL OR s.site_id = $2)
      ORDER BY u.user_id`,
    [companyId, siteId],
  );
  return rows.map((r) => Number(r.user_id));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function notifySubmitted(companyId: number, valueIds: number[], submitterId: number): Promise<number> {
  if (!valueIds.length) return 0;
  try {
    const rows: Row[] = await AppDataSource.query(
      `SELECT v.id, v.site_id, v.kpi_definition_id, d.topic FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id
        WHERE v.company_id = $1 AND v.id = ANY($2::int[])`,
      [companyId, valueIds],
    );
    // D17: the reviewer of the resolved owner row (per-KPI override, else the topic's).
    const owners = await ownerIndex(AppDataSource.manager, companyId);
    const values: Row[] = rows.map((v) => ({ ...v, reviewer_user_id: owners.resolve({ id: Number(v.kpi_definition_id), topic: String(v.topic) }, v.site_id === null ? null : Number(v.site_id)).reviewer_user_id }));
    const perReviewer = new Map<number, number>();
    const managersCache = new Map<string, number[]>();
    for (const v of values) {
      let reviewers: number[];
      if (v.reviewer_user_id) reviewers = [Number(v.reviewer_user_id)];
      else {
        const key = String(v.site_id ?? "company");
        if (!managersCache.has(key)) managersCache.set(key, await managersOf(companyId, v.site_id === null ? null : Number(v.site_id)));
        reviewers = managersCache.get(key)!;
      }
      for (const r of reviewers) if (r !== submitterId) perReviewer.set(r, (perReviewer.get(r) ?? 0) + 1);
    }
    for (const [userId, n] of perReviewer) {
      try {
        await createNotification(userId, "kpi_submitted", "KPI values to review", `${plural(n, "KPI value was", "KPI values were")} sent for your review.`, REVIEW_LINK);
      } catch (err) {
        console.error(`[kpi] kpi_submitted notification failed (company ${companyId}, user ${userId}):`, (err as Error)?.message);
      }
    }
    return perReviewer.size;
  } catch (err) {
    console.error(`[kpi] kpi_submitted notifications failed (company ${companyId}):`, (err as Error)?.message);
    return 0;
  }
}

export async function notifyRejected(companyId: number, rejected: Array<{ id: number; entered_by: number | null }>, reason: string, reviewer: string | null): Promise<number> {
  const perOwner = new Map<number, number>();
  for (const r of rejected) if (r.entered_by) perOwner.set(r.entered_by, (perOwner.get(r.entered_by) ?? 0) + 1);
  for (const [userId, n] of perOwner) {
    try {
      await createNotification(
        userId,
        "kpi_rejected",
        n === 1 ? "A KPI value was sent back" : `${n} KPI values were sent back`,
        `Please fix and resubmit: ${reason}`,
        "/kpi",
        { reviewer: reviewer ?? undefined, reason },
      );
    } catch (err) {
      console.error(`[kpi] kpi_rejected notification failed (company ${companyId}, user ${userId}):`, (err as Error)?.message);
    }
  }
  return perOwner.size;
}
