import { EmailJobCategorySummary } from "../types/email";

export const successTemplate = (
  name: string,
  categoryName?: string,
  siteName?: string
) => ({
  subject: "Emission Submission Approved",
  html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
      <p>Dear ${name},</p>

      <p>
        We are pleased to inform you that your emission submission has been approved following review.
      </p>

      <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
        <tbody>
          ${
            categoryName
              ? `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5; width: 35%;"><strong>Category</strong></td>
              <td style="padding: 8px; border: 1px solid #ddd;">${categoryName}</td>
            </tr>
          `
              : ""
          }
          ${
            siteName
              ? `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Site</strong></td>
              <td style="padding: 8px; border: 1px solid #ddd;">${siteName}</td>
            </tr>
          `
              : ""
          }
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Status</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">Approved</td>
          </tr>
        </tbody>
      </table>

      <p style="margin-top: 16px;">
        Please log in to the system for further details.
      </p>

      <p>Regards,<br/>ESG Team</p>
    </div>
  `,
});

export const rejectTemplate = (
  name: string,
  categoryName?: string,
  siteName?: string,
  comment?: string
) => ({
  subject: "Emission Submission Rejected",
  html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
      <p>Dear ${name},</p>

      <p>
        We would like to inform you that your emission submission has been rejected following review.
      </p>

      <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
        <tbody>
          ${
            categoryName
              ? `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5; width: 35%;"><strong>Category</strong></td>
              <td style="padding: 8px; border: 1px solid #ddd;">${categoryName}</td>
            </tr>
          `
              : ""
          }
          ${
            siteName
              ? `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Site</strong></td>
              <td style="padding: 8px; border: 1px solid #ddd;">${siteName}</td>
            </tr>
          `
              : ""
          }
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;"><strong>Status</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">Rejected</td>
          </tr>
        </tbody>
      </table>

      ${
        comment
          ? `
        <p style="margin-top: 16px;"><strong>Reviewer Comment:</strong></p>
        <div style="padding: 10px; border: 1px solid #ddd; background: #fafafa; border-radius: 4px;">
          ${comment}
        </div>
      `
          : ""
      }

      <p style="margin-top: 16px;">
        Please review the submission details in the system and resubmit after necessary corrections.
      </p>

      <p>Regards,<br/>ESG Team</p>
    </div>
  `,
});

export const bulkApprovedTemplate = (
  name: string,
  totalCount: number,
  categories: EmailJobCategorySummary[]
) => {
  const categoryRows = categories
    .map(
      (item) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${item.categoryName}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.count}</td>
        </tr>
      `
    )
    .join("");

  return {
    subject: "Emission Submissions Approved",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <p>Dear ${name},</p>

        <p>
          We are pleased to inform you that <strong>${totalCount}</strong>
          of your emission submission${totalCount > 1 ? "s have" : " has"} been approved following review.
        </p>

        <p>Please find the category-wise summary below:</p>

        <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
          <thead>
            <tr>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left; background: #f5f5f5;">Category</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: center; background: #f5f5f5;">Approved Rows</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRows}
          </tbody>
        </table>

        <p style="margin-top: 16px;">
          Please log in to the system for further details.
        </p>

        <p>Regards,<br/>ESG Team</p>
      </div>
    `,
  };
};

export const bulkRejectedTemplate = (
  name: string,
  totalCount: number,
  categories: EmailJobCategorySummary[],
  comment?: string
) => {
  const categoryRows = categories
    .map(
      (item) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${item.categoryName}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${item.count}</td>
        </tr>
      `
    )
    .join("");

  return {
    subject: "Emission Submissions Rejected",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <p>Dear ${name},</p>

        <p>
          We would like to inform you that <strong>${totalCount}</strong>
          of your emission submission${totalCount > 1 ? "s have" : " has"} been rejected following review.
        </p>

        <p>Please find the category-wise summary below:</p>

        <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
          <thead>
            <tr>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left; background: #f5f5f5;">Category</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: center; background: #f5f5f5;">Rejected Rows</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRows}
          </tbody>
        </table>

        ${
          comment
            ? `
          <p style="margin-top: 16px;"><strong>Reviewer Comment:</strong></p>
          <div style="padding: 10px; border: 1px solid #ddd; background: #fafafa; border-radius: 4px;">
            ${comment}
          </div>
        `
            : ""
        }

        <p style="margin-top: 16px;">
          Please review the submission details in the system and resubmit after necessary corrections.
        </p>

        <p>Regards,<br/>ESG Team</p>
      </div>
    `,
  };
};

export const failureTemplate = (email: string) => ({
  subject: "Email Delivery Failure Alert",

  html: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
      
      <p>Dear Admin,</p>

      <p>
        This is to inform you that the system was unable to deliver an email notification 
        after multiple retry attempts.
      </p>

      <table style="border-collapse: collapse; width: 100%; margin-top: 10px;">
        <tbody>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5; width: 35%;">
              <strong>Recipient Email</strong>
            </td>
            <td style="padding: 8px; border: 1px solid #ddd;">
              ${email}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd; background: #f5f5f5;">
              <strong>Status</strong>
            </td>
            <td style="padding: 8px; border: 1px solid #ddd; color: #b00020;">
              Failed after maximum retry attempts
            </td>
          </tr>
        </tbody>
      </table>

      <p style="margin-top: 16px;">
        Please investigate the issue. Possible causes may include:
      </p>

      <ul>
        <li>Invalid or inactive recipient email address</li>
        <li>Mailgun service issues</li>
        <li>Temporary network or delivery failures</li>
      </ul>

      <p>
        You may review the failed message from the Dead Letter Queue (DLQ) for further details.
      </p>

      <p>Regards,<br/>System Notification</p>

    </div>
  `,
});