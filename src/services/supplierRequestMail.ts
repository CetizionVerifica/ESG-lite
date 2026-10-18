// The email a supplier data request sends (PCF phase 3, C06).
//
// Sending mail to an outside address is an outward action, so:
//   * the manager sees the exact message before an explicit "Send" (the FE
//     renders `buildMessage` and the backend stores what it sent);
//   * by default the message goes to the DEV SINK: it is stored on the
//     request and logged, never delivered. Only SUPPLIER_REQUEST_MAIL=live
//     delivers through Brevo, and that switch stays off until the product
//     owner turns it on.
import { log } from "../utils/logger";
import { sendEmailForApprove } from "./emailService";
import { mailConfigured } from "../config/mailer";

export type MailMode = "sink" | "live";

export const mailMode = (): MailMode => (process.env.SUPPLIER_REQUEST_MAIL === "live" ? "live" : "sink");

export const frontendUrl = () => (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

export const supplierLink = (token: string) => `${frontendUrl()}/supplier/${token}`;

export interface MessageInput {
  companyName: string;
  managerName: string;
  managerEmail: string;
  supplierName: string | null;
  material: string;
  unit: string;
  dueDate: string | null;
  boundary: "cradle_to_gate" | "cradle_to_grave";
  note: string | null;
  link: string;
}

const boundaryWords = (b: MessageInput["boundary"]) => (b === "cradle_to_grave" ? "cradle-to-grave" : "cradle-to-gate (A1–A3)");

const dueWords = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return ` by ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;
};

/** The plain-text message (also what the manager approves); `{link}` is the upload link. */
export function buildMessage(m: MessageInput): { subject: string; text: string } {
  const subject = `${m.companyName}: product carbon footprint data for ${m.material}`;
  const lines = [
    `Dear ${m.supplierName?.trim() || "supplier"},`,
    "",
    `${m.companyName} is calculating the carbon footprint of its products and needs the ${boundaryWords(m.boundary)} footprint of ${m.material}, in kg CO₂e per ${m.unit}${dueWords(m.dueDate)}.`,
    "",
    "Please use the link below to upload your product carbon footprint or environmental product declaration (PDF or PACT JSON), or to type the value, its system boundary and reference period:",
    m.link,
    "",
    "The link needs no account and stops working once the request is closed.",
  ];
  if (m.note?.trim()) lines.push("", m.note.trim());
  lines.push("", "Thank you,", `${m.managerName} (${m.managerEmail})`, m.companyName);
  return { subject, text: lines.join("\n") };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const toHtml = (text: string, link: string) =>
  `<p style="font-family: Arial, sans-serif; white-space: pre-wrap; line-height: 1.5">${escapeHtml(text).replace(
    escapeHtml(link),
    `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`,
  )}</p>`;

export interface Delivery {
  mode: MailMode;
  delivered: boolean;
  reason: string | null;
}

/**
 * Delivers (live) or sinks (default) the message. Never throws: a failure
 * comes back as `delivered: false` with a reason the UI shows beside the
 * copyable link. Logs ids and the address's domain only, never the text.
 */
export async function deliver(requestId: number, to: string, subject: string, text: string, link: string): Promise<Delivery> {
  const domain = to.split("@")[1] ?? "";
  if (mailMode() !== "live") {
    log.info("SupplierRequest", "Mail sunk (SUPPLIER_REQUEST_MAIL is not 'live'); copy the link from the request", { requestId, domain });
    return { mode: "sink", delivered: false, reason: "Email sending is off on this server, so the message wasn't sent. Copy the link and send it yourself." };
  }
  if (!mailConfigured()) {
    log.warn("SupplierRequest", "Mail not sent: Brevo isn't configured", { requestId, domain });
    return { mode: "live", delivered: false, reason: "Email isn't configured on this server, so the message wasn't sent. Copy the link and send it yourself." };
  }
  try {
    await sendEmailForApprove({ to, subject, html: toHtml(text, link) });
    log.info("SupplierRequest", "Mail sent", { requestId, domain });
    return { mode: "live", delivered: true, reason: null };
  } catch (err) {
    log.error("SupplierRequest", "Mail failed", { requestId, domain, error: err instanceof Error ? err.message : String(err) });
    return { mode: "live", delivered: false, reason: "The email couldn't be sent. Copy the link and send it yourself." };
  }
}
