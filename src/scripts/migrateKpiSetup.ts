// KPI-3 · company setup (docs/kpi/01-contracts.md §2, company setup part):
//
//   company_kpi_settings     one row per company: year type, first year, due day, setup_completed_at
//   company_framework        framework versions a company reports on; one per framework code
//   company_material_topic   material yes/no per ESRS topic, with a reason when not (D13)
//   company_kpi              KPIs selected or left out (with a reason), frequency override
//   kpi_assignment           owner and reviewer per (company, KPI, site); the unique key treats a
//                            null site (company level) as one value, so it is an expression index
//   kpi_topic_grant          KPI topics per user (none = every topic)
//
//   npm run migrate:kpi-setup
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Creates tables;
// touches no existing rows. Statements match what TypeORM generates for the
// entities, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const KPI_SETUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "company_kpi_settings" ("company_id" integer NOT NULL, "year_type" character varying(2) NOT NULL DEFAULT 'CY', "first_year" integer NOT NULL, "due_day" integer NOT NULL DEFAULT '15', "setup_completed_at" TIMESTAMP, "updated_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c565df41827f562095ffc44dfdc" PRIMARY KEY ("company_id"))`,
  `CREATE TABLE IF NOT EXISTS "company_framework" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "framework_id" integer NOT NULL, "framework_code" character varying(20) NOT NULL, "enabled_at" TIMESTAMP NOT NULL DEFAULT now(), "enabled_by" integer, CONSTRAINT "PK_30da1242a7e8372b7381f658225" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_framework_company_code" ON "company_framework" ("company_id", "framework_code")`,
  `CREATE TABLE IF NOT EXISTS "company_material_topic" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "esrs_topic" character varying(4) NOT NULL, "material" boolean NOT NULL, "reason" text, "decided_by" integer, "decided_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_61739dddb8dfa6ed2e904fbfc6e" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_material_topic_company_topic" ON "company_material_topic" ("company_id", "esrs_topic")`,
  `CREATE TABLE IF NOT EXISTS "company_kpi" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "kpi_definition_id" integer NOT NULL, "selected" boolean NOT NULL DEFAULT true, "frequency" character varying(10), "reason_excluded" text, "updated_by" integer, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e7de597ff46511e85b85a9a4d18" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_kpi_company_kpi" ON "company_kpi" ("company_id", "kpi_definition_id")`,
  `CREATE TABLE IF NOT EXISTS "kpi_assignment" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "kpi_definition_id" integer NOT NULL, "site_id" integer, "owner_user_id" integer NOT NULL, "reviewer_user_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fa58ce5a7d2c56ad24f3e64022d" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_assignment_company_owner" ON "kpi_assignment" ("company_id", "owner_user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_assignment_company_kpi_site" ON "kpi_assignment" ("company_id", "kpi_definition_id", (COALESCE("site_id", 0)))`,
  `CREATE TABLE IF NOT EXISTS "kpi_topic_grant" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "topic" character varying(30) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c88ae6009d50a658c0901ffd555" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_topic_grant_user_topic" ON "kpi_topic_grant" ("user_id", "topic")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of KPI_SETUP_SCHEMA) await AppDataSource.query(sql);
    console.log("KPI-3 company_kpi_settings, company_framework, company_material_topic, company_kpi, kpi_assignment and kpi_topic_grant tables present.");
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
