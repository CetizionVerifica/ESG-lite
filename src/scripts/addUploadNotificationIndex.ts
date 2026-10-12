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

/** (batch, user) pairs that already hold more than one UPLOAD_PENDING row; the index can't be built over them. */
export const DUPLICATE_UPLOAD_NOTIFICATIONS_SQL = `SELECT meta->>'upload_batch_id' AS upload_batch_id, user_id, count(*)::int AS rows
  FROM "notification"
  WHERE type = 'UPLOAD_PENDING'
  GROUP BY meta->>'upload_batch_id', user_id
  HAVING count(*) > 1
  ORDER BY 1, 2`;

async function main() {
  await AppDataSource.initialize();
  try {
    const dupes: { upload_batch_id: string | null; user_id: number; rows: number }[] = await AppDataSource.query(
      DUPLICATE_UPLOAD_NOTIFICATIONS_SQL
    );
    if (dupes.length > 0) {
      console.error(
        `notification_upload_batch_user_uq not created: ${dupes.length} (batch, user) pair(s) already hold more than one UPLOAD_PENDING notification.`
      );
      console.error("Remove the extra rows by hand (keep the oldest per pair), then rerun this migration. This script never deletes data.");
      for (const d of dupes) console.error(`  batch ${d.upload_batch_id ?? "(none)"} user ${d.user_id}: ${d.rows} rows`);
      process.exitCode = 1;
      return;
    }
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
