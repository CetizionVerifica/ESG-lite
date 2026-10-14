// Adds "user".is_internal (boolean, default false): marks the team's own
// accounts, the only ones that may hold sites of several clients (bug 7).
// Existing users start as client accounts; a Superadmin ticks "Internal
// account" on the Users page for the team's logins.
//
//   npm run migrate:user-internal
//
// Run it before the build that ships the column (migrate:all on release).
// Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false`,
    );
    console.log('"user".is_internal present.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
