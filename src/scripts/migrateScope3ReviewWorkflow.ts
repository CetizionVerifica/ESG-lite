// S3-15 part 2 (src/scope3/review/CLAUDE.md item 4, docs/scope3/01-contracts.md §4):
//
//   company.review_workflow_v2   boolean, default false (D9: off until Shyam turns it on per client)
//   emission status enum         gains 'draft'
//   period_lock                  closed site-months; unique on (company, site, year, month) with a
//                                null site or month counted as one value (expression index)
//   nothing_this_month           "Nothing this month" per site, category and month
//
//   npm run migrate:scope3-review-workflow
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing; touches no
// existing rows. `ALTER TYPE … ADD VALUE` can't run inside a transaction
// block, so every statement runs on its own (autocommit). The enum is found
// from the column (TypeORM names it emission_status_enum); a database whose
// status column isn't an enum is left alone. Statements match what TypeORM
// generates for the entities, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const REVIEW_WORKFLOW_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "review_workflow_v2" boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS "period_lock" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "site_id" integer, "year" integer NOT NULL, "month" integer, "locked_by" integer NOT NULL, "locked_at" TIMESTAMP NOT NULL DEFAULT now(), "reopened_by" integer, "reopened_at" TIMESTAMP, "reopened_reason" text, CONSTRAINT "PK_eac960b1936275cc42ac85eda37" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_period_lock_company_year_month" ON "period_lock" ("company_id", "year", "month")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_period_lock_company_site_year_month" ON "period_lock" ("company_id", (COALESCE("site_id", 0)), "year", (COALESCE("month", 0)))`,
  `CREATE TABLE IF NOT EXISTS "nothing_this_month" ("id" SERIAL NOT NULL, "site_id" integer NOT NULL, "category_id" integer NOT NULL, "period" date NOT NULL, "user_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b27b6b4404f75d63f367778b346" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_nothing_this_month_site_category_period" ON "nothing_this_month" ("site_id", "category_id", "period")`,
];

/** The enum type behind emission.status, or null when the column is not an enum. */
export const emissionStatusEnum = async (): Promise<string | null> => {
  const [col]: Array<{ data_type: string; udt_name: string }> = await AppDataSource.query(
    `SELECT data_type, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'emission' AND column_name = 'status'`,
  );
  return col && col.data_type === "USER-DEFINED" ? col.udt_name : null;
};

async function main() {
  await AppDataSource.initialize();
  try {
    const enumName = await emissionStatusEnum();
    if (enumName) {
      // Its own statement, outside any transaction (Postgres refuses ADD VALUE inside one before PG 12,
      // and a value added inside a transaction can't be used until it commits).
      await AppDataSource.query(`ALTER TYPE "${enumName.replace(/"/g, '""')}" ADD VALUE IF NOT EXISTS 'draft'`);
    }
    for (const sql of REVIEW_WORKFLOW_STATEMENTS) await AppDataSource.query(sql);
    console.log(`S3-15 review workflow: company.review_workflow_v2, ${enumName ?? "emission.status"} 'draft', period_lock and nothing_this_month present.`);
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
