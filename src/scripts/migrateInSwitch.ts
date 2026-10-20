// Insights switch (IN-0, docs/insights/modules/IN-0-contracts-and-switch):
//
//   company.insights_enabled   boolean, default false  (per-client switch, Superadmin only)
//
//   npm run migrate:in-switch
//
// The statement matches what TypeORM generates for Company.insights_enabled,
// so ci/schema-diff.cjs sees nothing left to do. Idempotent (IF NOT EXISTS)
// and additive; nothing is dropped or changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const IN0_SWITCH_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "insights_enabled" boolean NOT NULL DEFAULT false`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of IN0_SWITCH_STATEMENTS) await AppDataSource.query(sql);
    console.log("company.insights_enabled present.");
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
