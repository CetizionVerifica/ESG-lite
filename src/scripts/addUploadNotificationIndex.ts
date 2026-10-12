// IM4 follow-up: one UPLOAD_PENDING notification per user per import batch,
// enforced in the database so two concurrent batch-committed emits (or the
// emitter plus the internal hook) can't double-notify. The same index serves
// the "already notified for this batch?" lookup in src/services/uploadNotify.
//
//   npm run migrate:upload-notification-index
//
// Idempotent (IF NOT EXISTS) and additive. The entity declares the index with
// synchronize: false, so TypeORM neither creates nor drops it.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const UPLOAD_NOTIFICATION_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS "notification_upload_batch_user_uq"
  ON "notification" ((meta->>'upload_batch_id'), user_id)
  WHERE type = 'UPLOAD_PENDING'`;

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(UPLOAD_NOTIFICATION_INDEX_SQL);
    console.log("notification_upload_batch_user_uq present.");
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
