/**
 * IM4 · Upload-pending notifications.
 *
 * When an import batch is committed (IM2 emits `onBatchCommitted`, see
 * src/imports/writer.ts §7), each manager of each affected site gets one
 * UPLOAD_PENDING notification (bell + SSE) and, by their preference, an
 * email. Sites with no manager fall back to the company's Admins. The
 * uploader is never told about their own batch.
 *
 * Nothing here can undo a commit: every error is caught and logged with ids
 * only (no row payloads, no sheet text).
 */
import { AppDataSource } from "../config/data-source";
import type { BatchCommittedEvent } from "../imports/writer";
import { onBatchCommitted } from "../imports/writer";
import { sendToQueue } from "../queues/emailProducer";
import { createNotification } from "./notificationService";

export const UPLOAD_PENDING_TYPE = "UPLOAD_PENDING";
/** Preference key (User.notification_preferences) that turns the email off. */
export const UPLOAD_PENDING_PREF = "email_uploads";

export interface UploadRecipient {
  user_id: number;
  name: string;
  email: string | null;
  notification_preferences: Record<string, boolean> | null;
}

export interface UploadNotification {
  user_id: number;
  type: typeof UPLOAD_PENDING_TYPE;
  title: string;
  message: string;
  link: string;
  meta: {
    upload_batch_id: string;
    rows: number;
    tco2e: number;
    site_ids: number[];
    months: string[];
    channel: BatchCommittedEvent["channel"];
  };
  /** Present when the recipient has an address and has not opted out. */
  email: { email: string; name: string } | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (ym: string): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : ym;
};

/** "Mar 2026", "Mar–Jun 2026" or "Nov 2025–Feb 2026" from the batch's months. */
export const monthsLabel = (months: string[]): string => {
  const sorted = [...new Set(months)].sort();
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return monthLabel(sorted[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstLabel = monthLabel(first);
  const lastLabel = monthLabel(last);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${firstLabel.slice(0, 3)}–${lastLabel}`;
  return `${firstLabel}–${lastLabel}`;
};

const formatTco2e = (v: number): string => {
  const n = Number.isFinite(v) ? v : 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }); // #209
};

export const batchLink = (uploadBatchId: string): string =>
  `/data/approvals?view=batches&batch=${encodeURIComponent(uploadBatchId)}`;

/**
 * Pure: the notifications to write for a batch, one per recipient. The
 * uploader is dropped here as well as in the query, so a direct caller
 * (the internal endpoint) gets the same rule. Email is null when the
 * recipient has no address or turned `email_uploads` off.
 */
export const buildUploadNotifications = (
  event: BatchCommittedEvent,
  recipients: UploadRecipient[],
  uploaderName: string,
  siteNames: string[]
): UploadNotification[] => {
  const seen = new Set<number>();
  const out: UploadNotification[] = [];
  const sites = siteNames.length ? siteNames.join(", ") : "your sites";
  const period = monthsLabel(event.months);
  const message =
    `${uploaderName} uploaded ${event.rows} ${event.rows === 1 ? "entry" : "entries"} for ${sites}` +
    (period ? ` (${period})` : "") +
    `. ${formatTco2e(event.tco2e)} tCO₂e waiting for review`;
  for (const r of recipients) {
    if (r.user_id === event.created_by || seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    const optedOut = r.notification_preferences?.[UPLOAD_PENDING_PREF] === false;
    out.push({
      user_id: r.user_id,
      type: UPLOAD_PENDING_TYPE,
      title: "Entries waiting for your review",
      message,
      link: batchLink(event.upload_batch_id),
      meta: {
        upload_batch_id: event.upload_batch_id,
        rows: event.rows,
        tco2e: event.tco2e,
        site_ids: event.site_ids,
        months: event.months,
        channel: event.channel,
      },
      email: r.email && !optedOut ? { email: r.email, name: r.name || "Manager" } : null,
    });
  }
  return out;
};

/**
 * Managers whose sites include any of the batch's sites; for a site with no
 * manager, the company's Admins. Scoped to the batch's company so another
 * company's managers never match, even if a site id were wrong.
 */
const findRecipients = async (event: BatchCommittedEvent): Promise<UploadRecipient[]> => {
  if (event.site_ids.length === 0) return [];
  const managers: UploadRecipient[] = await AppDataSource.query(
    `SELECT DISTINCT u.user_id, u.name, u.email, u.notification_preferences
       FROM "user" u
       JOIN user_sites us ON us.user_id = u.user_id
       JOIN site s ON s.site_id = us.site_id
      WHERE u.role = 'Manager'
        AND s.company_id = $1
        AND us.site_id = ANY($2::int[])`,
    [event.company_id, event.site_ids]
  );
  const unmanaged: { site_id: number }[] = await AppDataSource.query(
    `SELECT s.site_id
       FROM site s
      WHERE s.company_id = $1
        AND s.site_id = ANY($2::int[])
        AND NOT EXISTS (
          SELECT 1 FROM user_sites us JOIN "user" u ON u.user_id = us.user_id
           WHERE us.site_id = s.site_id AND u.role = 'Manager')`,
    [event.company_id, event.site_ids]
  );
  if (unmanaged.length === 0) return managers;
  // An Admin belongs to the company through user.company_id (older rows: their
  // own site_id or, when that is unset, any site in user_sites).
  const admins: UploadRecipient[] = await AppDataSource.query(
    `SELECT DISTINCT u.user_id, u.name, u.email, u.notification_preferences
       FROM "user" u
       LEFT JOIN site s ON s.site_id = u.site_id
      WHERE u.role = 'Admin'
        AND (u.company_id = $1 OR s.company_id = $1
             OR EXISTS (SELECT 1 FROM user_sites us JOIN site s2 ON s2.site_id = us.site_id
                         WHERE us.user_id = u.user_id AND s2.company_id = $1))`,
    [event.company_id]
  );
  return [...managers, ...admins];
};

const UPLOAD_NOTIFICATION_INDEX = "notification_upload_batch_user_uq";
/** Postgres unique_violation (23505) on the per-batch index; any other unique index is somebody else's problem. */
const isUniqueViolation = (err: unknown): boolean => {
  const e = (err as { driverError?: { code?: string; constraint?: string }; message?: string } | null) ?? null;
  if (!e || typeof e !== "object" || e.driverError?.code !== "23505") return false;
  return e.driverError.constraint === UPLOAD_NOTIFICATION_INDEX || (e.message ?? "").includes(UPLOAD_NOTIFICATION_INDEX);
};

/** Users already holding a notification for this batch, so a retried emit or a second hook call adds none. */
const alreadyNotified = async (uploadBatchId: string): Promise<Set<number>> => {
  const rows: { user_id: number }[] = await AppDataSource.query(
    `SELECT user_id FROM notification WHERE type = $1 AND meta->>'upload_batch_id' = $2`,
    [UPLOAD_PENDING_TYPE, uploadBatchId]
  );
  return new Set(rows.map((r) => r.user_id));
};

const loadNames = async (event: BatchCommittedEvent): Promise<{ uploader: string; sites: string[] }> => {
  const [uploaderRows, siteRows] = await Promise.all([
    AppDataSource.query(`SELECT name, last_name FROM "user" WHERE user_id = $1`, [event.created_by]) as Promise<
      { name: string | null; last_name: string | null }[]
    >,
    AppDataSource.query(`SELECT name FROM site WHERE company_id = $1 AND site_id = ANY($2::int[]) ORDER BY site_id`, [
      event.company_id,
      event.site_ids,
    ]) as Promise<{ name: string }[]>,
  ]);
  const u = uploaderRows[0];
  const uploader = u ? `${u.name || ""} ${u.last_name || ""}`.trim() || "A colleague" : "A colleague";
  return { uploader, sites: siteRows.map((s) => s.name) };
};

/**
 * Write the notifications for one committed batch. Safe to call from the
 * emitter or from the internal endpoint; never throws. Idempotent per
 * batch id: recipients already notified for it are skipped. `emailed`
 * counts emails queued for sending, not deliveries.
 */
export const notifyBatchCommitted = async (event: BatchCommittedEvent): Promise<{ notified: number; emailed: number }> => {
  let notified = 0;
  let emailed = 0;
  try {
    const [recipients, names, done] = await Promise.all([
      findRecipients(event),
      loadNames(event),
      alreadyNotified(event.upload_batch_id),
    ]);
    const items = buildUploadNotifications(event, recipients, names.uploader, names.sites).filter((i) => !done.has(i.user_id));
    for (const item of items) {
      try {
        await createNotification(item.user_id, item.type, item.title, item.message, item.link, item.meta);
        notified += 1;
        if (item.email) {
          await sendToQueue({
            type: UPLOAD_PENDING_TYPE,
            email: item.email.email,
            name: item.email.name,
            retryCount: 0,
            rows: event.rows,
            tco2e: event.tco2e,
            siteNames: names.sites,
            period: monthsLabel(event.months),
            deepLink: item.link,
          });
          emailed += 1;
        }
      } catch (err) {
        // Unique index hit: a concurrent emit got there first. Not an error, not a duplicate.
        if (isUniqueViolation(err)) continue;
        console.error(
          `[UploadNotify] user ${item.user_id} batch ${event.upload_batch_id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    console.error(`[UploadNotify] batch ${event.upload_batch_id}:`, err instanceof Error ? err.message : err);
  }
  return { notified, emailed };
};

let unregister: (() => void) | null = null;

/** Subscribe to the batch-committed hook once (idempotent). */
export const registerUploadNotifyListener = (): void => {
  if (unregister) return;
  unregister = onBatchCommitted(async (event) => {
    await notifyBatchCommitted(event);
  });
};
