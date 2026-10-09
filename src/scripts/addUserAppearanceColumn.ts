// Adds "user".appearance ('light' | 'dark' | 'system', default 'system'):
// B2 in docs/redesign/00-entity-map.md, the per-user colour scheme that
// replaces the app's localStorage setting.
//
//   npm run migrate:user-appearance
//
// Must run BEFORE the backend that ships the User.appearance column starts:
// TypeORM selects every mapped column, so without it every user read (login
// included) throws.
//
// Idempotent (IF NOT EXISTS) and additive: existing users get 'system', which
// is what the app does today when nothing is stored.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS appearance varchar(10) NOT NULL DEFAULT 'system'`,
    );
    console.log('"user".appearance present.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
