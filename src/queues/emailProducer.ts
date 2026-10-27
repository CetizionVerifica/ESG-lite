import { sendOrHold } from "../config/rabbitmq";
import {EmailJob} from "../types/email";

/** Queues an email; while the broker is reconnecting it is held and sent once it's back. */
export const sendToQueue = async (data: EmailJob) => {
    const ok = sendOrHold("email_queue", Buffer.from(JSON.stringify({ ...data, retryCount: 0 })));
    if (ok) console.log(`[INFO] [Email] Queued: ${data.type} → ${data.email}`);
    else console.warn(`[WARN] [Email] Skipped (RabbitMQ away and the hold is full): ${data.type} → ${data.email}`);
};
