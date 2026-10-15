// S3-15 part 1 (docs/scope3/modules/S3-15-review-workflow/CLAUDE.md):
//
//   emission.checks   jsonb, nullable   ({ready, held: CheckId[]})
//
//   npm run migrate:scope3-review-checks
//
// Adds the column (matches what TypeORM generates for Emission.checks) and
// computes the checks of pending rows that have none, 1,000 rows at a time.
// Idempotent and additive: rows that already carry checks are skipped, so a
// second run only fills rows a first run missed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { computeChecksFor } from "../scope3/review/service";

export const REVIEW_CHECKS_STATEMENTS = [`ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "checks" jsonb`];

const BATCH = 1000;

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of REVIEW_CHECKS_STATEMENTS) await AppDataSource.query(sql);
    let after = 0;
    let filled = 0;
    for (;;) {
      const rows: Array<{ pk_id: number }> = await AppDataSource.query(
        `SELECT pk_id FROM emission WHERE status = 'pending' AND checks IS NULL AND pk_id > $1 ORDER BY pk_id LIMIT ${BATCH}`,
        [after],
      );
      if (!rows.length) break;
      const batch = rows.map((r) => Number(r.pk_id));
      after = batch[batch.length - 1];
      const computed = await computeChecksFor(AppDataSource.manager, batch);
      const entries = [...computed.entries()];
      if (entries.length) {
        await AppDataSource.query(
          `UPDATE emission e SET checks = v.checks
             FROM (SELECT unnest($1::int[]) AS pk_id, unnest($2::jsonb[]) AS checks) v
            WHERE e.pk_id = v.pk_id AND e.checks IS NULL`,
          [entries.map(([id]) => id), entries.map(([, c]) => JSON.stringify(c))],
        );
      }
      filled += entries.length;
    }
    console.log(`emission.checks present; ${filled} pending row(s) given checks.`);
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
