import { Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../config/data-source";
import { mailConfigured } from "../config/mailer";
import { sendLoginOtpEmail } from "../services/emailService";
import { completeLogin, findSessionUser } from "./auth.controller";
import { log } from "../utils/logger";

/**
 * Sign in with a one-time code sent by email, for people who forgot their
 * password ("Sign in with a code" on the login page).
 *
 * - The code is 6 digits, valid OTP_VALID_MINUTES, single use. A new request
 *   replaces the previous code.
 * - Only HMAC-SHA256(JWT_SECRET, "<user_id>:<code>") is stored, so a database
 *   read does not reveal live codes.
 * - OTP_MAX_ATTEMPTS wrong codes clear the code; the person asks for a new one.
 *   The routes are also rate limited per IP and account (authRateLimit).
 * - Unknown addresses get the same answer as known ones (no enumeration).
 */
export const OTP_VALID_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

const SENT_MESSAGE = "If an account with that email exists, we've sent it a sign-in code.";
const INVALID_MESSAGE = "That code is wrong or has expired. Check the email or ask for a new code.";

const hashCode = (userId: number, code: string) =>
  crypto
    .createHmac("sha256", process.env.JWT_SECRET || "")
    .update(`${userId}:${code}`)
    .digest("hex");

const normaliseEmail = (email: unknown) => (typeof email === "string" ? email.trim().toLowerCase() : "");

/**
 * POST /api/auth/login-otp/request
 * Body: { email: string }
 */
export const requestLoginOtp = async (req: Request, res: Response) => {
  try {
    const email = normaliseEmail(req.body?.email);
    if (!email) return res.status(400).json({ message: "Email is required" });

    // Same answer for every address: without mail no code can reach anyone.
    if (!mailConfigured()) {
      log.warn("Auth", "Sign-in code not sent: email isn't configured");
      return res.status(503).json({
        message: "Sign-in codes by email aren't set up on this server. Ask your administrator to reset your password.",
      });
    }

    const user = await findSessionUser(email);
    if (!user) {
      log.warn("Auth", "Sign-in code requested for unknown email", { email });
      return res.status(200).json({ message: SENT_MESSAGE });
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    await AppDataSource.query(
      `UPDATE "user" SET login_otp_hash = $1, login_otp_expires = $2, login_otp_attempts = 0 WHERE user_id = $3`,
      [hashCode(user.user_id, code), new Date(Date.now() + OTP_VALID_MINUTES * 60 * 1000), user.user_id],
    );

    try {
      await sendLoginOtpEmail(user.email, code, user.name, OTP_VALID_MINUTES);
    } catch (error) {
      await AppDataSource.query(
        `UPDATE "user" SET login_otp_hash = NULL, login_otp_expires = NULL, login_otp_attempts = NULL WHERE user_id = $1`,
        [user.user_id],
      );
      log.error("Auth", "Sign-in code email failed", { userId: user.user_id, error: String(error) });
      return res.status(500).json({ message: "We couldn't send the code. Please try again later." });
    }

    log.info("Auth", "Sign-in code sent", { userId: user.user_id });
    return res.status(200).json({ message: SENT_MESSAGE, expires_in_minutes: OTP_VALID_MINUTES });
  } catch (error) {
    log.error("Auth", "Sign-in code request error", { error: String(error) });
    return res.status(500).json({ message: "An error occurred. Please try again later." });
  }
};

/**
 * POST /api/auth/login-otp/verify
 * Body: { email: string, code: string }
 * Answers like POST /auth/login on success: { token, role, user }.
 */
export const verifyLoginOtp = async (req: Request, res: Response) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const code = typeof req.body?.code === "string" ? req.body.code.replace(/\s+/g, "") : "";
    if (!email || !code) return res.status(400).json({ message: "Email and code are required" });
    if (!/^\d{6}$/.test(code)) return res.status(401).json({ message: INVALID_MESSAGE });

    const user = await findSessionUser(email);
    if (!user) {
      log.warn("Auth", "Sign-in code failed — user not found", { email });
      return res.status(401).json({ message: INVALID_MESSAGE });
    }

    // One statement checks and spends the code, so it can't be used twice.
    const [, used] = await AppDataSource.query(
      `UPDATE "user" SET login_otp_hash = NULL, login_otp_expires = NULL, login_otp_attempts = NULL
        WHERE user_id = $1 AND login_otp_hash = $2 AND login_otp_expires > now()
          AND COALESCE(login_otp_attempts, 0) < $3`,
      [user.user_id, hashCode(user.user_id, code), OTP_MAX_ATTEMPTS],
    );

    if (!used) {
      // Count the wrong try; the last allowed one clears the code.
      await AppDataSource.query(
        `UPDATE "user"
            SET login_otp_attempts = COALESCE(login_otp_attempts, 0) + 1,
                login_otp_hash = CASE WHEN COALESCE(login_otp_attempts, 0) + 1 >= $2 THEN NULL ELSE login_otp_hash END,
                login_otp_expires = CASE WHEN COALESCE(login_otp_attempts, 0) + 1 >= $2 THEN NULL ELSE login_otp_expires END
          WHERE user_id = $1 AND login_otp_hash IS NOT NULL`,
        [user.user_id, OTP_MAX_ATTEMPTS],
      );
      log.warn("Auth", "Sign-in code failed — wrong or expired code", { userId: user.user_id });
      return res.status(401).json({ message: INVALID_MESSAGE });
    }

    return completeLogin(user, res, "email-code");
  } catch (error) {
    log.error("Auth", "Sign-in code verify error", { error: String(error) });
    return res.status(500).json({ message: "An error occurred. Please try again later." });
  }
};
