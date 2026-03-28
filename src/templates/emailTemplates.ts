import { EmailJobCategorySummary } from "../types/email";

// ============================================================================
// CARBON LENS - Premium Email Template System
// ============================================================================

// Color palette
const colors = {
  // Primary greens
  emerald900: "#064e3b",
  emerald800: "#065f46",
  emerald700: "#047857",
  emerald600: "#059669",
  emerald500: "#10b981",
  emerald100: "#d1fae5",
  emerald50: "#ecfdf5",
  // Teal accents
  teal700: "#0f766e",
  teal600: "#0d9488",
  // Neutrals
  gray900: "#111827",
  gray800: "#1f2937",
  gray700: "#374151",
  gray600: "#4b5563",
  gray500: "#6b7280",
  gray400: "#9ca3af",
  gray300: "#d1d5db",
  gray200: "#e5e7eb",
  gray100: "#f3f4f6",
  gray50: "#f9fafb",
  white: "#ffffff",
  // Accent
  blue600: "#2563eb",
  // Status colors
  red700: "#b91c1c",
  red600: "#dc2626",
  red100: "#fee2e2",
  red50: "#fef2f2",
  amber700: "#b45309",
  amber600: "#d97706",
  amber100: "#fef3c7",
  amber50: "#fffbeb",
};

// Shared timestamp
const timestamp = () => {
  const now = new Date();
  return now.toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
};

// ============================================================================
// BASE LAYOUT
// ============================================================================

const baseLayout = (content: string, accentColor: string = colors.emerald600) => `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Carbon Lens</title>
  <!--[if mso]>
  <style>body,table,td{font-family:Arial,Helvetica,sans-serif!important}</style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #eef2f0; font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
  <!-- Preheader (hidden) -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">Carbon Lens - Emission Management Platform&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #eef2f0;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width: 620px; width: 100%;">

          <!-- =============== HEADER =============== -->
          <tr>
            <td style="padding: 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(145deg, ${colors.teal700} 0%, ${colors.emerald600} 50%, ${colors.emerald500} 100%); border-radius: 16px 16px 0 0; box-shadow: 0 4px 24px rgba(5, 150, 105, 0.20);">
                <tr>
                  <td style="padding: 36px 40px 32px 40px; text-align: center;">
                    <!-- Leaf icon (SVG-safe inline) -->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                      <tr>
                        <td style="background-color: rgba(255,255,255,0.18); border-radius: 50%; width: 48px; height: 48px; text-align: center; vertical-align: middle; font-size: 24px; line-height: 48px;">
                          &#127811;
                        </td>
                      </tr>
                    </table>
                    <h1 style="margin: 14px 0 0 0; font-size: 28px; font-weight: 800; color: ${colors.white}; letter-spacing: 1px; line-height: 1.2;">CARBON LENS</h1>
                    <p style="margin: 6px 0 0 0; font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.75); letter-spacing: 2px; text-transform: uppercase;">Emission Management Platform</p>
                    <!-- Decorative line -->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top: 18px;">
                      <tr>
                        <td style="width: 60px; height: 2px; background-color: rgba(255,255,255,0.35);"></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Accent stripe -->
          <tr>
            <td style="height: 4px; background: linear-gradient(90deg, ${accentColor}, ${colors.emerald500}, ${accentColor}); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- =============== BODY =============== -->
          <tr>
            <td style="background-color: ${colors.white}; padding: 40px 44px; border-left: 1px solid ${colors.gray200}; border-right: 1px solid ${colors.gray200};">
              ${content}
            </td>
          </tr>

          <!-- =============== FOOTER =============== -->
          <tr>
            <td style="padding: 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${colors.gray50}; border-radius: 0 0 16px 16px; border: 1px solid ${colors.gray200}; border-top: none;">
                <tr>
                  <td style="padding: 28px 40px; text-align: center;">
                    <!-- Divider -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px;">
                      <tr>
                        <td style="height: 1px; background-color: ${colors.gray200}; font-size: 0; line-height: 0;">&nbsp;</td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 2px 0; font-size: 13px; font-weight: 700; color: ${colors.teal700}; letter-spacing: 0.5px;">Carbon Lens</p>
                    <p style="margin: 0 0 12px 0; font-size: 11px; color: ${colors.gray500}; letter-spacing: 0.3px;">Emission Management Platform</p>
                    <p style="margin: 0 0 12px 0; font-size: 12px; color: ${colors.gray400};">
                      <a href="mailto:info@carbonlens.com" style="color: ${colors.teal700}; text-decoration: none; font-weight: 500;">info@carbonlens.com</a>
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px;">
                      <tr>
                        <td style="height: 1px; background-color: ${colors.gray200}; font-size: 0; line-height: 0;">&nbsp;</td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 4px 0; font-size: 11px; color: ${colors.gray400};">Sent on ${timestamp()}</p>
                    <p style="margin: 0; font-size: 11px; color: ${colors.gray300};">This is an automated notification. Please do not reply to this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

/** Large status badge with icon */
const statusBadge = (
  label: string,
  variant: "approved" | "rejected" | "pending" | "failed"
) => {
  const config = {
    approved: { bg: colors.emerald50, border: colors.emerald600, color: colors.emerald800, icon: "&#10003;", iconBg: colors.emerald100 },
    rejected: { bg: colors.red50, border: colors.red600, color: colors.red700, icon: "&#10007;", iconBg: colors.red100 },
    pending: { bg: colors.amber50, border: colors.amber600, color: colors.amber700, icon: "&#9202;", iconBg: colors.amber100 },
    failed: { bg: colors.red50, border: colors.red600, color: colors.red700, icon: "&#9888;", iconBg: colors.red100 },
  };
  const c = config[variant];
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 28px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background-color: ${c.bg}; border: 2px solid ${c.border}; border-radius: 12px; min-width: 220px;">
            <tr>
              <td style="padding: 6px 10px 6px 14px; vertical-align: middle;">
                <span style="display: inline-block; width: 32px; height: 32px; line-height: 32px; text-align: center; background-color: ${c.iconBg}; border-radius: 50%; font-size: 16px;">${c.icon}</span>
              </td>
              <td style="padding: 12px 20px 12px 8px; vertical-align: middle;">
                <span style="font-size: 18px; font-weight: 700; color: ${c.color}; letter-spacing: 0.5px;">${label}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
};

/** Big counter badge for bulk operations */
const counterBadge = (count: number, label: string, variant: "approved" | "rejected") => {
  const isApproved = variant === "approved";
  const bg = isApproved ? colors.emerald50 : colors.red50;
  const border = isApproved ? colors.emerald600 : colors.red600;
  const numColor = isApproved ? colors.emerald800 : colors.red700;
  const labelColor = isApproved ? colors.emerald700 : colors.red600;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 28px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background-color: ${bg}; border: 2px solid ${border}; border-radius: 14px; min-width: 200px;">
            <tr>
              <td style="padding: 20px 32px; text-align: center;">
                <span style="display: block; font-size: 40px; font-weight: 800; color: ${numColor}; line-height: 1;">${count}</span>
                <span style="display: block; margin-top: 4px; font-size: 13px; font-weight: 600; color: ${labelColor}; text-transform: uppercase; letter-spacing: 1.5px;">${label}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
};

/** Detail card - a clean info card with label/value pairs */
const detailCard = (rows: { label: string; value: string }[]) => {
  const rowHtml = rows
    .filter((r) => r.value)
    .map(
      (r, i, arr) => `
      <tr>
        <td style="padding: 14px 18px; width: 38%; vertical-align: top; ${i < arr.length - 1 ? `border-bottom: 1px solid ${colors.gray100};` : ""} color: ${colors.gray500}; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px;">
          ${r.label}
        </td>
        <td style="padding: 14px 18px; ${i < arr.length - 1 ? `border-bottom: 1px solid ${colors.gray100};` : ""} color: ${colors.gray900}; font-size: 14px; font-weight: 600;">
          ${r.value}
        </td>
      </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${colors.gray50}; border: 1px solid ${colors.gray200}; border-radius: 10px; margin-bottom: 24px; overflow: hidden;">
      ${rowHtml}
    </table>`;
};

/** Section heading */
const sectionHeading = (text: string) => `
  <p style="margin: 0 0 14px 0; font-size: 11px; font-weight: 700; color: ${colors.gray500}; text-transform: uppercase; letter-spacing: 2px;">${text}</p>
`;

/** Action trail - elegant timeline showing submitted by -> reviewed by */
const actionTrail = (
  action: "Approved" | "Rejected",
  opts: {
    submitterName?: string;
    submitterEmail?: string;
    managerName?: string;
    managerEmail?: string;
    managerRole?: string;
  }
) => {
  const hasSubmitter = opts.submitterName || opts.submitterEmail;
  const hasManager = opts.managerName || opts.managerEmail;
  if (!hasSubmitter && !hasManager) return "";

  const isApproved = action === "Approved";
  const actionColor = isApproved ? colors.emerald600 : colors.red600;
  const actionBg = isApproved ? colors.emerald50 : colors.red50;
  const actionTextColor = isApproved ? colors.emerald800 : colors.red700;

  let html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
      <tr>
        <td>
          ${sectionHeading("Action Trail")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${colors.gray200}; border-radius: 10px; overflow: hidden;">`;

  if (hasSubmitter) {
    html += `
            <tr>
              <td style="padding: 16px 18px; background-color: ${colors.gray50}; border-bottom: 1px solid ${colors.gray200};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="width: 36px; vertical-align: top;">
                      <div style="width: 32px; height: 32px; line-height: 32px; text-align: center; background-color: ${colors.emerald100}; border-radius: 50%; font-size: 14px; color: ${colors.emerald700};">&#9650;</div>
                    </td>
                    <td style="padding-left: 12px; vertical-align: top;">
                      <p style="margin: 0 0 2px 0; font-size: 10px; font-weight: 700; color: ${colors.gray500}; text-transform: uppercase; letter-spacing: 1.5px;">Submitted By</p>
                      <p style="margin: 0; font-size: 14px; color: ${colors.gray900}; font-weight: 600; line-height: 1.5;">
                        ${opts.submitterName || "N/A"}${opts.submitterEmail ? `<span style="font-weight: 400; color: ${colors.gray500};"> &middot; ${opts.submitterEmail}</span>` : ""}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
  }

  if (hasManager) {
    html += `
            <tr>
              <td style="padding: 16px 18px; background-color: ${actionBg};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="width: 36px; vertical-align: top;">
                      <div style="width: 32px; height: 32px; line-height: 32px; text-align: center; background-color: ${isApproved ? colors.emerald100 : colors.red100}; border-radius: 50%; font-size: 14px; color: ${actionColor};">${isApproved ? "&#10003;" : "&#10007;"}</div>
                    </td>
                    <td style="padding-left: 12px; vertical-align: top;">
                      <p style="margin: 0 0 2px 0; font-size: 10px; font-weight: 700; color: ${actionTextColor}; text-transform: uppercase; letter-spacing: 1.5px;">${action} By</p>
                      <p style="margin: 0; font-size: 14px; color: ${colors.gray900}; font-weight: 600; line-height: 1.5;">
                        ${opts.managerName || "N/A"}${opts.managerRole ? `<span style="font-weight: 400; color: ${colors.gray500};"> &middot; ${opts.managerRole}</span>` : ""}
                      </p>
                      ${opts.managerEmail ? `<p style="margin: 2px 0 0 0; font-size: 12px; color: ${colors.gray500};">${opts.managerEmail}</p>` : ""}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
  }

  html += `
          </table>
        </td>
      </tr>
    </table>`;

  return html;
};

/** Rejection reason callout */
const rejectionCallout = (comment: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
    <tr>
      <td style="background-color: ${colors.red50}; border-left: 4px solid ${colors.red600}; border-radius: 0 10px 10px 0; padding: 20px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="width: 28px; vertical-align: top; padding-top: 2px;">
              <span style="font-size: 16px;">&#128172;</span>
            </td>
            <td style="padding-left: 10px;">
              <p style="margin: 0 0 6px 0; font-size: 10px; font-weight: 700; color: ${colors.red700}; text-transform: uppercase; letter-spacing: 1.5px;">Reviewer Comment</p>
              <p style="margin: 0; font-size: 14px; color: ${colors.red700}; line-height: 1.7; font-style: italic;">&ldquo;${comment}&rdquo;</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

/** Greeting */
const greeting = (name: string) =>
  `<p style="margin: 0 0 24px 0; font-size: 16px; color: ${colors.gray800}; line-height: 1.5;">Dear <strong style="color: ${colors.gray900};">${name}</strong>,</p>`;

/** Body text paragraph */
const bodyText = (text: string) =>
  `<p style="margin: 0 0 24px 0; font-size: 14px; color: ${colors.gray700}; line-height: 1.75;">${text}</p>`;

/** Sign off */
const signOff = () => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 32px;">
    <tr>
      <td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 16px;">
          <tr>
            <td style="height: 1px; background-color: ${colors.gray100}; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
        </table>
        <p style="margin: 0; font-size: 14px; color: ${colors.gray700}; line-height: 1.6;">
          Warm regards,<br/>
          <strong style="color: ${colors.teal700};">The Carbon Lens Team</strong>
        </p>
      </td>
    </tr>
  </table>`;

/** Summary table for bulk operations (categories or products) */
const summaryTable = (
  items: EmailJobCategorySummary[],
  columnLabel: string,
  countLabel: string,
  variant: "approved" | "rejected"
) => {
  const isApproved = variant === "approved";
  const headerBg = isApproved ? colors.emerald800 : colors.red700;
  const headerColor = colors.white;
  const stripeBg = isApproved ? colors.emerald50 : colors.red50;

  const rows = items
    .map(
      (item, i) => `
      <tr>
        <td style="padding: 12px 18px; ${i < items.length - 1 ? `border-bottom: 1px solid ${colors.gray200};` : ""} font-size: 14px; color: ${colors.gray800}; font-weight: 500; background-color: ${i % 2 === 0 ? colors.white : stripeBg};">
          ${item.categoryName}
        </td>
        <td style="padding: 12px 18px; ${i < items.length - 1 ? `border-bottom: 1px solid ${colors.gray200};` : ""} font-size: 14px; color: ${colors.gray800}; text-align: center; font-weight: 700; background-color: ${i % 2 === 0 ? colors.white : stripeBg};">
          ${item.count}
        </td>
      </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${colors.gray200}; border-radius: 10px; overflow: hidden; margin-bottom: 24px;">
      <thead>
        <tr>
          <th style="padding: 12px 18px; text-align: left; font-size: 11px; font-weight: 700; color: ${headerColor}; background-color: ${headerBg}; text-transform: uppercase; letter-spacing: 1.5px;">${columnLabel}</th>
          <th style="padding: 12px 18px; text-align: center; font-size: 11px; font-weight: 700; color: ${headerColor}; background-color: ${headerBg}; text-transform: uppercase; letter-spacing: 1.5px;">${countLabel}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
};

/** "View Details" CTA button linking back to the frontend */
const viewDetailsButton = (deepLink?: string) => {
  if (!deepLink) return "";
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  const url = `${frontendUrl}${deepLink}`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
      <tr>
        <td align="center">
          <a href="${url}" target="_blank" style="display: inline-block; padding: 12px 32px; background-color: ${colors.blue600}; color: ${colors.white}; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px;">
            View Details &rarr;
          </a>
        </td>
      </tr>
    </table>`;
};

// ============================================================================
// EMISSION TEMPLATES
// ============================================================================

export const successTemplate = (
  name: string,
  categoryName?: string,
  siteName?: string,
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string; deepLink?: string }
) => ({
  subject: "Emission Data Approved - Carbon Lens",
  html: baseLayout(
    `${greeting(name)}
    ${bodyText("Your emission data submission has been reviewed and <strong>approved</strong>. The data is now part of your organization's official emission records.")}
    ${statusBadge("Approved", "approved")}
    ${categoryName || siteName
      ? detailCard([
          ...(categoryName ? [{ label: "Category", value: categoryName }] : []),
          ...(siteName ? [{ label: "Site", value: siteName }] : []),
          { label: "Status", value: `<span style="color: ${colors.emerald700}; font-weight: 700;">Approved</span>` },
        ])
      : ""
    }
    ${actionInfo ? actionTrail("Approved", actionInfo) : ""}
    ${viewDetailsButton(actionInfo?.deepLink)}
    ${signOff()}`,
    colors.emerald600
  ),
});

export const rejectTemplate = (
  name: string,
  categoryName?: string,
  siteName?: string,
  comment?: string,
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string; deepLink?: string }
) => ({
  subject: "Emission Data Rejected - Carbon Lens",
  html: baseLayout(
    `${greeting(name)}
    ${bodyText("Your emission data submission has been reviewed and requires revisions. Please review the details below and resubmit with the necessary corrections.")}
    ${statusBadge("Rejected", "rejected")}
    ${categoryName || siteName
      ? detailCard([
          ...(categoryName ? [{ label: "Category", value: categoryName }] : []),
          ...(siteName ? [{ label: "Site", value: siteName }] : []),
          { label: "Status", value: `<span style="color: ${colors.red700}; font-weight: 700;">Rejected</span>` },
        ])
      : ""
    }
    ${comment ? rejectionCallout(comment) : ""}
    ${actionInfo ? actionTrail("Rejected", actionInfo) : ""}
    ${viewDetailsButton(actionInfo?.deepLink)}
    ${signOff()}`,
    colors.red600
  ),
});

// ============================================================================
// BULK EMISSION TEMPLATES
// ============================================================================

export const bulkApprovedTemplate = (
  name: string,
  totalCount: number,
  categories: EmailJobCategorySummary[],
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string }
) => ({
  subject: `${totalCount} Emission Record${totalCount > 1 ? "s" : ""} Approved - Carbon Lens`,
  html: baseLayout(
    `${greeting(name)}
    ${bodyText(`We are pleased to confirm that <strong>${totalCount}</strong> emission data record${totalCount > 1 ? "s have" : " has"} been <strong>approved</strong> following review.`)}
    ${counterBadge(totalCount, `Record${totalCount > 1 ? "s" : ""} Approved`, "approved")}
    ${sectionHeading("Category Breakdown")}
    ${summaryTable(categories, "Category", "Records", "approved")}
    ${actionInfo ? actionTrail("Approved", actionInfo) : ""}
    ${bodyText("Log in to the platform to view the complete details and updated reports.")}
    ${signOff()}`,
    colors.emerald600
  ),
});

export const bulkRejectedTemplate = (
  name: string,
  totalCount: number,
  categories: EmailJobCategorySummary[],
  comment?: string,
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string }
) => ({
  subject: `${totalCount} Emission Record${totalCount > 1 ? "s" : ""} Rejected - Carbon Lens`,
  html: baseLayout(
    `${greeting(name)}
    ${bodyText(`We would like to inform you that <strong>${totalCount}</strong> emission data record${totalCount > 1 ? "s have" : " has"} been <strong>rejected</strong> and require${totalCount > 1 ? "" : "s"} revision.`)}
    ${counterBadge(totalCount, `Record${totalCount > 1 ? "s" : ""} Rejected`, "rejected")}
    ${sectionHeading("Category Breakdown")}
    ${summaryTable(categories, "Category", "Records", "rejected")}
    ${comment ? rejectionCallout(comment) : ""}
    ${actionInfo ? actionTrail("Rejected", actionInfo) : ""}
    ${bodyText("Please review the feedback, make the necessary corrections, and resubmit your data through the platform.")}
    ${signOff()}`,
    colors.red600
  ),
});

// ============================================================================
// PRODUCTION DATA TEMPLATES
// ============================================================================

export const productionApprovedTemplate = (
  name: string,
  productName?: string,
  siteName?: string,
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string }
) => ({
  subject: "Production Data Approved - Carbon Lens",
  html: baseLayout(
    `${greeting(name)}
    ${bodyText("Your production data submission has been reviewed and <strong>approved</strong>. The data is now part of your organization's official production records.")}
    ${statusBadge("Approved", "approved")}
    ${productName || siteName
      ? detailCard([
          ...(productName ? [{ label: "Product", value: productName }] : []),
          ...(siteName ? [{ label: "Site", value: siteName }] : []),
          { label: "Status", value: `<span style="color: ${colors.emerald700}; font-weight: 700;">Approved</span>` },
        ])
      : ""
    }
    ${actionInfo ? actionTrail("Approved", actionInfo) : ""}
    ${bodyText("Log in to the platform to view the complete details and updated reports.")}
    ${signOff()}`,
    colors.emerald600
  ),
});

export const productionRejectedTemplate = (
  name: string,
  productName?: string,
  siteName?: string,
  comment?: string,
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string }
) => ({
  subject: "Production Data Rejected - Carbon Lens",
  html: baseLayout(
    `${greeting(name)}
    ${bodyText("Your production data submission has been reviewed and requires revisions. Please review the details below and resubmit with the necessary corrections.")}
    ${statusBadge("Rejected", "rejected")}
    ${productName || siteName
      ? detailCard([
          ...(productName ? [{ label: "Product", value: productName }] : []),
          ...(siteName ? [{ label: "Site", value: siteName }] : []),
          { label: "Status", value: `<span style="color: ${colors.red700}; font-weight: 700;">Rejected</span>` },
        ])
      : ""
    }
    ${comment ? rejectionCallout(comment) : ""}
    ${actionInfo ? actionTrail("Rejected", actionInfo) : ""}
    ${bodyText("Please review the feedback, make the necessary corrections, and resubmit your data through the platform.")}
    ${signOff()}`,
    colors.red600
  ),
});

// ============================================================================
// BULK PRODUCTION DATA TEMPLATES
// ============================================================================

export const bulkProductionApprovedTemplate = (
  name: string,
  totalCount: number,
  products: EmailJobCategorySummary[],
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string }
) => ({
  subject: `${totalCount} Production Record${totalCount > 1 ? "s" : ""} Approved - Carbon Lens`,
  html: baseLayout(
    `${greeting(name)}
    ${bodyText(`We are pleased to confirm that <strong>${totalCount}</strong> production data record${totalCount > 1 ? "s have" : " has"} been <strong>approved</strong> following review.`)}
    ${counterBadge(totalCount, `Record${totalCount > 1 ? "s" : ""} Approved`, "approved")}
    ${sectionHeading("Product Breakdown")}
    ${summaryTable(products, "Product", "Records", "approved")}
    ${actionInfo ? actionTrail("Approved", actionInfo) : ""}
    ${bodyText("Log in to the platform to view the complete details and updated reports.")}
    ${signOff()}`,
    colors.emerald600
  ),
});

export const bulkProductionRejectedTemplate = (
  name: string,
  totalCount: number,
  products: EmailJobCategorySummary[],
  comment?: string,
  actionInfo?: { submitterName?: string; submitterEmail?: string; managerName?: string; managerEmail?: string; managerRole?: string }
) => ({
  subject: `${totalCount} Production Record${totalCount > 1 ? "s" : ""} Rejected - Carbon Lens`,
  html: baseLayout(
    `${greeting(name)}
    ${bodyText(`We would like to inform you that <strong>${totalCount}</strong> production data record${totalCount > 1 ? "s have" : " has"} been <strong>rejected</strong> and require${totalCount > 1 ? "" : "s"} revision.`)}
    ${counterBadge(totalCount, `Record${totalCount > 1 ? "s" : ""} Rejected`, "rejected")}
    ${sectionHeading("Product Breakdown")}
    ${summaryTable(products, "Product", "Records", "rejected")}
    ${comment ? rejectionCallout(comment) : ""}
    ${actionInfo ? actionTrail("Rejected", actionInfo) : ""}
    ${bodyText("Please review the feedback, make the necessary corrections, and resubmit your data through the platform.")}
    ${signOff()}`,
    colors.red600
  ),
});

// ============================================================================
// DEADLINE & ESCALATION TEMPLATES
// ============================================================================

export const deadlineReminderTemplate = (
  name: string,
  month: string,
  year: number,
  siteName?: string
) => ({
  subject: `Action Required: Data Submission for ${month} ${year} - Carbon Lens`,
  html: baseLayout(
    `${greeting(name)}
    ${bodyText("This is a reminder that your monthly emission data submission is due. Please submit your data at your earliest convenience to ensure compliance.")}
    ${statusBadge("Pending Submission", "pending")}

    <!-- Deadline callout -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
      <tr>
        <td style="background-color: ${colors.amber50}; border: 1px solid ${colors.amber100}; border-left: 4px solid ${colors.amber600}; border-radius: 0 10px 10px 0; padding: 20px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="width: 28px; vertical-align: top; padding-top: 2px;">
                <span style="font-size: 16px;">&#9888;</span>
              </td>
              <td style="padding-left: 10px;">
                <p style="margin: 0 0 6px 0; font-size: 10px; font-weight: 700; color: ${colors.amber700}; text-transform: uppercase; letter-spacing: 1.5px;">Deadline Reminder</p>
                <p style="margin: 0; font-size: 14px; color: ${colors.amber700}; line-height: 1.7;">
                  Monthly data entry deadline is the <strong>10th of every month</strong>. If data is not submitted by the
                  <strong>15th</strong>, the matter will be escalated to your manager.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${detailCard([
      { label: "Reporting Period", value: `<strong>${month} ${year}</strong>` },
      ...(siteName ? [{ label: "Site", value: siteName }] : []),
      { label: "Status", value: `<span style="color: ${colors.amber700}; font-weight: 700;">Pending Submission</span>` },
    ])}
    ${bodyText("Please log in to the platform and submit your data at the earliest to avoid escalation.")}
    ${signOff()}`,
    colors.amber600
  ),
});

export const escalationTemplate = (
  managerName: string,
  month: string,
  year: number,
  pendingUsers: { name: string; email: string; role: string; siteName: string }[]
) => {
  const userRows = pendingUsers
    .map(
      (user, i) => `
      <tr>
        <td style="padding: 12px 14px; ${i < pendingUsers.length - 1 ? `border-bottom: 1px solid ${colors.gray200};` : ""} font-size: 13px; color: ${colors.gray800}; font-weight: 600; background-color: ${i % 2 === 0 ? colors.white : colors.red50};">
          ${user.name}
        </td>
        <td style="padding: 12px 14px; ${i < pendingUsers.length - 1 ? `border-bottom: 1px solid ${colors.gray200};` : ""} font-size: 13px; color: ${colors.gray700}; background-color: ${i % 2 === 0 ? colors.white : colors.red50};">
          ${user.email}
        </td>
        <td style="padding: 12px 14px; ${i < pendingUsers.length - 1 ? `border-bottom: 1px solid ${colors.gray200};` : ""} font-size: 13px; color: ${colors.gray700}; background-color: ${i % 2 === 0 ? colors.white : colors.red50};">
          ${user.role}
        </td>
        <td style="padding: 12px 14px; ${i < pendingUsers.length - 1 ? `border-bottom: 1px solid ${colors.gray200};` : ""} font-size: 13px; color: ${colors.gray700}; background-color: ${i % 2 === 0 ? colors.white : colors.red50};">
          ${user.siteName}
        </td>
      </tr>`
    )
    .join("");

  return {
    subject: `Escalation: Pending Data Submissions for ${month} ${year} - Carbon Lens`,
    html: baseLayout(
      `${greeting(managerName)}
      ${bodyText(`This is an escalation notice regarding overdue emission data submissions for <strong>${month} ${year}</strong>. The following team member${pendingUsers.length > 1 ? "s have" : " has"} not submitted data past the 15th deadline.`)}

      <!-- Escalation badge -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 28px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background-color: ${colors.red50}; border: 2px solid ${colors.red600}; border-radius: 14px;">
              <tr>
                <td style="padding: 18px 32px; text-align: center;">
                  <span style="display: block; font-size: 36px; font-weight: 800; color: ${colors.red700}; line-height: 1;">${pendingUsers.length}</span>
                  <span style="display: block; margin-top: 4px; font-size: 12px; font-weight: 700; color: ${colors.red600}; text-transform: uppercase; letter-spacing: 1.5px;">Pending User${pendingUsers.length > 1 ? "s" : ""}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${sectionHeading(`Overdue Submissions — ${month} ${year}`)}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid ${colors.gray200}; border-radius: 10px; overflow: hidden; margin-bottom: 24px;">
        <thead>
          <tr>
            <th style="padding: 12px 14px; text-align: left; font-size: 11px; font-weight: 700; color: ${colors.white}; background-color: ${colors.red700}; text-transform: uppercase; letter-spacing: 1.5px;">Name</th>
            <th style="padding: 12px 14px; text-align: left; font-size: 11px; font-weight: 700; color: ${colors.white}; background-color: ${colors.red700}; text-transform: uppercase; letter-spacing: 1.5px;">Email</th>
            <th style="padding: 12px 14px; text-align: left; font-size: 11px; font-weight: 700; color: ${colors.white}; background-color: ${colors.red700}; text-transform: uppercase; letter-spacing: 1.5px;">Role</th>
            <th style="padding: 12px 14px; text-align: left; font-size: 11px; font-weight: 700; color: ${colors.white}; background-color: ${colors.red700}; text-transform: uppercase; letter-spacing: 1.5px;">Site</th>
          </tr>
        </thead>
        <tbody>${userRows}</tbody>
      </table>

      ${bodyText(`Please follow up with the above team member${pendingUsers.length > 1 ? "s" : ""} to ensure timely data submission. Your prompt attention is appreciated.`)}
      ${signOff()}`,
      colors.red600
    ),
  };
};

// ============================================================================
// ADMIN FAILURE TEMPLATE
// ============================================================================

export const failureTemplate = (email: string) => ({
  subject: "Email Delivery Failure Alert - Carbon Lens",
  html: baseLayout(
    `${greeting("Admin")}
    ${bodyText("The system encountered a persistent email delivery failure after multiple retry attempts. Immediate investigation is recommended.")}
    ${statusBadge("Delivery Failed", "failed")}

    ${detailCard([
      { label: "Recipient", value: email },
      { label: "Status", value: `<span style="color: ${colors.red700}; font-weight: 700;">Failed</span>` },
    ])}

    <!-- Troubleshooting -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
      <tr>
        <td style="background-color: ${colors.gray50}; border: 1px solid ${colors.gray200}; border-radius: 10px; padding: 20px 22px;">
          <p style="margin: 0 0 12px 0; font-size: 10px; font-weight: 700; color: ${colors.gray500}; text-transform: uppercase; letter-spacing: 1.5px;">Possible Causes</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding: 4px 0; font-size: 13px; color: ${colors.gray700}; line-height: 1.6;">
                <span style="color: ${colors.gray400}; margin-right: 8px;">&#8226;</span> Invalid or inactive recipient email address
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 13px; color: ${colors.gray700}; line-height: 1.6;">
                <span style="color: ${colors.gray400}; margin-right: 8px;">&#8226;</span> Mailgun service disruption or rate limit
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; font-size: 13px; color: ${colors.gray700}; line-height: 1.6;">
                <span style="color: ${colors.gray400}; margin-right: 8px;">&#8226;</span> Temporary network or DNS resolution failure
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${bodyText("You may review the failed message from the Dead Letter Queue (DLQ) for further diagnostic details.")}
    ${signOff()}`,
    colors.red600
  ),
});
