import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { factorsInLibrary } from "../scope3/review/service";

/**
 * F-15 (22 Oct 2026): pending rows saved before factor snapshots existed were
 * held by FACTOR_FOUND ("No factor for <year>") even when the site's factor
 * library had that year's factor. FACTOR_FOUND now reads the library for such
 * rows; this clears the stale hold on the rows saved before the change.
 *
 * Only FACTOR_FOUND moves, so the other stored checks are kept as they are
 * (recomputing every check of a few hundred thousand imported rows on start-up
 * is too slow). A FERA pair is one decision: the hold is cleared on a row only
 * when it and its pending partners all pass. Rows that still lack a factor
 * stay held, so a second run only looks at those and changes nothing.
 */
const BATCH = 1000;

type Row = {
  pk_id: number;
  site_id: number;
  category_id: number;
  date_of_reporting: string;
  activity_data: unknown;
  emission_factor_snapshot: { year: number; denominator_unit: string } | null;
  fera_linked_id: number | null;
  total_emission: string | null;
};

const SELECT_ROWS = `SELECT e.pk_id, e.site_id, e.category_id, to_char(e.date_of_reporting, 'YYYY-MM-DD') AS date_of_reporting,
                            e.activity_data, e.emission_factor_snapshot, e.fera_linked_id, e.total_emission
                       FROM emission e`;

async function main() {
  await AppDataSource.initialize();
  try {
    let cleared = 0;
    let failed = 0;
    // One scan for the candidates, then batches by id.
    const candidates: number[] = (
      await AppDataSource.query(
        `SELECT e.pk_id FROM emission e
          WHERE e.status = 'pending' AND e.emission_factor_snapshot IS NULL AND e.total_emission > 0 AND e.checks -> 'held' ? 'FACTOR_FOUND'
          ORDER BY e.pk_id`,
      )
    ).map((r: { pk_id: number }) => Number(r.pk_id));
    for (let i = 0; i < candidates.length; i += BATCH) {
      const after = candidates[Math.min(i + BATCH, candidates.length) - 1];
      const rows: Row[] = await AppDataSource.query(`${SELECT_ROWS} WHERE e.pk_id = ANY($1::bigint[]) AND e.status = 'pending'`, [
        candidates.slice(i, i + BATCH),
      ]);
      if (!rows.length) continue;
      try {
        const ids = rows.map((r) => Number(r.pk_id));
        // Pending FERA partners (either direction) decide with the row.
        const partners: Row[] = await AppDataSource.query(
          `${SELECT_ROWS}
            WHERE e.status = 'pending' AND e.pk_id <> ALL($1::bigint[])
              AND (e.pk_id IN (SELECT fera_linked_id FROM emission WHERE pk_id = ANY($1::bigint[])) OR e.fera_linked_id = ANY($1::bigint[]))`,
          [ids],
        );
        const all = [...rows, ...partners].map((r) => ({ ...r, pk_id: Number(r.pk_id), site_id: Number(r.site_id), category_id: Number(r.category_id) }));
        const inLibrary = await factorsInLibrary(AppDataSource.manager, all);
        const factorOk = (r: (typeof all)[number]) =>
          r.emission_factor_snapshot ? Number(r.emission_factor_snapshot.year) === Number(r.date_of_reporting.slice(0, 4)) - 1 : inLibrary.has(r.pk_id);
        const byId = new Map(all.map((r) => [r.pk_id, r]));
        const ok = rows
          .map((r) => Number(r.pk_id))
          .filter((id) => {
            const row = byId.get(id)!;
            const pair = all.filter((p) => p.pk_id === row.fera_linked_id || Number(p.fera_linked_id) === id);
            return factorOk(row) && pair.every(factorOk);
          });
        if (ok.length) {
          // TypeORM returns [rows, count] for an UPDATE … RETURNING on Postgres.
          const result: unknown = await AppDataSource.query(
            `UPDATE emission e
                SET checks = jsonb_build_object('held', h.held, 'ready', jsonb_array_length(h.held) = 0)
               FROM (SELECT x.pk_id, COALESCE(jsonb_agg(v) FILTER (WHERE v <> '"FACTOR_FOUND"'), '[]'::jsonb) AS held
                       FROM emission x, jsonb_array_elements(x.checks -> 'held') v
                      WHERE x.pk_id = ANY($1::bigint[])
                      GROUP BY x.pk_id) h
              WHERE e.pk_id = h.pk_id AND e.status = 'pending'
              RETURNING e.pk_id`,
            [ok],
          );
          cleared += Array.isArray(result) && Array.isArray(result[0]) ? result[0].length : Array.isArray(result) ? result.length : 0;
        }
      } catch (error) {
        failed += rows.length;
        console.error(`factor check backfill: batch ending ${after} skipped (${(error as { code?: string }).code ?? (error as Error).name})`);
      }
    }
    console.log(`review checks: "No factor" cleared on ${cleared} pending row(s) whose factor is in the library${failed ? `, ${failed} skipped (see errors above)` : ""}.`);
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
