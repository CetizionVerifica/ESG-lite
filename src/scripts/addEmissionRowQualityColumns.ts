// S3-3 · Adds the "how it was calculated and how good the data is" columns:
// emission.method, emission.dq, emission.data_type, emission.is_estimate and
// column_config.method_options (docs/scope3/01-contracts.md §4).
//
//   npm run migrate:scope3-row-quality
//
// Idempotent (IF NOT EXISTS, and the backfill only writes rows whose method is
// still NULL) and additive: every column is nullable or defaulted, so rows
// written before Scope 3 keep working (00-plan §2.4).
//
// The method backfill follows docs/scope3/modules/S3-3-method-and-data-quality
// §Build.1: Scope 3 rows only, read off the form's calculation spec and the
// row's unit. Scope 1 and Scope 2 rows stay NULL — a method is a Scope 3 idea.
// The DQ backfill needs the auto-default rules (src/scope3/dq/defaults.ts),
// which import the S3-0 contracts; it ships in part 2/3 of this module.
//
// The method keys are written as SQL literals here because a migration is a
// historical snapshot: it must keep running unchanged even if the Method enum
// in src/scope3/contracts/ghgCategory.ts later gains or renames a key. Every
// other use of a method key imports that enum (00-plan §2.2).
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

/** Units that mean "an amount of money", from emissionWrite/units.ts. */
const CURRENCY_UNITS = ["inr", "usd", "eur"];

/** Units that mean "a distance", normalized the way a per_unit spec keys are. */
const DISTANCE_UNITS = ["km", "mi", "mile", "miles", "tonne.km", "kg.km", "g.km"];

const list = (values: string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * Normalizes a unit the way calculationSpec does for per_unit keys: lowercase,
 * trimmed, and separators written as ".".
 */
const NORMALIZED_UNIT = `lower(regexp_replace(trim(coalesce(e2.activity_data_unit, e2.unit)), '[^a-zA-Z0-9]+', '.', 'g'))`;

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS method character varying(40) NULL`);
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS dq jsonb NULL`);
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS data_type character varying(16) NULL`);
    await AppDataSource.query(
      `ALTER TABLE emission ADD COLUMN IF NOT EXISTS is_estimate boolean NOT NULL DEFAULT false`,
    );
    await AppDataSource.query(`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS method_options jsonb NULL`);
    console.log("emission.method, dq, data_type, is_estimate and column_config.method_options present.");

    // The method per row is worked out in a derived table rather than in the
    // UPDATE's own FROM: Postgres refuses a reference to the update target
    // (e) inside a LEFT JOIN condition there. The lateral returns at most one
    // form per row, so a site × category with more than one column config
    // can't multiply the row or pick a different form on a re-run.
    const backfill = await AppDataSource.query(
      `UPDATE emission e
          SET method = chosen.method
         FROM (
               SELECT e2.pk_id,
                      CASE
                        WHEN form.mode = 'per_unit'
                             AND ${NORMALIZED_UNIT} IN (${list(DISTANCE_UNITS)}) THEN 'distance_based'
                        WHEN ${NORMALIZED_UNIT} IN (${list(CURRENCY_UNITS)}) THEN 'spend_based'
                        WHEN form.mode = 'per_method' THEN 'direct_use'
                        ELSE 'average_data'
                      END AS method
                 FROM emission e2
                 JOIN category c ON c.category_id = e2.category_id
                 LEFT JOIN LATERAL (
                       SELECT cc.calculation->>'mode' AS mode
                         FROM column_config cc
                        WHERE cc.category_id = c.category_id AND cc.site_id = e2.site_id
                        ORDER BY cc.pk_id
                        LIMIT 1
                      ) form ON true
                WHERE c.scope = 'Scope 3'
                  AND e2.method IS NULL
              ) chosen
        WHERE chosen.pk_id = e.pk_id`,
    );
    const updated = Array.isArray(backfill) ? (backfill[1] ?? 0) : 0;
    console.log(`Backfilled method on ${updated} Scope 3 emission row(s).`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
