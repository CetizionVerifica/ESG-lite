import amqp, { Channel } from "amqplib";

let channel: Channel;

export const connectRabbitMQ = async () => {
    const connection = await amqp.connect(
        process.env.RABBITMQ_URL || "amqp://localhost"
    );

    channel = await connection.createChannel();

    // ✅ Main queue
    await channel.assertQueue("email_queue", {
        durable: true,
    });

    // ✅ Retry queues (different delays)

    await channel.assertQueue("retry_5s", {
        durable: true,
        messageTtl: 5000,
        deadLetterExchange: "",
        deadLetterRoutingKey: "email_queue",
    });

    await channel.assertQueue("retry_30s", {
        durable: true,
        messageTtl: 30000,
        deadLetterExchange: "",
        deadLetterRoutingKey: "email_queue",
    });

    await channel.assertQueue("retry_60s", {
        durable: true,
        messageTtl: 60000,
        deadLetterExchange: "",
        deadLetterRoutingKey: "email_queue",
    });

    // ✅ DLQ
    await channel.assertQueue("dlq_queue", {
        durable: true,
    });
await channel.assertQueue("dlq_retry_60s", {
    durable: true,
    messageTtl: 60000, // 1 min delay
    deadLetterExchange: "",
    deadLetterRoutingKey: "email_queue",
});
    console.log("✅ RabbitMQ connected with retry queues");
};

export const getChannel = () => {
    if (!channel) throw new Error("RabbitMQ not initialized");
    return channel;
};