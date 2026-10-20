// Design Studio switch (DS-0, docs/design-studio/modules/DS-0-contracts-and-switch):
//
//   company.design_studio_enabled   boolean, default false  (per-client switch, Superadmin only)
//
//   npm run migrate:ds-0-switch
//
// The statement matches what TypeORM generates for Company.design_studio_enabled,
// so ci/schema-diff.cjs sees nothing left to do. Idempotent (IF NOT EXISTS)
// and additive; nothing is dropped or changed.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const DS0_SWITCH_STATEMENTS = [
  `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "design_studio_enabled" boolean NOT NULL DEFAULT false`,
];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const sql of DS0_SWITCH_STATEMENTS) await AppDataSource.query(sql);
    console.log("company.design_studio_enabled present.");
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
