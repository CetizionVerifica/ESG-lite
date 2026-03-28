// import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { getMg, MAILGUN_DOMAIN } from "../config/mailer";

dotenv.config();

// Whitelist: only these emails receive emails in non-production environments
// Uncomment to enable email whitelist for local testing
// const EMAIL_WHITELIST = [
//     "yashsukantnayak@gmail.com",
//     "nayakyash10@gmail.com",
// ];
//
// const isEmailAllowed = (email: string): boolean => {
//     if (process.env.NODE_ENV === "production") return true;
//     return EMAIL_WHITELIST.includes(email.toLowerCase());
// };

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}


export const sendEmail = async (options: EmailOptions): Promise<void> => {
    try {
        await sendEmailForApprove({
            to: options.to,
            subject: options.subject,
            html: options.html,
        });
    } catch (error) {
        console.error("Error sending email:", error);
        throw new Error("Failed to send email");
    }
};


export const sendPasswordResetEmail = async (
    email: string,
    resetToken: string,
    userName?: string,
): Promise<void> => {
    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background-color: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
        .button { display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .button:hover { background-color: #1d4ed8; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
        .warning { background-color: #fef3c7; border: 1px solid #f59e0b; padding: 10px; border-radius: 4px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Password Reset Request</h1>
        </div>
        <div class="content">
          <p>Hello${userName ? ` ${userName}` : ""},</p>
          <p>We received a request to reset your password for your Emission Tracker account.</p>
          <p>Click the button below to reset your password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button" style="color: white;">Reset Password</a>
          </p>
          <p>Or copy and paste this link into your browser:</p>
          <p style="word-break: break-all; background-color: #e5e7eb; padding: 10px; border-radius: 4px;">
            ${resetUrl}
          </p>
          <div class="warning">
            <strong>Important:</strong> This link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
          </div>
        </div>
        <div class="footer">
          <p>This email was sent by Emission Tracker</p>
          <p>Please do not reply to this email</p>
        </div>
      </div>
    </body>
    </html>
  `;

    await sendEmail({
        to: email,
        subject: "Password Reset Request - Emission Tracker",
        html,
    });
};



interface EmailPayload {
    to: string;
    subject: string;
    html: string;
}

export const sendEmailForApprove = async ({ to, subject, html }: EmailPayload) => {
    // Uncomment to enable email whitelist for local testing
    // if (!isEmailAllowed(to)) {
    //     console.log(`Email blocked (not whitelisted): ${to}`);
    //     return;
    // }

    const client = getMg();
    if (!client) {
        console.warn(`Email skipped (Mailgun not configured): ${to} — ${subject}`);
        return;
    }
    return client.messages.create(MAILGUN_DOMAIN, {
        from: `Carbon Lens <mail@mail.carbon-lens.com>`,
        to: [to],
        subject,
        html,
    });
};