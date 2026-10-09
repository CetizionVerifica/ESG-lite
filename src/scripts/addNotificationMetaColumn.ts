// Adds notification.meta (jsonb, nullable): P13 Notifications shows the
// reviewer and the rejection reason as structured fields instead of parsing
// them out of the message text.
//
//   npm run migrate:notification-meta
//
// Must run BEFORE the backend that ships the Notification.meta column starts:
// TypeORM selects every mapped column, so without it every notification read
// throws.
//
// Idempotent (IF NOT EXISTS) and additive: existing rows get NULL, and
// clients fall back to the message text for them.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(`ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS meta jsonb`);
    console.log("notification.meta present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
