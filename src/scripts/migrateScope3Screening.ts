// S3-12 · screening, proxy and extrapolation (docs/scope3/01-contracts.md §4):
//
//   emission.proxy (jsonb null: how an extrapolated or proxy row was made) and
//   the scope3_screening_input table (one rough spend, headcount, revenue or
//   mass figure per company, year, category and basis).
//
//   npm run migrate:scope3-screening
//
// Idempotent: IF NOT EXISTS only, additive, so a re-run changes nothing.
// Statements match what TypeORM generates for the entities
// (Emission.proxy, Scope3ScreeningInput), so ci/schema-diff.cjs sees nothing
// left to do. Logs no data.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const SCREENING_SCHEMA = [
  `ALTER TABLE "emission" ADD COLUMN IF NOT EXISTS "proxy" jsonb`,
  `CREATE TABLE IF NOT EXISTS "scope3_screening_input" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "year" integer NOT NULL, "ghg_category" smallint NOT NULL, "basis" character varying(20) NOT NULL, "amount" numeric(20,4) NOT NULL, "currency" character varying(3), "eeio_sector" character varying(100), "note" character varying(2000), "updated_by" integer, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "CHK_scope3_screening_input_amount" CHECK ("amount" >= 0), CONSTRAINT "CHK_scope3_screening_input_n" CHECK ("ghg_category" >= 1 AND "ghg_category" <= 15), CONSTRAINT "PK_471f7edb34a065af8e62c5ad545" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_scope3_screening_input_company_year_n_basis" ON "scope3_screening_input" ("company_id", "year", "ghg_category", "basis")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of SCREENING_SCHEMA) await AppDataSource.query(sql);
    console.log("S3-12 emission.proxy and scope3_screening_input present.");
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
