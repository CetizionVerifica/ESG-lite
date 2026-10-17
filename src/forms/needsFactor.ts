/**
 * SE-4 · "A form needs a factor": when a User's row can't be calculated
 * because the site has no emission factor for its activity, every Superadmin
 * hears about it once per site × category × month (bell + SSE).
 *
 * Called from the save and the live check of a User's row; neither waits on
 * it or fails because of it (errors are logged with ids only).
 */
import type { EntityManager } from "typeorm";
import { createNotification } from "../services/notificationService";
import { UserRole } from "../types/type";

export const FORM_NEEDS_FACTOR_TYPE = "form_needs_factor";

export interface NeedsFactor {
  site_id: number;
  category_id: number;
  /** The row's date; its month is the once-per key. */
  date_of_reporting: string | Date;
  /** The factor name the row asked for. */
  activity: string;
  /** The form the row was entered on, for the link. */
  form_id?: number | null;
}

/** Keys this process already notified (or found notified), so repeat checks skip the database. */
let handled = new Set<string>();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-03" → "Mar 2026". */
export const monthLabel = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

const monthOf = (d: string | Date): string | null => {
  const s = typeof d === "string" ? d.slice(0, 7) : new Date(d).toISOString().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
};

export const needsFactorKey = (n: Pick<NeedsFactor, "site_id" | "category_id" | "date_of_reporting">): string | null => {
  const month = monthOf(n.date_of_reporting);
  return month ? `${n.site_id}:${n.category_id}:${month}` : null;
};

/**
 * Notify every Superadmin, unless this site × category × month was already
 * reported. Returns how many were notified (0 when it was already reported).
 * An advisory lock on the key keeps two checks at once from both notifying.
 */
export async function notifyFormNeedsFactor(manager: EntityManager, n: NeedsFactor): Promise<number> {
  const key = needsFactorKey(n);
  if (!key || handled.has(key)) return 0;
  const sent = await manager.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${FORM_NEEDS_FACTOR_TYPE}:${key}`]);
    const [seen] = await tx.query(`SELECT 1 FROM notification WHERE type = $1 AND meta->>'needs_factor_key' = $2 LIMIT 1`, [FORM_NEEDS_FACTOR_TYPE, key]);
    if (seen) return 0;
    const [where] = await tx.query(`SELECT s.name AS site_name, c.category_name FROM site s, category c WHERE s.site_id = $1 AND c.category_id = $2`, [n.site_id, n.category_id]);
    if (!where) return 0;
    const admins: Array<{ user_id: number }> = await tx.query(`SELECT user_id FROM "user" WHERE role = $1 ORDER BY user_id`, [UserRole.SUPERADMIN]);
    const month = key.slice(key.lastIndexOf(":") + 1);
    const title = "A form needs an emission factor";
    const message = `${where.site_name} · ${where.category_name}: a contributor's ${monthLabel(month)} row asks for "${n.activity}", which has no emission factor on this site, so it can't be calculated.`;
    const link = n.form_id ? `/capture/forms/${n.form_id}?tab=check` : "/capture/forms";
    const meta = { needs_factor_key: key, site_id: n.site_id, category_id: n.category_id, month, activity: n.activity, form_id: n.form_id ?? null };
    for (const a of admins) await createNotification(a.user_id, FORM_NEEDS_FACTOR_TYPE, title, message, link, meta);
    return admins.length;
  });
  if (handled.size > 10000) handled = new Set();
  handled.add(key);
  return sent;
}

/** Fire and forget: a User's save or check never waits on (or fails with) the notification. */
export const reportFormNeedsFactor = (manager: EntityManager, n: NeedsFactor): void => {
  notifyFormNeedsFactor(manager, n).catch((err) =>
    console.error(`[SE-4] form-needs-factor notification failed for site ${n.site_id} category ${n.category_id}:`, err instanceof Error ? err.message : err),
  );
};
