// S3-15 part 1 (docs/scope3/modules/S3-15-review-workflow/CLAUDE.md):
//
//   emission.checks   jsonb, nullable   ({ready, held: CheckId[]})
//   index on emission (site_id, category_id, date_of_reporting, pk_id) for NO_DUPLICATE
//   index on emission (fera_linked_id) for FERA partners
//
//   npm run migrate:scope3-review-checks
//
// Adds the column (matches what TypeORM generates for Emission.checks) and
// computes the checks of pending rows that have none, 1,000 rows at a time.
// Idempotent and additive: it only picks rows with no checks, so a second run
// only fills rows a first run missed. A batch that fails on data is logged
// and skipped; the script still exits 0 once the column exists.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { computeChecksFor } from "../scope3/review/service";

export const REVIEW_CHECKS_STATEMENTS = [
  `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "checks" jsonb`,
  // NO_DUPLICATE looks up the first counted row on the same site, category and date (review/service.ts).
  `CREATE INDEX IF NOT EXISTS "IDX_emission_site_category_date" ON "emission" ("site_id", "category_id", "date_of_reporting", "pk_id")`,
  // FERA partners are found through fera_linked_id in both directions (review/service.ts pendingPartners).
  `CREATE INDEX IF NOT EXISTS "IDX_emission_fera_linked_id" ON "emission" ("fera_linked_id")`,
];

const BATCH = 1000;

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of REVIEW_CHECKS_STATEMENTS) await AppDataSource.query(sql);
    let after = 0;
    let filled = 0;
    let failed = 0;
    for (;;) {
      const rows: Array<{ pk_id: number }> = await AppDataSource.query(
        `SELECT pk_id FROM emission WHERE status = 'pending' AND checks IS NULL AND pk_id > $1 ORDER BY pk_id LIMIT ${BATCH}`,
        [after],
      );
      if (!rows.length) break;
      const batch = rows.map((r) => Number(r.pk_id));
      after = batch[batch.length - 1];
      // One batch's data error is logged (ids only) and skipped: this runs on
      // every start, and a bad row must never stop the API from starting.
      try {
        const computed = await computeChecksFor(AppDataSource.manager, batch);
        const entries = [...computed.entries()];
        if (entries.length) {
          // Partners of a FERA pair outside this batch get the pair's checks too.
          await AppDataSource.query(
            `UPDATE emission e SET checks = v.checks
               FROM (SELECT unnest($1::bigint[]) AS pk_id, unnest($2::jsonb[]) AS checks) v
              WHERE e.pk_id = v.pk_id AND e.status = 'pending'`,
            [entries.map(([id]) => id), entries.map(([, c]) => JSON.stringify(c))],
          );
        }
        filled += entries.length;
      } catch (error) {
        failed += batch.length;
        console.error(`checks backfill: batch ${batch[0]}..${after} skipped (${(error as { code?: string }).code ?? (error as Error).name})`);
      }
    }
    console.log(`emission.checks present; ${filled} pending row(s) given checks${failed ? `, ${failed} skipped (see errors above)` : ""}.`);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
