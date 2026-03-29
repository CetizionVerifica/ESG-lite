import amqp, { Channel } from "amqplib";

let channel: Channel;

export const connectRabbitMQ = async () => {
    const connection = await amqp.connect(
        process.env.RABBITMQ_URL || "amqp://localhost"
    );

    // Handle connection drops gracefully (CloudAMQP closes idle connections)
    connection.on("error", (err) => {
        console.error("RabbitMQ connection error:", err.message);
    });
    connection.on("close", () => {
        console.warn("⚠️ RabbitMQ connection closed. Email notifications disabled until restart.");
        channel = null as any;
    });

    channel = await connection.createChannel();

    channel.on("error", (err) => {
        console.error("RabbitMQ channel error:", err.message);
    });
    channel.on("close", () => {
        console.warn("⚠️ RabbitMQ channel closed.");
        channel = null as any;
    });

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
    if (!channel) throw new Error("RabbitMQ not available");
    return channel;
};