import { getChannel } from "../config/rabbitmq";

export const startDLQConsumer = async () => {
    const channel = getChannel();

 channel.consume("dlq_queue", async (msg) => {
    if (!msg) return;

    const data = JSON.parse(msg.content.toString());

    const MAX_DLQ_RETRIES = 3;
    const dlqRetryCount = data.dlqRetryCount || 0;

    if (dlqRetryCount >= MAX_DLQ_RETRIES) {
        console.log("🚫 DLQ retry limit reached for:", data.email);
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