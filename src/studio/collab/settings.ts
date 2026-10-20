/**
 * DS-13 · review settings of the caller's company.
 *
 *   GET /review-settings   R   ReviewSettings
 *   PUT /review-settings   {requireReview?} Manager or Superadmin · {brandControls?} Superadmin only
 *
 * `report_require_review` (D14): a final needs an approval for the current rev.
 * `brand_controls` (DS-13 §5): colour and font pickers limited to the brand kit (DS-3's
 * `BrandKit.brandControls`), and template-locked elements stay locked for Admins (locks.ts).
 * Every change writes an audit_log row (`design_studio`, action `review_settings`).
 */
import { AppDataSource } from "../../config/data-source";
import { DsError, ReviewSettingsBodySchema, type ReviewSettings } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";

type Row = Record<string, any>;

export async function getReviewSettings(caller: StudioCaller): Promise<ReviewSettings> {
  const [r]: Row[] = await AppDataSource.query(`SELECT report_require_review, brand_controls FROM company WHERE company_id = $1`, [caller.companyId]);
  return {
    requireReview: r?.report_require_review === true,
    brandControls: r?.brand_controls === true,
    canEditRequireReview: caller.roleClass === "M",
    canEditBrandControls: caller.role === "Superadmin",
  };
}

export async function putReviewSettings(caller: StudioCaller, rawBody: unknown): Promise<ReviewSettings> {
  const b = parse(ReviewSettingsBodySchema, rawBody ?? {});
  if (b.requireReview !== undefined && caller.roleClass !== "M") throw new DsError("DS_ROLE", { reason: "Only a Manager can require approval before finals" });
  if (b.brandControls !== undefined && caller.role !== "Superadmin") throw new DsError("DS_ROLE", { reason: "Only a Superadmin can change brand controls" });
  const before = await getReviewSettings(caller);
  const changes: Record<string, { old: boolean; new: boolean }> = {};
  if (b.requireReview !== undefined && b.requireReview !== before.requireReview) changes.report_require_review = { old: before.requireReview, new: b.requireReview };
  if (b.brandControls !== undefined && b.brandControls !== before.brandControls) changes.brand_controls = { old: before.brandControls, new: b.brandControls };
  if (Object.keys(changes).length) {
    await AppDataSource.transaction(async (m) => {
      if (changes.report_require_review) await m.query(`UPDATE company SET report_require_review = $1 WHERE company_id = $2`, [changes.report_require_review.new, caller.companyId]);
      if (changes.brand_controls) await m.query(`UPDATE company SET brand_controls = $1 WHERE company_id = $2`, [changes.brand_controls.new, caller.companyId]);
      await m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('design_studio', $1, 'review_settings', $2, NULL, $3)`, [
        caller.companyId,
        JSON.stringify(changes),
        caller.userId || null,
      ]);
    });
  }
  return getReviewSettings(caller);
}
