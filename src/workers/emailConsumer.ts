
import { getChannel } from "../config/rabbitmq";
import { sendEmailForApprove } from "../services/emailService";
import {
  successTemplate,
  rejectTemplate,
  bulkApprovedTemplate,
  bulkRejectedTemplate,
  productionApprovedTemplate,
  productionRejectedTemplate,
  bulkProductionApprovedTemplate,
  bulkProductionRejectedTemplate,
  deadlineReminderTemplate,
  escalationTemplate,
  failureTemplate,
} from "../templates/emailTemplates";

const retryQueues = ["retry_5s", "retry_30s", "retry_60s"];
const MAX_RETRIES = 3;

/** Detect if error is a rate limit (429 Too Many Requests) */
const isRateLimitError = (error: any): boolean => {
  const msg = (error?.message || error?.toString() || "").toLowerCase();
  return msg.includes("too many requests") || msg.includes("429") || msg.includes("rate limit");
};

/** Small delay to avoid hammering Mailgun */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Extract action info (manager/submitter) from email job data
const getActionInfo = (data: any) => ({
  submitterName: data.submitterName,
  submitterEmail: data.submitterEmail,
  managerName: data.managerName,
  managerEmail: data.managerEmail,
  managerRole: data.managerRole,
});

export const startEmailConsumer = async () => {
  const channel = getChannel();

  // Process 1 at a time to avoid Mailgun rate limits
  channel.prefetch(1);

  channel.consume("email_queue", async (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    try {
      let template;
      const actionInfo = getActionInfo(data);

      // Emission templates
      if (data.type === "APPROVED") {
        template = successTemplate(data.name, data.categoryName, data.siteName, actionInfo);
      } else if (data.type === "REJECTED") {
        template = rejectTemplate(data.name, data.categoryName, data.siteName, data.comment, actionInfo);
      } else if (data.type === "BULK_APPROVED") {
        template = bulkApprovedTemplate(data.name, data.totalCount || 0, data.categories || [], actionInfo);
      } else if (data.type === "BULK_REJECTED") {
        template = bulkRejectedTemplate(data.name, data.totalCount || 0, data.categories || [], data.comment || "", actionInfo);
      }
      // Production data templates
      else if (data.type === "PRODUCTION_APPROVED") {
        template = productionApprovedTemplate(data.name, data.productName, data.siteName, actionInfo);
      } else if (data.type === "PRODUCTION_REJECTED") {
        template = productionRejectedTemplate(data.name, data.productName, data.siteName, data.comment, actionInfo);
      } else if (data.type === "BULK_PRODUCTION_APPROVED") {
        template = bulkProductionApprovedTemplate(data.name, data.totalCount || 0, data.products || [], actionInfo);
      } else if (data.type === "BULK_PRODUCTION_REJECTED") {
        template = bulkProductionRejectedTemplate(data.name, data.totalCount || 0, data.products || [], data.comment || "", actionInfo);
      }
      // Deadline templates
      else if (data.type === "DEADLINE_REMINDER") {
        template = deadlineReminderTemplate(data.name, data.month, data.year, data.siteName);
      } else if (data.type === "DEADLINE_ESCALATION") {
        template = escalationTemplate(data.name, data.month, data.year, data.pendingUsers || []);
      } else {
        throw new Error(`Invalid email type: ${data.type}`);
      }

      await sendEmailForApprove({
        to: data.email,
        subject: template.subject,
        html: template.html,
      });

      console.log(`Email sent via Mailgun to ${data.email} (${data.type})`);
      channel.ack(msg);

      // Throttle: wait 1s between emails to stay under Mailgun rate limits
      await sleep(1000);
    } catch (error: any) {
      const errMsg = error?.message || error;
      console.error("Mailgun error:", errMsg);

      if ((data.retryCount || 0) < MAX_RETRIES) {
        const retryData = {
          ...data,
          retryCount: (data.retryCount || 0) + 1,
        };

        // Rate limit (429) → skip to longest retry queue (60s) to let the limit reset
        let retryQueue: string;
        if (isRateLimitError(error)) {
          retryQueue = "retry_60s";
          console.log(`Rate limited! Retry ${retryData.retryCount} -> ${retryQueue} (backing off)`);
        } else {
          retryQueue = retryQueues[retryData.retryCount - 1];
          console.log(`Retry ${retryData.retryCount} -> ${retryQueue}`);
        }

        channel.sendToQueue(
          retryQueue,
          Buffer.from(JSON.stringify(retryData)),
          { persistent: true }
        );

        channel.ack(msg);
      } else {
        console.log("Max retries reached -> DLQ");

        channel.sendToQueue(
          "dlq_queue",
          Buffer.from(JSON.stringify(data)),
          { persistent: true }
        );

        const fail = failureTemplate(data.email);

        try {
          await sendEmailForApprove({
            to: process.env.ADMIN_EMAIL || "info@carbonlens.com",
            subject: fail.subject,
            html: fail.html,
          });
        } catch (err) {
          console.error("Failed to notify admin");
        }

        channel.ack(msg);
      }
    }
  });

  console.log("Email consumer running...");
};
