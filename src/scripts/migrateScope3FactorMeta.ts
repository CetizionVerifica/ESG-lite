// S3-2 · factor metadata (docs/scope3/01-contracts.md §2):
//
//   emission_factors.factor_type, gwp_set, geography, dataset, dataset_version,
//   co2_kg, ch4_kg, n2o_kg, other_kgco2e, biogenic_co2_kg, includes_wtt,
//   price_base_year, price_currency; factor_value widened to numeric(18,8).
//
//   npm run migrate:scope3-factor-meta
//
// Idempotent: columns are added IF NOT EXISTS, the widening runs only while
// the column is still narrower, and the backfill only writes rows whose
// factor_type is still NULL (1,000 at a time), so a factor someone typed
// later is never overwritten. Statements match what TypeORM generates for
// EmissionFactor, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { backfillMeta } from "../scope3/factors/backfill";

export const FACTOR_META_COLUMNS = [
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "factor_type" character varying(20)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "gwp_set" character varying(8)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "geography" character varying(16)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "dataset" character varying(60)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "dataset_version" character varying(40)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "co2_kg" numeric(18,8)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "ch4_kg" numeric(18,8)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "n2o_kg" numeric(18,8)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "other_kgco2e" numeric(18,8)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "biogenic_co2_kg" numeric(18,8)`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "includes_wtt" boolean NOT NULL DEFAULT false`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "price_base_year" integer`,
  `ALTER TABLE "emission_factors" ADD COLUMN IF NOT EXISTS "price_currency" character varying(3)`,
];

// data-loss-reviewed: widening numeric(10,4) to numeric(18,8) keeps every stored value exactly (10,4 holds at most 6 integer digits; 18,8 holds 10), it only adds decimals.
const WIDEN_FACTOR_VALUE = `ALTER TABLE "emission_factors" ALTER COLUMN "factor_value" TYPE numeric(18,8)`;

const BATCH = 1000;

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of FACTOR_META_COLUMNS) await AppDataSource.query(sql);

    const [col] = await AppDataSource.query(
      `SELECT numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'emission_factors' AND column_name = 'factor_value'`,
    );
    if (col && (Number(col.numeric_precision) < 18 || Number(col.numeric_scale) < 8)) {
      await AppDataSource.query(WIDEN_FACTOR_VALUE);
      console.log("emission_factors.factor_value widened to numeric(18,8).");
    }
    console.log("emission_factors S3-2 metadata columns present.");

    // Backfill factor_type (and, on the same rows, includes_wtt, gwp_set and
    // dataset from the source text). Rows that already have a type are left
    // alone, so re-runs and later edits are safe.
    let updated = 0;
    let lastId = 0;
    for (;;) {
      const rows: { id: number; category_name: string | null; scope: string | null; denominator_unit: string | null; source: string | null }[] =
        await AppDataSource.query(
          `SELECT ef.emission_factor_id AS id, c.category_name, c.scope, ef.denominator_unit, ef.source
             FROM emission_factors ef
             LEFT JOIN category c ON c.category_id = ef.category_id
            WHERE ef.factor_type IS NULL AND ef.emission_factor_id > $1
            ORDER BY ef.emission_factor_id
            LIMIT ${BATCH}`,
          [lastId],
        );
      if (!rows.length) break;
      lastId = rows[rows.length - 1].id;

      // One UPDATE per distinct result, not per row.
      const groups = new Map<string, { meta: ReturnType<typeof backfillMeta>; ids: number[] }>();
      for (const r of rows) {
        const meta = backfillMeta(r);
        const key = JSON.stringify(meta);
        const g = groups.get(key) ?? { meta, ids: [] };
        g.ids.push(r.id);
        groups.set(key, g);
      }
      for (const { meta, ids } of groups.values()) {
        await AppDataSource.query(
          `UPDATE emission_factors
              SET factor_type = $1,
                  includes_wtt = includes_wtt OR $2,
                  gwp_set = COALESCE(gwp_set, $3),
                  dataset = COALESCE(dataset, $4)
            WHERE emission_factor_id = ANY($5) AND factor_type IS NULL`,
          [meta.factor_type, meta.includes_wtt, meta.gwp_set, meta.dataset, ids],
        );
        updated += ids.length;
      }
    }
    console.log(`emission_factors.factor_type backfilled on ${updated} factor(s).`);
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
