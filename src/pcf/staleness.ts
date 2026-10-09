// Staleness hook (E1, part 5). Spec: docs/pcf/foundation/E1-data-and-engine/CLAUDE.md ("Staleness").
//
// Called by the existing emission and production write paths after they
// change rows. A footprint in review, approved or published becomes stale when
//   - a row its result used changed (edited, re-reviewed or deleted), or
//   - a row it would now use was approved: approved Scope 1/2 emissions or
//     approved production at its site, inside its reference period.
// Its owner (the creator) gets a notification. Stored results are never
// recalculated here; a new version is the way to update them.
// Never throws: a failure here must not undo or fail the caller's write.
import { AppDataSource } from "../config/data-source";
import { createNotification } from "../services/notificationService";

type Kind = "emission" | "production";

const SQL: Record<Kind, string> = {
  emission: `
    UPDATE pcf_study s SET stale = true
     WHERE s.stale = false
       AND s.status IN ('in_review', 'approved', 'published')
       AND (
         EXISTS (SELECT 1 FROM pcf_result r WHERE r.pcf_study_id = s.pcf_study_id AND r.emission_ids_used && $1::int[])
         OR EXISTS (
           SELECT 1 FROM emission e JOIN category c ON c.category_id = e.category_id
            WHERE e.pk_id = ANY($1::int[]) AND e.status = 'approved' AND e.site_id = s.site_id
              AND c.scope ~ '[12]'
              AND e.date_of_reporting >= s.reference_start
              AND (CASE WHEN e.reporting_period = 'yearly'
                        THEN (e.date_of_reporting - INTERVAL '1 year' + INTERVAL '1 day')::date
                        ELSE e.date_of_reporting END) <= s.reference_end))
    RETURNING s.pcf_study_id, s.created_by, s.version, s.product_id`,
  production: `
    UPDATE pcf_study s SET stale = true
     WHERE s.stale = false
       AND s.status IN ('in_review', 'approved', 'published')
       AND (
         EXISTS (SELECT 1 FROM pcf_result r WHERE r.pcf_study_id = s.pcf_study_id AND r.production_ids_used && $1::int[])
         OR EXISTS (
           SELECT 1 FROM production_data p
            WHERE p.production_id = ANY($1::int[]) AND p.status = 'approved' AND p.site_id = s.site_id
              AND p.end_date >= s.reference_start AND p.start_date <= s.reference_end))
    RETURNING s.pcf_study_id, s.created_by, s.version, s.product_id`,
};

export async function pcfDataChanged(kind: Kind, ids: Array<number | null | undefined>): Promise<number[]> {
  const clean = Array.from(new Set(ids.filter((id): id is number => Number.isInteger(id))));
  if (!clean.length) return [];
  try {
    const raw = await AppDataSource.query(SQL[kind], [clean]);
    // node-postgres returns [rows, count] for UPDATE ... RETURNING through TypeORM
    const rows: { pcf_study_id: number; created_by: number | null; version: number; product_id: number }[] =
      Array.isArray(raw[0]) ? raw[0] : raw;
    if (!rows.length) return [];
    const names = new Map<number, string>(
      (await AppDataSource.query(`SELECT product_id, name FROM product WHERE product_id = ANY($1::int[])`, [rows.map((r) => r.product_id)])).map(
        (p: { product_id: number; name: string }) => [p.product_id, p.name],
      ),
    );
    const what = kind === "emission" ? "emissions" : "production data";
    for (const r of rows) {
      if (!r.created_by) continue;
      try {
        await createNotification(
          r.created_by,
          "pcf_stale",
          "A product footprint is out of date",
          `Approved ${what} behind the footprint for ${names.get(r.product_id) ?? "a product"} (version ${r.version}) changed. Its figures stay as they are; create a new version to update them.`,
          null,
        );
      } catch (err) {
        console.error("pcfDataChanged notify", err);
      }
    }
    return rows.map((r) => r.pcf_study_id);
  } catch (err) {
    console.error("pcfDataChanged", err);
    return [];
  }
}
