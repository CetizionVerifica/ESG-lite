import { AppDataSource } from "../config/data-source";
import { UserRole } from "../types/type";
import { closeConnections } from "./sseManager";

/**
 * Deactivated clients (`company.status = false`).
 *
 * People of a deactivated client cannot sign in, and a session they already
 * hold stops working: `authenticate` asks `isUserClientInactive` on every
 * request. Superadmins are never blocked. A user is blocked only when every
 * company their site(s) belong to is inactive, so a user with no company (or
 * one active company among several) keeps access.
 *
 * The answer is cached per user for a short time so a busy page does not cost
 * one query per request; changing a client's status clears the cache, so a
 * deactivation takes effect on the next request.
 */

export const CLIENT_INACTIVE_CODE = "CLIENT_INACTIVE";
export const CLIENT_INACTIVE_MESSAGE =
  "Your organisation's ESGLite account is inactive. Contact your ESGLite administrator.";

const CACHE_MS = 60_000;
let cache = new Map<number, { inactive: boolean; at: number }>();

/** Drop every cached answer (call after any change to a company's status). */
export const clearClientStatusCache = (): void => {
  cache = new Map();
};

const lookup = async (userId: number): Promise<boolean> => {
  const rows: { status: boolean }[] = await AppDataSource.query(
    `SELECT c.status
       FROM company c
      WHERE c.company_id IN (
            SELECT s.company_id FROM site s JOIN "user" u ON u.site_id = s.site_id WHERE u.user_id = $1
            UNION
            SELECT s.company_id FROM site s JOIN user_sites us ON us.site_id = s.site_id WHERE us.user_id = $1
      )`,
    [userId],
  );
  return rows.length > 0 && rows.every((r) => r.status === false);
};

export const isUserClientInactive = async (userId: number, role?: string): Promise<boolean> => {
  if (role === UserRole.SUPERADMIN || !Number.isInteger(userId)) return false;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.inactive;
  const inactive = await lookup(userId);
  cache.set(userId, { inactive, at: Date.now() });
  return inactive;
};

/**
 * After a client is deactivated: end the open notification streams of its
 * people who are now cut off (people who also work for an active client keep
 * theirs). Clears the cache first so the answers are fresh.
 */
export const closeInactiveClientStreams = async (companyId: number): Promise<void> => {
  clearClientStatusCache();
  const rows: { user_id: number; role: string }[] = await AppDataSource.query(
    `SELECT DISTINCT u.user_id, u.role
       FROM "user" u
      WHERE u.site_id IN (SELECT site_id FROM site WHERE company_id = $1)
         OR u.user_id IN (SELECT us.user_id FROM user_sites us JOIN site s ON s.site_id = us.site_id WHERE s.company_id = $1)`,
    [companyId],
  );
  for (const r of rows) {
    if (await isUserClientInactive(Number(r.user_id), r.role)) closeConnections(Number(r.user_id));
  }
};
