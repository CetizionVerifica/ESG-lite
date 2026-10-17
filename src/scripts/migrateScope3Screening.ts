// S3-12 · screening, proxy and extrapolation (docs/scope3/01-contracts.md §4):
//
//   emission.proxy (jsonb null: how an extrapolated or proxy row was made) and
//   the scope3_screening_input table (one rough spend, headcount, revenue or
//   mass figure per company, year, category and basis).
//
// Year type (S3-12 follow-up, ESG-lite #169): inputs are keyed by
// (company, year, year_type, category, basis), so CY 2026 and FY 2026 are
// separate. Rows written before carried a year only; they get the year type
// of the company's frozen base year (company_base_year, S3-14) when it has
// one, else CY — the year type the screening endpoints assume when a caller
// names none, so an older caller still reads exactly the rows it wrote.
// The old (company, year, category, basis) unique index is replaced by the
// new one (created first, then the old one dropped; an index, never data).
//
// It also backfills S3-9's commuting-survey rows: `extra_data.survey` →
// `emission.proxy = {basis: "sample", coverage_pct, from: []}` (S3-9 step 5),
// in batches of 1,000, only where proxy is still null.
//
//   npm run migrate:scope3-screening
//
// Idempotent: IF NOT EXISTS only, additive, and the backfill only fills
// nulls, so a re-run changes nothing.
// Statements match what TypeORM generates for the entities
// (Emission.proxy, Scope3ScreeningInput), so ci/schema-diff.cjs sees nothing
// left to do. Logs no data.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";
import { SURVEY_BACKFILL_SQL } from "../scope3/screening/proxyRows";

const BATCH = 1000;

/** Fills emission.proxy on survey rows that have none; returns how many rows were filled. */
export async function backfillSurveyProxies(q: { query: (sql: string, params?: unknown[]) => Promise<any> } = AppDataSource): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await q.query(SURVEY_BACKFILL_SQL(BATCH));
    // pg returns [rows, count] for UPDATE through TypeORM's query().
    const n = Array.isArray(result) && typeof result[1] === "number" ? result[1] : Number(result?.rowCount ?? 0);
    total += n;
    if (n < BATCH) return total;
  }
}

/**
 * `year_type` on scope3_screening_input, after the table exists. Each step is
 * idempotent: the column is added nullable, filled (yearTypeBackfill), then
 * given its default, NOT NULL and check; the unique key moves to include it.
 */
export const YEAR_TYPE_COLUMN = `ALTER TABLE "scope3_screening_input" ADD COLUMN IF NOT EXISTS "year_type" character varying(2)`;
export const YEAR_TYPE_FINISH = [
  `ALTER TABLE "scope3_screening_input" ALTER COLUMN "year_type" SET DEFAULT 'CY'`,
  `ALTER TABLE "scope3_screening_input" ALTER COLUMN "year_type" SET NOT NULL`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_scope3_screening_input_year_type') THEN
       ALTER TABLE "scope3_screening_input" ADD CONSTRAINT "CHK_scope3_screening_input_year_type" CHECK ("year_type" IN ('CY', 'FY'));
     END IF;
   END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scope3_screening_input_company_year_type_n_basis" ON "scope3_screening_input" ("company_id", "year", "year_type", "ghg_category", "basis")`,
  `DROP INDEX IF EXISTS "UQ_scope3_screening_input_company_year_n_basis"`,
];

/** One batch of the year-type backfill: the base year's year type, else CY, for rows that have none. */
export const YEAR_TYPE_BACKFILL_SQL = (batch: number, withBaseYear: boolean) => `
  UPDATE scope3_screening_input i
     SET year_type = ${
       withBaseYear
         ? `COALESCE((SELECT b.year_type FROM company_base_year b
                       WHERE b.company_id = i.company_id AND b.scope = 'Scope 3' AND b.year_type IN ('CY', 'FY')
                       ORDER BY b.id DESC LIMIT 1), 'CY')`
         : `'CY'`
     }
   WHERE i.id IN (SELECT id FROM scope3_screening_input WHERE year_type IS NULL ORDER BY id LIMIT ${Math.max(1, Math.floor(batch))})`;

/** Fills year_type where it is null, in batches; returns how many rows were filled. */
export async function backfillYearType(q: { query: (sql: string, params?: unknown[]) => Promise<any> } = AppDataSource): Promise<number> {
  const [{ present }]: any[] = await q.query(`SELECT to_regclass('company_base_year') IS NOT NULL AS present`);
  let total = 0;
  for (;;) {
    const result = await q.query(YEAR_TYPE_BACKFILL_SQL(BATCH, !!present));
    const n = Array.isArray(result) && typeof result[1] === "number" ? result[1] : Number(result?.rowCount ?? 0);
    total += n;
    if (n < BATCH) return total;
  }
}

export const SCREENING_SCHEMA = [
  `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "proxy" jsonb`,
  `CREATE TABLE IF NOT EXISTS "scope3_screening_input" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "year" integer NOT NULL, "ghg_category" smallint NOT NULL, "basis" character varying(20) NOT NULL, "amount" numeric(20,4) NOT NULL, "currency" character varying(3), "eeio_sector" character varying(100), "note" character varying(2000), "updated_by" integer, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_scope3_screening_input_amount" CHECK ("amount" >= 0), CONSTRAINT "CHK_scope3_screening_input_n" CHECK ("ghg_category" >= 1 AND "ghg_category" <= 15), CONSTRAINT "PK_471f7edb34a065af8e62c5ad545" PRIMARY KEY ("id"))`,
  // The unique key is (company, year, year_type, category, basis): YEAR_TYPE_FINISH creates it once
  // the column exists. The year-only key is never created again (CY and FY rows would break it).
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of SCREENING_SCHEMA) await AppDataSource.query(sql);
    await AppDataSource.query(YEAR_TYPE_COLUMN);
    const typed = await backfillYearType();
    for (const sql of YEAR_TYPE_FINISH) await AppDataSource.query(sql);
    console.log(`S3-12 scope3_screening_input.year_type present; ${typed} input row(s) given a year type.`);
    const filled = await backfillSurveyProxies();
    console.log(`S3-12 emission.proxy and scope3_screening_input present; ${filled} survey row(s) given a proxy basis.`);
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
