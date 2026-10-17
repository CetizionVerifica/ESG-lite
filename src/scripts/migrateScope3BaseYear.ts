// S3-14 · base year and recalculation (docs/scope3/01-contracts.md §4, §10):
//
//   the `company_base_year` table (one row per company and scope, with the
//   rationale, year type and frozen snapshot) and the `recalculation_event`
//   table (proposed, approved and dismissed recalculations).
//
//   npm run migrate:scope3-base-year
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Creates tables;
// touches no existing rows. Statements match what TypeORM generates for the
// entities, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const BASE_YEAR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "company_base_year" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "scope" character varying(20) NOT NULL DEFAULT 'Scope 3', "base_year" integer NOT NULL, "year_type" character varying(2) NOT NULL DEFAULT 'CY', "significance_pct" numeric(5,2) NOT NULL DEFAULT '5', "policy_note" text, "rationale" text, "snapshot" jsonb, "updated_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_24e50685c13d37fcec011b65a27" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_base_year_company_scope" ON "company_base_year" ("company_id", "scope")`,
  `CREATE TABLE IF NOT EXISTS "recalculation_event" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "scope" character varying(20) NOT NULL DEFAULT 'Scope 3', "reason" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'proposed', "affected_years" jsonb NOT NULL DEFAULT '[]', "delta_tco2e" numeric(18,4) NOT NULL DEFAULT '0', "note" text, "before" jsonb, "after" jsonb, "details" jsonb, "approved_by" integer, "decided_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5f30a2e39342fd9b81ac72a0dac" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_recalculation_event_company" ON "recalculation_event" ("company_id", "status")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of BASE_YEAR_SCHEMA) await AppDataSource.query(sql);
    console.log("S3-14 company_base_year and recalculation_event tables present.");
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
