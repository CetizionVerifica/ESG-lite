import { getChannel } from "../config/rabbitmq";
import { alertDeliveryFailed } from "../workers/emailConsumer";

export const startDLQConsumer = async () => {
    const channel = getChannel();

 channel.consume("dlq_queue", async (msg: any) => {
    if (!msg) return;

    let data: any;
    try {
        data = JSON.parse(msg.content.toString());
    } catch {
        console.error("[Email] Dropped a dead-letter message that isn't JSON");
        channel.ack(msg);
        return;
    }

    const MAX_DLQ_RETRIES = 3;
    const dlqRetryCount = data.dlqRetryCount || 0;

    if (dlqRetryCount >= MAX_DLQ_RETRIES) {
        console.log("🚫 DLQ retry limit reached for:", data.email);
        await alertDeliveryFailed(data.email, "every retry failed");
        channel.ack(msg);
        return;
    }

    const retryData = {
        ...data,
        retryCount: 0,
        dlqRetryCount: dlqRetryCount + 1,
    };

    console.log(
        `⏳ Sending to dlq_retry_60s (attempt ${retryData.dlqRetryCount}) for:`,
        data.email
    );

    // ✅ Use RabbitMQ delay queue instead of setTimeout
    channel.sendToQueue(
        "dlq_retry_60s",
        Buffer.from(JSON.stringify(retryData)),
        { persistent: true }
    );

    channel.ack(msg);
});

    console.log("♻️ DLQ reprocessor running...");
};