import { getChannel } from "../config/rabbitmq";
import { sendEmailForApprove } from "../services/emailService";
import {
    successTemplate,
    rejectTemplate,
    failureTemplate,
} from "../templates/emailTemplates";

     const retryQueues = ["retry_5s", "retry_30s", "retry_60s"];
const MAX_RETRIES = 3;

export const startEmailConsumer = async () => {
    const channel = getChannel();
channel.prefetch(1);
    channel.consume("email_queue", async (msg) => {
        if (!msg) return;
        
        const data = JSON.parse(msg.content.toString());

        try {
           
            let template;

            if (data.type === "APPROVED") {
                template = successTemplate(data.name);
            } else if (data.type === "REJECTED") {
                template = rejectTemplate(data.name);
            } else {
                throw new Error("Invalid type");
            }

            await sendEmailForApprove({
                to: data.email,
                subject: template.subject,
                html: template.html,
            });

            console.log("✅ Email sent via Mailgun");

            channel.ack(msg);

        } catch (error: any) {
            console.error("❌ Mailgun error:", error?.message || error);

      

if (data.retryCount < MAX_RETRIES) {
    const retryData = {
        ...data,
        retryCount: data.retryCount + 1,
    };

    const retryQueue = retryQueues[retryData.retryCount - 1];

    console.log(
        `🔁 Retry ${retryData.retryCount} → ${retryQueue}`
    );

    channel.sendToQueue(
        retryQueue,
        Buffer.from(JSON.stringify(retryData)),
        { persistent: true }
    );

    channel.ack(msg);
} else {
                console.log("🚨 Max retries reached → DLQ");

                channel.sendToQueue(
                    "dlq_queue",
                    Buffer.from(JSON.stringify(data)),
                    { persistent: true }
                );

                // Send alert to admin
                const fail = failureTemplate(data.email);

                try {
                    await sendEmailForApprove({
                        to: process.env.ADMIN_EMAIL!,
                        subject: fail.subject,
                        html: fail.html,
                    });
                } catch (err) {
                    console.error("❌ Failed to notify admin");
                }

                channel.ack(msg);
            }
        }
    });

    console.log("📩 Mailgun consumer running...");
};