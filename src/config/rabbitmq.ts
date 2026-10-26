import amqp, { Channel } from "amqplib";

let channel: Channel;

/** Runs after every (re)connect: starts the consumers on the new channel. */
type ReadyHook = () => Promise<void> | void;
let onReady: ReadyHook | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let attempt = 0;

/** Wait before reconnect attempt n (0-based): 5 s, 10 s, 20 s, 40 s, then every 60 s. */
export const reconnectDelayMs = (n: number) => Math.min(60_000, 5_000 * 2 ** n);

/**
 * The broker URL with a 30 s heartbeat unless it names one: CloudAMQP closes
 * connections it hears nothing from, which used to stop every email until a restart.
 */
export const brokerUrl = (url = process.env.RABBITMQ_URL || "amqp://localhost") =>
    /[?&]heartbeat=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}heartbeat=30`;

const scheduleReconnect = (why: string) => {
    channel = null as any;
    if (reconnectTimer) return; // the connection and its channel both report one drop
    const wait = reconnectDelayMs(attempt++);
    console.warn(`⚠️ RabbitMQ ${why}; reconnecting in ${wait / 1000}s (emails are held until then).`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectRabbitMQ().catch(() => undefined);
    }, wait);
    reconnectTimer.unref?.();
};

/**
 * Connects, sets up the queues and runs the ready hook (the consumers). A
 * dropped or failed connection is retried with backoff, so emails resume on
 * their own instead of stopping until the server restarts.
 */
export const connectRabbitMQ = async (ready?: ReadyHook) => {
    if (ready) onReady = ready;
    try {
        await open();
        attempt = 0;
        await onReady?.();
        flushPending();
    } catch (err: any) {
        scheduleReconnect(`not available (${err?.message || err})`);
        throw err;
    }
};

const open = async () => {
    const connection = await amqp.connect(brokerUrl());

    connection.on("error", (err: Error) => {
        console.error("RabbitMQ connection error:", err.message);
    });
    connection.on("close", () => scheduleReconnect("connection closed"));

    channel = await connection.createChannel();

    channel.on("error", (err: Error) => {
        console.error("RabbitMQ channel error:", err.message);
    });
    channel.on("close", () => scheduleReconnect("channel closed"));

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
    await channel.assertQueue("studio.render", { durable: true }); // DS-11: Design Studio render jobs ({jobId})
    console.log("✅ RabbitMQ connected with retry queues");
};

/** Messages sent while the broker is away, sent once it's back (oldest first, at most 500). */
const MAX_PENDING = 500;
const pending: { queue: string; body: Buffer }[] = [];

/** Sends to a queue now, or holds the message until the broker is back. False when it had to be dropped. */
export const sendOrHold = (queue: string, body: Buffer): boolean => {
    if (channel) {
        channel.sendToQueue(queue, body, { persistent: true });
        return true;
    }
    if (pending.length >= MAX_PENDING) return false;
    pending.push({ queue, body });
    return true;
};

export const pendingCount = () => pending.length;

const flushPending = () => {
    if (!channel || !pending.length) return;
    const n = pending.length;
    for (const m of pending.splice(0)) channel.sendToQueue(m.queue, m.body, { persistent: true });
    console.log(`✅ RabbitMQ back: ${n} held email(s) queued.`);
};

export const getChannel = () => {
    if (!channel) throw new Error("RabbitMQ not available");
    return channel;
};