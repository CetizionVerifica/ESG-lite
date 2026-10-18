// KPI-7 · template upload plans (POST /kpi/my/template, plan then commit by plan_id):
//
//   kpi_template_plan   a planned upload's ready rows, per company and person, kept 24 h
//
//   npm run migrate:kpi-template-plans
//
// Idempotent: IF NOT EXISTS only, so a re-run changes nothing. Creates a table;
// touches no existing rows. Statements match what TypeORM generates for the
// entity, so ci/schema-diff.cjs sees nothing left to do.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const KPI_TEMPLATE_PLANS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "kpi_template_plan" ("id" uuid NOT NULL, "company_id" integer NOT NULL, "user_id" integer NOT NULL, "ready" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_dca1c1845a534f27fcecf4ec30e" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "IDX_kpi_template_plan_created_at" ON "kpi_template_plan" ("created_at")`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of KPI_TEMPLATE_PLANS_SCHEMA) await AppDataSource.query(sql);
    console.log("KPI-7 kpi_template_plan table present.");
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
