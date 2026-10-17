// KPI-4 · the KPI value store (docs/kpi/01-contracts.md §2, values part):
//
//   kpi_value            one value per (company, site, KPI, period_start, frequency); the unique
//                        key treats a null site (company level) as one value, so it is an
//                        expression index on COALESCE(site_id, 0)
//   kpi_value_evidence   documents attached to a value
//   kpi_period_lock      closed KPI periods (separate from the emissions period_lock); unique on
//                        (company, COALESCE(site, 0), year, COALESCE(period, 0))
//
//   npm run migrate:kpi-values
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Creates tables;
// touches no existing rows. Statements match what TypeORM generates for the
// entities, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const KPI_VALUES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "kpi_value" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "site_id" integer, "kpi_definition_id" integer NOT NULL, "period_start" date NOT NULL, "period_end" date NOT NULL, "frequency" character varying(10) NOT NULL, "year_type" character varying(2) NOT NULL DEFAULT 'CY', "value_numeric" numeric(24,6), "value_text" text, "unit" character varying(40), "value_canonical" numeric(24,6), "breakdown" jsonb, "source" character varying(10) NOT NULL DEFAULT 'manual', "status" character varying(10) NOT NULL DEFAULT 'draft', "is_estimate" boolean NOT NULL DEFAULT false, "comment" text, "entered_by" integer, "submitted_at" TIMESTAMP, "reviewed_by" integer, "reviewed_at" TIMESTAMP, "review_comment" text, "checks" jsonb, "auto_snapshot" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6b4a10260242a07160894fd5df8" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_value_site_status" ON "kpi_value" ("site_id", "status")`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_value_company_kpi_period" ON "kpi_value" ("company_id", "kpi_definition_id", "period_start")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_value_company_site_kpi_period" ON "kpi_value" ("company_id", (COALESCE("site_id", 0)), "kpi_definition_id", "period_start", "frequency")`,
  `CREATE TABLE IF NOT EXISTS "kpi_value_evidence" ("id" SERIAL NOT NULL, "kpi_value_id" integer NOT NULL, "document_url" text NOT NULL, "document_name" character varying(255) NOT NULL, "public_id" character varying(255), "uploaded_by" integer, "uploaded_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ff00dfc729738e815a6d3fe39dd" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_value_evidence_value" ON "kpi_value_evidence" ("kpi_value_id")`,
  `CREATE TABLE IF NOT EXISTS "kpi_period_lock" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "site_id" integer, "year" integer NOT NULL, "period" integer, "year_type" character varying(2) NOT NULL DEFAULT 'CY', "locked_by" integer NOT NULL, "locked_at" TIMESTAMP NOT NULL DEFAULT now(), "reopened_by" integer, "reopened_at" TIMESTAMP, "reopened_reason" text, CONSTRAINT "PK_899aec78762c2b75c0d40e497fc" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_period_lock_company_year" ON "kpi_period_lock" ("company_id", "year")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_period_lock_company_site_year_period" ON "kpi_period_lock" ("company_id", (COALESCE("site_id", 0)), "year", (COALESCE("period", 0)))`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of KPI_VALUES_SCHEMA) await AppDataSource.query(sql);
    console.log("KPI-4 kpi_value, kpi_value_evidence and kpi_period_lock tables present.");
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
