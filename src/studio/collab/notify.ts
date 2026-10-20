/**
 * DS-13 · notifications for mentions, tasks and approvals (D13): an in-app
 * notification (`notificationService.createNotification`, pushed over SSE)
 * and an email with the same deep link. The email is best effort: skipped
 * when mail isn't configured or the person set
 * `notification_preferences.email_studio = false`; a failure is logged with
 * ids only and never fails the request. Never sends report text beyond the
 * comment's first 280 characters, which the recipient can read anyway.
 */
import { AppDataSource } from "../../config/data-source";
import { frontendBaseUrl } from "../../config/mailer";
import { sendEmailForApprove } from "../../services/emailService";
import { createNotification } from "../../services/notificationService";
import type { StudioNotificationType } from "../contracts";

type Row = Record<string, any>;

export interface StudioNotice {
  userId: number;
  type: StudioNotificationType;
  title: string;
  message: string;
  /** App path, e.g. /studio/12?page=p-1&el=p-1.title&comment=4 */
  link: string;
  meta: Record<string, unknown>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** The plain email the notice becomes (exported for the unit test). */
export function noticeEmail(n: Pick<StudioNotice, "title" | "message" | "link">, base: string): { subject: string; html: string } {
  const url = `${base.replace(/\/$/, "")}${n.link}`;
  return {
    subject: n.title,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#16202e;line-height:1.5"><p style="font-size:16px;font-weight:600;margin:0 0 12px">${esc(n.title)}</p><p style="margin:0 0 16px;white-space:pre-wrap">${esc(n.message)}</p><p style="margin:0 0 16px"><a href="${esc(url)}" style="display:inline-block;background:#2572c0;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px">Open in Design Studio</a></p><p style="margin:0;color:#5b6b7f;font-size:12px">You can turn off these emails in your notification settings.</p></div>`,
  };
}

export const shorten = (text: string, max = 280) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Sends each notice (in-app, then email). Returns how many were created in-app. */
export async function sendNotices(notices: StudioNotice[]): Promise<number> {
  let sent = 0;
  for (const n of notices) {
    try {
      await createNotification(n.userId, n.type, n.title, n.message, n.link, n.meta as never);
      sent++;
    } catch (err) {
      console.warn(`[studio] ${n.type} to user ${n.userId}: notification not saved:`, (err as Error)?.message);
      continue;
    }
    try {
      const [u]: Row[] = await AppDataSource.query(`SELECT email, notification_preferences FROM "user" WHERE user_id = $1`, [n.userId]);
      if (!u?.email || u.notification_preferences?.email_studio === false) continue;
      const mail = noticeEmail(n, frontendBaseUrl());
      // Not awaited by the request path's outcome: a mail failure only logs.
      await sendEmailForApprove({ to: u.email, subject: mail.subject, html: mail.html });
    } catch (err) {
      console.warn(`[studio] ${n.type} email to user ${n.userId} failed:`, (err as Error)?.message);
    }
  }
  return sent;
}
