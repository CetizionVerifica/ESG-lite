import crypto from "crypto";
import { AppDataSource } from "../config/data-source";
import { purposeKey } from "../utils/jwt";

/**
 * A session token is checked against the person's row on every request, so a
 * deleted person, a changed role or a changed password ends the session at
 * once instead of when the token expires a day later.
 *
 * The token carries `pw`, a fingerprint of the password hash at sign-in. Any
 * password change (reset, invite accepted, an admin setting it) changes the
 * hash, so tokens signed before it stop working. No column or migration is
 * needed, and the hash itself never leaves the server: the fingerprint is an
 * HMAC under a key derived from JWT_SECRET.
 */
export const passwordStamp = (hash: string): string =>
  crypto.createHmac("sha256", purposeKey("session-password")).update(hash).digest("base64url").slice(0, 22);

/** The fingerprint to put in a new session token for `userId`. */
export const passwordStampOf = async (userId: number): Promise<string> => {
  const [row]: Array<{ password: string | null }> = await AppDataSource.query(`SELECT password FROM "user" WHERE user_id = $1`, [userId]);
  return passwordStamp(String(row?.password ?? ""));
};

const sameStamp = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type SessionProblem = "user_gone" | "role_changed" | "password_changed";

/** Why the session `payload` no longer holds, or null when it does. */
export async function sessionProblem(payload: { userId: number; role: string; pw?: unknown }): Promise<SessionProblem | null> {
  const [row]: Array<{ role: string; password: string | null }> = await AppDataSource.query(
    `SELECT role, password FROM "user" WHERE user_id = $1`,
    [payload.userId],
  );
  if (!row) return "user_gone";
  if (row.role !== payload.role) return "role_changed";
  // Tokens signed before this check carry no fingerprint; they expire within a day.
  if (typeof payload.pw === "string" && !sameStamp(payload.pw, passwordStamp(String(row.password ?? "")))) return "password_changed";
  return null;
}
