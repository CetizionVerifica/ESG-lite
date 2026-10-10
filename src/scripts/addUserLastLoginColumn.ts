// Adds "user".last_login_at (nullable timestamp): the "Last active" column on
// the redesigned Users page (P20). Login sets it; existing users start empty.
//
//   npm run migrate:user-last-login
//
// The entity maps the column with select: false and login writes it best
// effort, so the backend keeps working if this runs after the deploy; until
// it runs, the Users page just shows no last-active dates.
//
// Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_login_at timestamp NULL`,
    );
    console.log('"user".last_login_at present.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
