// S3-3 · Backfills method, data quality and data type on Scope 3 rows written
// before rows recorded them (docs/scope3/modules/S3-3-method-and-data-quality
// §Build.1). The columns come from migrate:scope3-row-quality, which runs
// first; this runs last, after the taxonomy has set category.ghg_category.
//
//   npm run migrate:scope3-row-quality-backfill
//
// Method, Scope 3 rows only, the first rule that applies:
//   1. the row's own `activity_data["@method"]` when it is a method key
//      (S3-9 forms and rows sent before rows had a method), as the engine reads it;
//   2. a per_unit form and a distance unit (tonne.km, km…) → distance_based;
//   3. a currency unit → spend_based;
//   4. a Category 11 (use of sold products) form → direct_use;
//   5. everything else → average_data.
// Scope 1 and Scope 2 rows stay NULL: a method is a Scope 3 idea.
//
// Data quality: the §3 automatic default (src/scope3/dq/defaults.ts) with
// `source: 'auto'`, from the row's method, its factor snapshot (or the factor
// it names, for snapshots written before S3-2), the site's country, the
// reporting year and whether an evidence document is attached. Data type
// follows the same rules as a new row.
//
// Idempotent: the method step only writes rows whose method is NULL and the
// DQ step only rows whose dq is NULL, so a second run changes nothing. Totals
// are never read or written. Batched by 1,000 rows (src/scope3/CLAUDE.md §5).
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { METHOD_KEYS, MethodSchema, type Method } from "../scope3/contracts/ghgCategory";
import { autoDq, dataTypeFor } from "../scope3/dq/defaults";
import { KNOWN_CURRENCY_CODES } from "../scope3/spend/currencies";

const BATCH = 1000;

/** Units that mean "a distance", normalized the way a per_unit spec keys are. */
const DISTANCE_UNITS = ["km", "mi", "mile", "miles", "tonne.km", "kg.km", "g.km"];

const CURRENCY_UNITS = KNOWN_CURRENCY_CODES.map((code) => code.toLowerCase());

/** Method keys a row may name in "@method"; `unknown` is not a choice. */
const ROW_METHODS = METHOD_KEYS.filter((key) => key !== "unknown");

const list = (values: readonly string[]) => values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");

/**
 * Normalizes a unit the way calculationSpec does for per_unit keys: lowercase,
 * trimmed, and separators written as ".".
 */
const NORMALIZED_UNIT = `lower(regexp_replace(trim(coalesce(e2.activity_data_unit, e2.unit)), '[^a-zA-Z0-9]+', '.', 'g'))`;
const ROW_METHOD = `trim(e2.activity_data->>'@method')`;

const backfillMethods = async (): Promise<number> => {
  // The method per row is worked out in a derived table rather than in the
  // UPDATE's own FROM: Postgres refuses a reference to the update target
  // (e) inside a LEFT JOIN condition there. The lateral returns at most one
  // form per row, so a site × category with more than one column config
  // can't multiply the row or pick a different form on a re-run.
  const result = await AppDataSource.query(
    `UPDATE emission e
        SET method = chosen.method
       FROM (
             SELECT e2.pk_id,
                    CASE
                      WHEN ${ROW_METHOD} IN (${list(ROW_METHODS)}) THEN ${ROW_METHOD}
                      WHEN form.mode = 'per_unit'
                           AND ${NORMALIZED_UNIT} IN (${list(DISTANCE_UNITS)}) THEN 'distance_based'
                      WHEN ${NORMALIZED_UNIT} IN (${list(CURRENCY_UNITS)}) THEN 'spend_based'
                      WHEN c.ghg_category = 11 AND form.mode IS NOT NULL THEN 'direct_use'
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
  return Array.isArray(result) ? (result[1] ?? 0) : 0;
};

interface DqRow {
  pk_id: number;
  method: string;
  reporting_year: number | null;
  site_country: string | null;
  has_evidence: boolean;
  geography: string | null;
  year: number | null;
  factor_type: string | null;
}

const backfillDq = async (): Promise<number> => {
  let updated = 0;
  let after = 0;
  for (;;) {
    // The snapshot is what the row was calculated with; snapshots written
    // before S3-2 carry no geography or factor type, so the factor they name
    // fills in what is still there.
    const rows: DqRow[] = await AppDataSource.query(
      `SELECT e.pk_id,
              e.method,
              extract(year FROM e.date_of_reporting)::int AS reporting_year,
              co.code AS site_country,
              EXISTS (SELECT 1 FROM emission_document d WHERE d.emission_id = e.pk_id) AS has_evidence,
              coalesce(e.emission_factor_snapshot->>'geography', ef.geography) AS geography,
              coalesce(
                CASE WHEN e.emission_factor_snapshot->>'year' ~ '^[0-9]{4}$'
                     THEN (e.emission_factor_snapshot->>'year')::int END,
                ef.year
              ) AS year,
              coalesce(e.emission_factor_snapshot->>'factor_type', ef.factor_type) AS factor_type
         FROM emission e
         JOIN category c ON c.category_id = e.category_id
         LEFT JOIN site s ON s.site_id = e.site_id
         LEFT JOIN country co ON co.country_id = s.country_id
         LEFT JOIN emission_factors ef
                ON e.emission_factor_snapshot->>'emission_factor_id' ~ '^[0-9]+$'
               AND ef.emission_factor_id = (e.emission_factor_snapshot->>'emission_factor_id')::int
        WHERE c.scope = 'Scope 3'
          AND e.method IS NOT NULL
          AND e.dq IS NULL
          AND e.pk_id > $1
        ORDER BY e.pk_id
        LIMIT ${BATCH}`,
      [after],
    );
    if (!rows.length) break;

    for (const row of rows) {
      after = Number(row.pk_id);
      const parsed = MethodSchema.safeParse(row.method);
      const method: Method = parsed.success ? parsed.data : "unknown";
      const hasEvidence = Boolean(row.has_evidence);
      const dq = autoDq({
        method,
        factor: { geography: row.geography, year: row.year, factor_type: row.factor_type },
        siteCountry: row.site_country,
        reportingYear: Number(row.reporting_year) || 0,
        hasEvidence,
      });
      await AppDataSource.query(
        `UPDATE emission SET dq = $2::jsonb, data_type = coalesce(data_type, $3) WHERE pk_id = $1 AND dq IS NULL`,
        [row.pk_id, JSON.stringify(dq), dataTypeFor({ method, hasEvidence })],
      );
      updated += 1;
    }
  }
  return updated;
};

async function main() {
  await AppDataSource.initialize();
  try {
    const methods = await backfillMethods();
    console.log(`Backfilled method on ${methods} Scope 3 emission row(s).`);
    const dq = await backfillDq();
    console.log(`Backfilled data quality on ${dq} Scope 3 emission row(s).`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
