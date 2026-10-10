// Adds company.created_at (nullable timestamp): when a client was
// onboarded, for the Console's recent activity (redesign P16). Clients that
// exist before this runs keep NULL: their onboarding date is unknown, and
// stamping them with today would show every old client as just onboarded.
//
//   npm run migrate:company-created-at
//
// There is no column default: the backend stamps new clients itself
// (stampCompanyOnboarded), and the entity maps the column with select, insert
// and update false, so the backend keeps working if this runs after the
// deploy; until it runs the Console just shows no onboarding rows.
//
// Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE company ADD COLUMN IF NOT EXISTS created_at timestamp NULL`);
    console.log("company.created_at present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
