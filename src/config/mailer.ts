import Mailgun from "mailgun.js";
import formData from "form-data";
import dotenv from "dotenv";

dotenv.config();

const mailgun = new Mailgun(formData);

let _mg: ReturnType<typeof mailgun.client> | null = null;

export function getMg() {
  if (!_mg) {
    const key = process.env.MAILGUN_API_KEY;
    if (!key) {
      console.warn("MAILGUN_API_KEY not set — email sending will be disabled");
      return null;
    }
    // EU-region Mailgun domains need https://api.eu.mailgun.net; the client defaults to the US API.
    const url = process.env.MAILGUN_URL?.trim();
    _mg = mailgun.client({ username: "api", key, ...(url ? { url } : {}) });
  }
  return _mg;
}

export const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "mail.carbon-lens.com";

/** Sender address; it should be on MAILGUN_DOMAIN or providers mark the mail as spam. */
export const MAIL_FROM = process.env.MAIL_FROM?.trim() || "Carbon Lens <mail@mail.carbon-lens.com>";

/** Links in emails point here; without it a reset or invite link is a bare path that opens nothing. */
export const frontendBaseUrl = () => (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");

/**
 * Why account emails (password reset, invites) can't go out, or null when they can.
 * Checked without calling getMg() so it doesn't log on every request.
 */
export function accountMailProblem(): string | null {
  if (!process.env.MAILGUN_API_KEY) return "MAILGUN_API_KEY is not set";
  if (!frontendBaseUrl()) return "FRONTEND_URL is not set";
  return null;
}

/** One line at startup saying whether mail goes out, so the server log answers "is email on?". */
export function logMailStatus() {
  const problem = accountMailProblem();
  if (problem) {
    console.warn(`[Mail] OFF for password reset and invites: ${problem}.`);
  } else {
    console.log(`[Mail] Mailgun on: domain ${MAILGUN_DOMAIN}, from ${MAIL_FROM}, API ${process.env.MAILGUN_URL?.trim() || "https://api.mailgun.net (US)"}.`);
  }
  console.log(`[Mail] Supplier requests: ${process.env.SUPPLIER_REQUEST_MAIL === "live" ? "live" : "sink (not sent)"}.`);
}
