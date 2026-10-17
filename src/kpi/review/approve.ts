/**
 * KPI-8 · approve and reject (01-contracts §3, D11).
 *
 *   PUT /kpi/values/approve {ids, only_ready?}   pending → approved
 *   PUT /kpi/values/reject  {ids, reason}        pending or approved → rejected (sent back)
 *   → {updated: [ids], refused: [{id, code}]}
 *
 * Who: a Manager (values of their sites, and company-level values) or the
 * Superadmin. Admins and Users can't review (403 KPI_FORBIDDEN for the whole
 * request). Reject needs a reason (400 KPI_REASON_REQUIRED). Per id, in its own
 * transaction under the KPI lease (so a period lock waits for it):
 *   not visible / another company      KPI_NOT_FOUND
 *   auto or calculated                 KPI_AUTO_READ_ONLY (they follow their source)
 *   not pending (approve)              KPI_NOT_PENDING; reject takes pending or approved
 *   the caller entered it              KPI_SELF_REVIEW (a Superadmin may, as for emissions)
 *   in a locked period                 KPI_PERIOD_LOCKED
 *   only_ready and a check holds it    KPI_NOT_READY (checks are recomputed first)
 * Each change is audited (`approve` / `reject`, the reason on reject). Then the
 * KPI-6 dependants recompute (`recomputeForValues`), and a reject notifies
 * whoever entered the value (`kpi_rejected`).
 */
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { KpiError, type KpiErrorCode } from "../contracts/errors";
import { KpiReviewSchema } from "../contracts/schemas";
import type { KpiCaller } from "../guard";
import { parse } from "../http";
import { recomputeForValues } from "../formulas/recompute";
import { auditValue, holdKpiLease, loadVisibleValue, lockedPeriod } from "../values/service";
import { isoDay } from "../values/period";
import { storeChecks } from "./checks";
import { notifyRejected } from "./notify";

type Row = Record<string, any>;

export const REVIEW_ROLES = new Set<string>([UserRole.MANAGER, UserRole.SUPERADMIN]);

export type ReviewAction = "approve" | "reject";

export interface ReviewResult {
  updated: number[];
  refused: Array<{ id: number; code: KpiErrorCode }>;
}

export function assertReviewer(caller: KpiCaller): void {
  if (!REVIEW_ROLES.has(caller.role)) throw new KpiError("KPI_FORBIDDEN", { allowed: ["Manager", "Superadmin"] });
}

export async function reviewValues(caller: KpiCaller, action: ReviewAction, body: unknown): Promise<ReviewResult> {
  assertReviewer(caller);
  const input = parse(KpiReviewSchema, body ?? {});
  const reason = (input.reason ?? "").trim();
  if (action === "reject" && !reason) throw new KpiError("KPI_REASON_REQUIRED", { field: "reason" });

  const updated: number[] = [];
  const refused: ReviewResult["refused"] = [];
  const rejected: Array<{ id: number; entered_by: number | null }> = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      const v = await AppDataSource.transaction(async (m) => {
        await holdKpiLease(m, caller.companyId);
        const row: Row = await loadVisibleValue(m, caller, id);
        if (row.source !== "manual") throw new KpiError("KPI_AUTO_READ_ONLY");
        const allowed = action === "approve" ? ["pending"] : ["pending", "approved"];
        if (!allowed.includes(row.status)) throw new KpiError("KPI_NOT_PENDING", { status: row.status });
        if (caller.role !== UserRole.SUPERADMIN && Number(row.entered_by) === caller.userId) throw new KpiError("KPI_SELF_REVIEW");
        const site = row.site_id === null ? null : Number(row.site_id);
        if (await lockedPeriod(m, caller.companyId, site, { start: isoDay(row.period_start)!, end: isoDay(row.period_end)! })) throw new KpiError("KPI_PERIOD_LOCKED");
        const checks = await storeChecks(m, id);
        if (action === "approve" && input.only_ready && !checks?.ready) throw new KpiError("KPI_NOT_READY", { held: checks?.held ?? [] });
        const next = action === "approve" ? "approved" : "rejected";
        await m.query(
          `UPDATE kpi_value SET status = $2, reviewed_by = $3, reviewed_at = now(), review_comment = $4, updated_at = now() WHERE id = $1`,
          [id, next, caller.userId || null, action === "reject" ? reason : null],
        );
        await auditValue(m, id, action, { status: { old: row.status, new: next } }, caller.userId, action === "reject" ? reason : null);
        return row;
      });
      updated.push(id);
      if (action === "reject") rejected.push({ id, entered_by: v.entered_by === null ? null : Number(v.entered_by) });
    } catch (err) {
      if (!(err instanceof KpiError)) throw err;
      refused.push({ id, code: err.code });
    }
  }
  if (updated.length) await recomputeForValues(caller.companyId, updated);
  if (rejected.length) {
    const [me]: Row[] = await AppDataSource.query(`SELECT TRIM(CONCAT(COALESCE(name, ''), ' ', COALESCE(last_name, ''))) AS name FROM "user" WHERE user_id = $1`, [caller.userId]);
    await notifyRejected(caller.companyId, rejected, reason, me?.name || null);
  }
  return { updated, refused: refused.sort((a, b) => a.id - b.id) };
}
