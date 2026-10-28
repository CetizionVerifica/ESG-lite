import { EmailJobCategorySummary } from "../types/email";

// ============================================================================
// ESGLite - Clean Email Templates
// ============================================================================

const frontendUrl = () => (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

/** When the email was written. The server's clock is UTC, so say so: an unlabelled time read as local was hours off. */
const ts = () =>
  `${new Date().toLocaleString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} UTC`;

/** Names, comments and site or category names are typed by people: escape them before they go into HTML. A queued job's value may not be a string (a number sent as a reason), so it is made one. */
const escapeHtml = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ── Layout ──────────────────────────────────────────────────────────────────

const layout = (body: string, accent = "#2563eb") => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="format-detection" content="telephone=no,address=no,email=no">
<!--[if mso]><style>body,table,td,a{font-family:Segoe UI,Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Segoe UI,Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

  <!-- Card -->
  <tr><td style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">

    <!-- Header -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:32px 40px 0 40px;">
        <p style="margin:0;font-size:17px;font-weight:700;color:#18181b;">ESGLite</p>
      </td></tr>
      <tr><td style="padding:16px 0 0 0;height:2px;"><div style="height:2px;background-color:${accent};"></div></td></tr>
    </table>

    <!-- Body -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:32px 40px 40px 40px;">
        ${body}
      </td></tr>
    </table>

  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 40px 0 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-size:11px;color:#a1a1aa;line-height:1.4;">
          ${ts()}<br/>
          This is an automated notification from ESGLite.
        </td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

// ── Components ──────────────────────────────────────────────────────────────

const hi = (name: string) =>
  `<p style="margin:0 0 24px 0;font-size:15px;color:#27272a;line-height:1.5;">Hi <strong>${escapeHtml(name)}</strong>,</p>`;

const p = (s: string) =>
  `<p style="margin:0 0 24px 0;font-size:14px;color:#52525b;line-height:1.7;">${s}</p>`;

const statusBar = (label: string, color: string, bg: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
    <tr><td style="padding:14px 20px;background-color:${bg};border-radius:6px;">
      <span style="font-size:15px;font-weight:700;color:${color};">${label}</span>
    </td></tr>
  </table>`;

/** Label and value rows; the values are plain text. */
const details = (rows: [string, string][]) => {
  if (rows.length === 0) return "";
  const r = rows.map(([k, v], i) =>
    `<tr>
      <td style="padding:12px 16px;font-size:12px;color:#71717a;font-weight:600;vertical-align:top;width:35%;${i < rows.length - 1 ? "border-bottom:1px solid #f4f4f5;" : ""}">${k}</td>
      <td style="padding:12px 16px;font-size:14px;color:#27272a;vertical-align:top;${i < rows.length - 1 ? "border-bottom:1px solid #f4f4f5;" : ""}">${escapeHtml(v)}</td>
    </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fafafa;border:1px solid #e4e4e7;border-radius:6px;margin-bottom:28px;overflow:hidden;">${r}</table>`;
};

const rejectionBox = (comment: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
    <tr><td style="padding:16px 20px;background-color:#fef2f2;border-radius:6px;">
      <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;">Reason for Rejection</p>
      <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.6;">${escapeHtml(comment).replace(/\n/g, "<br/>")}</p>
    </td></tr>
  </table>`;

const actionBy = (label: string, name: string) =>
  `<p style="margin:0 0 8px 0;font-size:13px;color:#71717a;line-height:1.5;">${label}: <strong style="color:#27272a;">${escapeHtml(name)}</strong></p>`;

const cta = (label: string, link: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
    <tr><td>
      <a href="${frontendUrl()}${link}" target="_blank" style="display:inline-block;padding:12px 28px;background-color:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">
        ${label}
      </a>
    </td></tr>
  </table>`;

const sign = () =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
    <tr><td style="border-top:1px solid #f0f0f3;padding-top:24px;">
      <p style="margin:0;font-size:14px;color:#52525b;line-height:1.5;">Best regards,<br/><strong style="color:#27272a;">ESGLite Team</strong></p>
    </td></tr>
  </table>`;

const gap = () => `<div style="height:20px;"></div>`;

const catTable = (items: EmailJobCategorySummary[], header: string, color: string) => {
  const rows = items.map((item, i) =>
    `<tr>
      <td style="padding:10px 16px;font-size:14px;color:#27272a;${i < items.length - 1 ? "border-bottom:1px solid #f0f0f3;" : ""}background-color:${i % 2 === 0 ? "#ffffff" : "#fafafa"};">${escapeHtml(item.categoryName)}</td>
      <td style="padding:10px 16px;font-size:14px;color:#27272a;text-align:center;font-weight:700;${i < items.length - 1 ? "border-bottom:1px solid #f0f0f3;" : ""}background-color:${i % 2 === 0 ? "#ffffff" : "#fafafa"};">${item.count}</td>
    </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e4e4e7;border-radius:6px;overflow:hidden;margin-bottom:28px;">
    <tr>
      <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;background-color:${color};text-transform:uppercase;letter-spacing:0.5px;">${header}</th>
      <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#ffffff;background-color:${color};text-transform:uppercase;letter-spacing:0.5px;">Count</th>
    </tr>${rows}</table>`;
};

// ── Type ────────────────────────────────────────────────────────────────────

type AI = { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string; deepLink?: string };

// ============================================================================
// EMISSION
// ============================================================================

export const successTemplate = (name: string, categoryName?: string, siteName?: string, ai?: AI) => ({
  subject: "Your emission data was approved — ESGLite",
  html: layout([
    hi(name),
    p("Your emission data has been reviewed and <strong>approved</strong>. It is now part of your organization's official emission records."),
    statusBar("Approved", "#15803d", "#f0fdf4"),
    details([
      ...(categoryName ? [["Category", categoryName] as [string, string]] : []),
      ...(siteName ? [["Site", siteName] as [string, string]] : []),
    ]),
    ai?.managerName ? actionBy("Approved by", ai.managerName) : "",
    cta("View Details", ai?.deepLink || "/my-emissions"),
    sign(),
  ].filter(Boolean).join(""), "#16a34a"),
});

export const rejectTemplate = (name: string, categoryName?: string, siteName?: string, comment?: string, ai?: AI) => ({
  subject: "Your emission data was rejected — ESGLite",
  html: layout([
    hi(name),
    p("Your emission data has been reviewed and <strong>rejected</strong>. Please review the feedback below and resubmit with the necessary corrections."),
    statusBar("Rejected", "#dc2626", "#fef2f2"),
    details([
      ...(categoryName ? [["Category", categoryName] as [string, string]] : []),
      ...(siteName ? [["Site", siteName] as [string, string]] : []),
    ]),
    comment ? rejectionBox(comment) : "",
    ai?.managerName ? actionBy("Rejected by", ai.managerName) : "",
    cta("Review & Resubmit", ai?.deepLink || "/my-emissions"),
    sign(),
  ].filter(Boolean).join(""), "#dc2626"),
});

export const bulkApprovedTemplate = (name: string, count: number, categories: EmailJobCategorySummary[], ai?: AI) => ({
  subject: `${count} emission entries approved — ESGLite`,
  html: layout([
    hi(name),
    p(`<strong>${count}</strong> of your emission entries have been <strong>approved</strong>.`),
    statusBar("Approved", "#15803d", "#f0fdf4"),
    categories.length > 0 ? catTable(categories, "Category", "#16a34a") : "",
    ai?.managerName ? actionBy("Approved by", ai.managerName) : "",
    cta("View Details", ai?.deepLink || "/my-emissions"),
    sign(),
  ].filter(Boolean).join(""), "#16a34a"),
});

export const bulkRejectedTemplate = (name: string, count: number, categories: EmailJobCategorySummary[], comment?: string, ai?: AI) => ({
  subject: `${count} emission entries rejected — ESGLite`,
  html: layout([
    hi(name),
    p(`<strong>${count}</strong> of your emission entries have been <strong>rejected</strong>.`),
    statusBar("Rejected", "#dc2626", "#fef2f2"),
    categories.length > 0 ? catTable(categories, "Category", "#dc2626") : "",
    comment ? rejectionBox(comment) : "",
    ai?.managerName ? actionBy("Rejected by", ai.managerName) : "",
    cta("Review & Resubmit", ai?.deepLink || "/my-emissions"),
    sign(),
  ].filter(Boolean).join(""), "#dc2626"),
});

// ============================================================================
// PRODUCTION DATA
// ============================================================================

export const productionApprovedTemplate = (name: string, productName?: string, siteName?: string, ai?: AI) => ({
  subject: "Your production data was approved — ESGLite",
  html: layout([
    hi(name),
    p("Your production data has been reviewed and <strong>approved</strong>."),
    statusBar("Approved", "#15803d", "#f0fdf4"),
    details([
      ...(productName ? [["Product", productName] as [string, string]] : []),
      ...(siteName ? [["Site", siteName] as [string, string]] : []),
    ]),
    ai?.managerName ? actionBy("Approved by", ai.managerName) : "",
    sign(),
  ].filter(Boolean).join(""), "#16a34a"),
});

export const productionRejectedTemplate = (name: string, productName?: string, siteName?: string, comment?: string, ai?: AI) => ({
  subject: "Your production data was rejected — ESGLite",
  html: layout([
    hi(name),
    p("Your production data has been reviewed and <strong>rejected</strong>. Please review and resubmit."),
    statusBar("Rejected", "#dc2626", "#fef2f2"),
    details([
      ...(productName ? [["Product", productName] as [string, string]] : []),
      ...(siteName ? [["Site", siteName] as [string, string]] : []),
    ]),
    comment ? rejectionBox(comment) : "",
    ai?.managerName ? actionBy("Rejected by", ai.managerName) : "",
    sign(),
  ].filter(Boolean).join(""), "#dc2626"),
});

export const bulkProductionApprovedTemplate = (name: string, count: number, products: EmailJobCategorySummary[], ai?: AI) => ({
  subject: `${count} production entries approved — ESGLite`,
  html: layout([
    hi(name),
    p(`<strong>${count}</strong> production data entries have been <strong>approved</strong>.`),
    statusBar("Approved", "#15803d", "#f0fdf4"),
    products.length > 0 ? catTable(products, "Product", "#16a34a") : "",
    ai?.managerName ? actionBy("Approved by", ai.managerName) : "",
    sign(),
  ].filter(Boolean).join(""), "#16a34a"),
});

export const bulkProductionRejectedTemplate = (name: string, count: number, products: EmailJobCategorySummary[], comment?: string, ai?: AI) => ({
  subject: `${count} production entries rejected — ESGLite`,
  html: layout([
    hi(name),
    p(`<strong>${count}</strong> production data entries have been <strong>rejected</strong>.`),
    statusBar("Rejected", "#dc2626", "#fef2f2"),
    products.length > 0 ? catTable(products, "Product", "#dc2626") : "",
    comment ? rejectionBox(comment) : "",
    ai?.managerName ? actionBy("Rejected by", ai.managerName) : "",
    sign(),
  ].filter(Boolean).join(""), "#dc2626"),
});

// ============================================================================
// DEADLINE
// ============================================================================

export const deadlineReminderTemplate = (name: string, month: string, year: number, siteName?: string) => ({
  subject: `Reminder: Submit your data for ${month} ${year} — ESGLite`,
  html: layout([
    hi(name),
    p(`You haven't submitted your emission data for <strong>${month} ${year}</strong> yet. Please submit before the deadline.`),
    statusBar("Submission Reminder", "#d97706", "#fffbeb"),
    details([
      ["Period", `${month} ${year}`],
      ...(siteName ? [["Site", siteName] as [string, string]] : []),
      ["Deadline", "10th of every month"],
    ]),
    cta("Submit Your Data", "/data/new"),
    sign(),
  ].join(""), "#d97706"),
});

export const escalationTemplate = (name: string, month: string, year: number, users: { name: string; email: string; role: string; siteName: string }[]) => {
  const rows = users.map((u, i) =>
    `<tr>
      <td style="padding:10px 16px;font-size:14px;color:#27272a;${i < users.length - 1 ? "border-bottom:1px solid #f0f0f3;" : ""}background-color:${i % 2 === 0 ? "#ffffff" : "#fafafa"};">${escapeHtml(u.name)}</td>
      <td style="padding:10px 16px;font-size:13px;color:#52525b;${i < users.length - 1 ? "border-bottom:1px solid #f0f0f3;" : ""}background-color:${i % 2 === 0 ? "#ffffff" : "#fafafa"};">${escapeHtml(u.email)}</td>
      <td style="padding:10px 16px;font-size:13px;color:#52525b;${i < users.length - 1 ? "border-bottom:1px solid #f0f0f3;" : ""}background-color:${i % 2 === 0 ? "#ffffff" : "#fafafa"};">${escapeHtml(u.siteName)}</td>
    </tr>`).join("");
  // A person missing two sites is one person (one row per site below).
  const people = new Set(users.map((u) => u.email)).size;
  return {
    subject: `${people} ${people === 1 ? "user hasn't" : "users haven't"} submitted data for ${month} ${year} — ESGLite`,
    html: layout([
      hi(name),
      p(`<strong>${people}</strong> user(s) have not submitted their emission data for <strong>${month} ${year}</strong>.`),
      statusBar("Escalation", "#d97706", "#fffbeb"),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e4e4e7;border-radius:6px;overflow:hidden;margin-bottom:28px;">
        <tr>
          <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;background-color:#b45309;text-transform:uppercase;letter-spacing:0.5px;">Name</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;background-color:#b45309;text-transform:uppercase;letter-spacing:0.5px;">Email</th>
          <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#ffffff;background-color:#b45309;text-transform:uppercase;letter-spacing:0.5px;">Site</th>
        </tr>${rows}</table>`,
      cta("View submission status", "/overview"),
      sign(),
    ].join(""), "#d97706"),
  };
};

// ============================================================================
// ADMIN
// ============================================================================

export const failureTemplate = (email: string) => ({
  subject: "Email delivery failed — ESGLite",
  html: layout([
    hi("Admin"),
    p(`An email to <strong>${escapeHtml(email)}</strong> has permanently failed after all retry attempts.`),
    statusBar("Delivery Failed", "#dc2626", "#fef2f2"),
    details([["Recipient", email], ["Status", "All retries exhausted"]]),
    p("Please check RabbitMQ and Brevo logs for details."),
    sign(),
  ].join(""), "#dc2626"),
});

/** IM4: a committed import batch is waiting for the manager's review. Counts only, no row data. */
export const uploadPendingTemplate = (name: string, rows: number, tco2e: number, siteNames: string[], period: string, deepLink?: string) => {
  const sites = siteNames.join(", ");
  const when = period;
  return {
    subject: "Entries waiting for your review — ESGLite",
    html: layout([
      hi(name),
      p(`<strong>${rows}</strong> ${rows === 1 ? "entry is" : "entries are"} waiting for your review${sites ? ` for <strong>${escapeHtml(sites)}</strong>` : ""}${when ? ` (${escapeHtml(when)})` : ""}.`),
      statusBar("Waiting for review", "#2563eb", "#eff6ff"),
      details([
        ["Entries", String(rows)],
        ["Total", `${tco2e.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tCO₂e`],
        ...(sites ? [["Sites", sites] as [string, string]] : []),
        ...(when ? [["Period", when] as [string, string]] : []),
      ]),
      cta("Review entries", deepLink || "/data/approvals?view=batches"),
      sign(),
    ].join(""), "#2563eb"),
  };
};
