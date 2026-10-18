import dotenv from "dotenv";

dotenv.config();

/** Brevo transactional email API (https://developers.brevo.com/reference/sendtransacemail). */
const BREVO_URL = process.env.BREVO_API_URL?.trim() || "https://api.brevo.com/v3/smtp/email";

const apiKey = () => process.env.BREVO_API_KEY?.trim() || "";

/**
 * Sender as "Name <address>" or a bare address. Brevo only sends from a
 * sender or domain verified in the Brevo account, so there is no default.
 */
export const MAIL_FROM = process.env.MAIL_FROM?.trim() || "";

function parseSender(from: string): { name?: string; email: string } | null {
  const m = from.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (m) return { ...(m[1] ? { name: m[1] } : {}), email: m[2] };
  return /^[^\s@<>]+@[^\s@<>]+$/.test(from) ? { email: from } : null;
}

/** Links in emails point here; without it a reset or invite link is a bare path that opens nothing. */
export const frontendBaseUrl = () => (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");

/** Why no email can go out (any kind), or null when it can. */
function senderProblem(): string | null {
  if (!apiKey()) return "BREVO_API_KEY is not set";
  if (!MAIL_FROM) return "MAIL_FROM is not set";
  if (!parseSender(MAIL_FROM)) return `MAIL_FROM is not an email address ("${MAIL_FROM}")`;
  return null;
}

/** True when Brevo is set up to send. */
export const mailConfigured = () => senderProblem() === null;

/**
 * Why account emails (password reset, invites) can't go out, or null when they can.
 * They also need FRONTEND_URL for the link.
 */
export function accountMailProblem(): string | null {
  const problem = senderProblem();
  if (problem) return problem;
  if (!frontendBaseUrl()) return "FRONTEND_URL is not set";
  return null;
}

/**
 * Sends one email through Brevo. Throws with Brevo's status and message on a
 * rejection (the email worker looks for "429" to back off).
 */
export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<{ messageId?: string }> {
  const problem = senderProblem();
  if (problem) throw new Error(`Email isn't configured on this server (${problem})`);
  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: { "api-key": apiKey(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: parseSender(MAIL_FROM), to: [{ email: to }], subject, htmlContent: html }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Brevo ${res.status}: ${body?.message || res.statusText}${body?.code ? ` (${body.code})` : ""}`);
  }
  return { messageId: body?.messageId };
}

/** One line at startup saying whether mail goes out, so the server log answers "is email on?". */
export function logMailStatus() {
  const problem = accountMailProblem();
  if (problem) {
    console.warn(`[Mail] OFF for password reset and invites: ${problem}.`);
  } else {
    console.log(`[Mail] Brevo on: from ${MAIL_FROM}.`);
  }
  console.log(`[Mail] Supplier requests: ${process.env.SUPPLIER_REQUEST_MAIL === "live" ? "live" : "sink (not sent)"}.`);
}
