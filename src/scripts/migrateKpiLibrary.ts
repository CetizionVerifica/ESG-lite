// KPI-2 · the KPI library (docs/kpi/01-contracts.md §2, library part):
//
//   kpi_framework        framework versions (GRI 2021+, BRSR 2023, ESRS 2023)
//   kpi_definition       KPIs; code unique per owner (COALESCE(company_id, 0), code)
//   kpi_disclosure       disclosures of a framework version; unique (framework_id, code)
//   kpi_disclosure_map   KPI ↔ disclosure with fit, breakdown key, display unit, note
//
//   npm run migrate:kpi-library          (then migrate:kpi-library-seed loads data/kpi/)
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Creates tables;
// touches no existing rows. Statements match what TypeORM generates for the
// entities, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const KPI_LIBRARY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "kpi_framework" ("id" SERIAL NOT NULL, "code" character varying(20) NOT NULL, "version" character varying(40) NOT NULL, "name" character varying(200) NOT NULL, "source_url" text NOT NULL, "active" boolean NOT NULL DEFAULT true, "default_for_new" boolean NOT NULL DEFAULT false, "edited_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f66825201cfc483a63c9736f71f" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_framework_code_version" ON "kpi_framework" ("code", "version")`,
  `CREATE TABLE IF NOT EXISTS "kpi_definition" ("id" SERIAL NOT NULL, "code" character varying(80) NOT NULL, "name" character varying(200) NOT NULL, "question" text NOT NULL, "help" text, "topic" character varying(30) NOT NULL, "value_type" character varying(20) NOT NULL, "unit_dimension" character varying(20) NOT NULL DEFAULT 'none', "canonical_unit" character varying(40), "allowed_units" jsonb NOT NULL DEFAULT '[]', "aggregation" character varying(20) NOT NULL DEFAULT 'sum', "level" character varying(10) NOT NULL DEFAULT 'site', "default_frequency" character varying(10) NOT NULL DEFAULT 'annual', "source" character varying(10) NOT NULL DEFAULT 'manual', "auto_source" character varying(40), "formula" text, "breakdowns" jsonb, "decimals" integer NOT NULL DEFAULT '2', "company_id" integer, "active" boolean NOT NULL DEFAULT true, "edited_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e19d5895a1dd4418d377ad05470" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_definition_company" ON "kpi_definition" ("company_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_definition_owner_code" ON "kpi_definition" ((COALESCE("company_id", 0)), "code")`,
  `CREATE TABLE IF NOT EXISTS "kpi_disclosure" ("id" SERIAL NOT NULL, "framework_id" integer NOT NULL, "code" character varying(40) NOT NULL, "title" character varying(300) NOT NULL, "section" character varying(120) NOT NULL, "requirement" character varying(20) NOT NULL DEFAULT 'required', "esrs_topic" character varying(4), "source_url" text NOT NULL, "sort_key" integer NOT NULL DEFAULT '0', "verified" boolean NOT NULL DEFAULT false, "edited_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8152d4b0d47cf7c7175c54e8640" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_disclosure_framework_code" ON "kpi_disclosure" ("framework_id", "code")`,
  `CREATE TABLE IF NOT EXISTS "kpi_disclosure_map" ("id" SERIAL NOT NULL, "disclosure_id" integer NOT NULL, "kpi_definition_id" integer NOT NULL, "fit" character varying(10) NOT NULL DEFAULT 'exact', "breakdown_key" character varying(40), "display_unit" character varying(40), "note" text, "edited_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bd048e1155c62ed1e25d267ee4a" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_disclosure_map_kpi" ON "kpi_disclosure_map" ("kpi_definition_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_disclosure_map_disclosure_kpi" ON "kpi_disclosure_map" ("disclosure_id", "kpi_definition_id")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of KPI_LIBRARY_SCHEMA) await AppDataSource.query(sql);
    console.log("KPI-2 kpi_framework, kpi_definition, kpi_disclosure and kpi_disclosure_map tables present.");
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
