// KPI-9 · targets (docs/kpi/01-contracts.md §2, targets part):
//
//   kpi_target   one target per (company, KPI, site, target year); the unique key treats a null
//                site (company target) as one value, so it is an expression index
//
//   npm run migrate:kpi-targets
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Creates a table;
// touches no existing rows. Statements match what TypeORM generates for the
// entity, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const KPI_TARGETS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "kpi_target" ("id" SERIAL NOT NULL, "company_id" integer NOT NULL, "kpi_definition_id" integer NOT NULL, "site_id" integer, "baseline_year" integer NOT NULL, "baseline_value" numeric(24,6) NOT NULL, "target_year" integer NOT NULL, "target_value" numeric(24,6) NOT NULL, "direction" character varying(10) NOT NULL, "note" text, "created_by" integer, "updated_by" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c34adc0d9347ab04e2a4f80909e" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_target_company_kpi" ON "kpi_target" ("company_id", "kpi_definition_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_kpi_target_company_kpi_site_year" ON "kpi_target" ("company_id", "kpi_definition_id", (COALESCE("site_id", 0)), "target_year")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of KPI_TARGETS_SCHEMA) await AppDataSource.query(sql);
    console.log("KPI-9 kpi_target table present.");
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
