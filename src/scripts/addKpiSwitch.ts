// KPI tracking switch (KPI-1, docs/kpi/modules/KPI-1-client-switch):
//
//   company.kpi_tracking_enabled   boolean, default false  (per-client switch, Superadmin only)
//
//   npm run migrate:kpi-switch
//
// The statement matches what TypeORM generates for Company.kpi_tracking_enabled,
// so ci/schema-diff.cjs sees nothing left to do. Idempotent (IF NOT EXISTS)
// and additive; nothing is dropped or changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const KPI_SWITCH_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "kpi_tracking_enabled" boolean NOT NULL DEFAULT false`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of KPI_SWITCH_STATEMENTS) await AppDataSource.query(sql);
    console.log("company.kpi_tracking_enabled present.");
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
