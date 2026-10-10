// Adds company.created_at (timestamp, default now()): when a client was
// onboarded, for the Console's recent activity (redesign P16). Clients that
// exist before this runs keep NULL: their onboarding date is unknown, and
// stamping them with today would show every old client as just onboarded.
//
//   npm run migrate:company-created-at
//
// The entity maps the column with select: false and insert: false, so the
// backend keeps working if this runs after the deploy; until it runs the
// Console just shows no onboarding rows.
//
// Idempotent (IF NOT EXISTS, SET DEFAULT) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    // Added without a default first, so existing rows stay NULL; then new rows get now().
    await AppDataSource.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS created_at timestamp NULL`);
    await AppDataSource.query(`ALTER TABLE company ALTER COLUMN created_at SET DEFAULT now()`);
    console.log("company.created_at present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
