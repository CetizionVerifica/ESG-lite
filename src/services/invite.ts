import crypto from "crypto";
import bcrypt from "bcrypt";
import { AppDataSource } from "../config/data-source";
import { User } from "../entities/User";
import { getMg } from "../config/mailer";
import { sendInviteEmail } from "./emailService";

/**
 * Invites reuse the password-reset token columns: the person follows the link
 * to the reset-password page and chooses a password, which also clears the
 * token. Only the SHA-256 of the token is stored, as for resets.
 */

export const INVITE_VALID_DAYS = 7;

/** A bcrypt hash of random bytes: nobody can sign in with it. */
export const unusablePasswordHash = (): Promise<string> =>
  bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

export type InviteResult = { sent: true; expiresAt: Date } | { sent: false; reason: string };

/**
 * Issues a fresh invite for `user` (any earlier invite or reset link stops
 * working) and emails it. Never throws: a failure comes back as `sent: false`
 * with a reason the caller shows as a warning.
 */
export const issueInvite = async (user: User, companyName?: string): Promise<InviteResult> => {
  if (!getMg()) return { sent: false, reason: "Email isn't configured on this server, so the invite wasn't sent." };

  const repo = AppDataSource.getRepository(User);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_VALID_DAYS * 24 * 60 * 60 * 1000);
  await repo.update(user.user_id, {
    password_reset_token: crypto.createHash("sha256").update(token).digest("hex"),
    password_reset_expires: expiresAt,
  });

  try {
    await sendInviteEmail(user.email, token, user.name, companyName, INVITE_VALID_DAYS);
    return { sent: true, expiresAt };
  } catch (err) {
    console.error("Invite email failed:", err);
    await repo.update(user.user_id, { password_reset_token: null as any, password_reset_expires: null as any });
    return { sent: false, reason: "The invite email couldn't be sent. Try again from the client's People tab." };
  }
};
