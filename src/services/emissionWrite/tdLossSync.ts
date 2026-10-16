/**
 * S3-7 · keeps a Scope 2 row's T&D-loss twin (3c) in step after an edit of
 * its parent (user edit and manager edit). The upstream twin (3a/3b) keeps
 * going through the controller's recalculateLinkedFera, which never picks a
 * 3c twin. Non-fatal: the parent edit is already saved.
 *
 *   twin exists, factor applies    → new total, snapshot, data, date, unit;
 *                                    review state copied from the parent
 *   twin exists, no factor applies → total 0, no snapshot, back to Pending
 *                                    with a note saying why
 *   no twin, factor applies        → created, as a new entry would get it,
 *                                    unless the FERA category is mode-locked
 *                                    for the period (prepareEntry's rule)
 */
import { AppDataSource } from "../../config/data-source";
import { Emission, EmissionStatus } from "../../entities/Emission";
import { ContextCache } from "./context";
import { factorSnapshot } from "./compute";
import { targetYearFor } from "./resolve";
import { tdLossTwinFor } from "./methods/fera";
import { findModeLockConflict } from "../reportingPeriod";

export const syncTdLossTwin = async (parent: Emission, activity_data: Record<string, any> | null | undefined): Promise<Emission | null> => {
  try {
    const repo = AppDataSource.getRepository(Emission);
    const site_id = parent.site?.site_id;
    const category_id = parent.category?.category_id;
    if (!site_id || !category_id) return null;
    const existing = await repo.findOne({ where: { fera_linked_id: parent.pk_id, scope3_sub: "3c_td_losses" } });
    const ctx = await new ContextCache(AppDataSource.manager).context(site_id, category_id);
    const twin = activity_data?.emission_category
      ? tdLossTwinFor(ctx, activity_data.emission_category, { ...activity_data }, parent.activity_data_unit, targetYearFor(parent.date_of_reporting))
      : null;
    if (!existing && !twin) return null;
    if (!existing && twin) {
      // A new twin respects the lock on its own category, as a new entry's twins do.
      const conflict = await findModeLockConflict(repo, {
        site_id,
        category_id: twin.category_id,
        reporting_period: parent.reporting_period,
        year_type: parent.year_type,
        date_of_reporting: new Date(parent.date_of_reporting),
      });
      if (conflict) return null;
    }

    const row =
      existing ??
      repo.create({
        site: { site_id },
        category: { category_id: twin!.category_id },
        unit: "tCO2e",
        reporting_period: parent.reporting_period,
        year_type: parent.year_type,
        created_by: parent.created_by ?? null,
        upload_batch_id: parent.upload_batch_id ?? undefined,
        fera_linked_id: parent.pk_id,
        scope3_sub: "3c_td_losses",
      } as Partial<Emission>);
    row.activity_data = activity_data ?? {};
    row.date_of_reporting = parent.date_of_reporting;
    row.activity_data_unit = parent.activity_data_unit;
    if (twin) {
      row.total_emission = twin.total;
      row.emission_factor_snapshot = factorSnapshot(twin.factor) as any;
      row.status = parent.status;
      row.reviewed_by = parent.reviewed_by ?? (null as any);
      row.reviewed_at = parent.reviewed_at ?? (null as any);
      row.review_comment = parent.review_comment ?? (null as any);
    } else {
      row.total_emission = 0;
      row.emission_factor_snapshot = null as any;
      row.status = EmissionStatus.PENDING;
      row.reviewed_by = null as any;
      row.reviewed_at = null as any;
      row.review_comment = "Not recalculated: no T&D-loss factor applies to the edited entry. Check and edit this entry." as any;
    }
    return await repo.save(row);
  } catch (err) {
    console.error(`T&D-loss twin sync failed for emission ${parent.pk_id}:`, err);
    return null;
  }
};
