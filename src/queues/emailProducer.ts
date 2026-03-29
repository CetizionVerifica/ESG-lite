import { getChannel } from "../config/rabbitmq";
import {EmailJob} from "../types/email";

export const sendToQueue = async (data: EmailJob) => {
    try {
        const channel = getChannel();
        channel.sendToQueue(
            "email_queue",
            Buffer.from(JSON.stringify({ ...data, retryCount: 0 })),
            { persistent: true }
        );
        console.log(`[INFO] [Email] Queued: ${data.type} → ${data.email}`);
    } catch (err: any) {
        console.warn(`[WARN] [Email] Skipped (RabbitMQ not available): ${data.type} → ${data.email} — ${err?.message || ""}`);
    }
};
