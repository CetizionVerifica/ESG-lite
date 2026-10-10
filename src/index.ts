import path from "path";
import express from "express";
import { AppDataSource } from "./config/data-source";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
import managerRoutes from "./routes/manager.routes";
import notificationRoutes from "./routes/notification.routes";
import reportRoutes from "./routes/report.routes";
import brandRoutes from "./routes/brand.routes";
import companyAdminRoutes from "./routes/companyAdmin.routes";
import pcfRoutes from "./routes/pcf.routes";
import cors from "cors";
import dotenv from "dotenv";
import { connectRabbitMQ } from "./config/rabbitmq";
import { startEmailConsumer } from "./workers/emailConsumer";
import { startDLQConsumer } from "./config/dlqConsumer";
import { startDeadlineScheduler } from "./workers/deadlineScheduler";
import { requestLogger } from "./middlewares/requestLogger";
import { startHeartbeat } from "./services/sseManager";
import { assertJwtSecret } from "./utils/jwt";
dotenv.config();

// Refuse to start without a signing secret (there is no built-in fallback).
try {
    assertJwtSecret();
} catch {
    console.error("❌ JWT_SECRET is not set. Set it in the environment or .env before starting the server.");
    process.exit(1);
}

const app = express();
// Behind a load balancer or reverse proxy, set TRUST_PROXY (e.g. "1" for one
// hop) so req.ip is the client's address; the sign-in rate limit keys on it.
if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isInteger(hops) ? hops : process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);
}
app.use(express.json({ limit: "10mb" }));
app.use(
    cors({
        origin: process.env.CORS_ORIGIN,
        credentials: true,
    }),
);
// Serve locally-stored documents when LOCAL_FILE_STORAGE is on (dev only).
// Matches the URLs returned by src/config/localStorage.ts.
if (process.env.LOCAL_FILE_STORAGE === "true") {
    app.use(
        "/local-uploads",
        express.static(path.resolve(process.cwd(), "local-uploads")),
    );
}

app.use(requestLogger);

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/user", userRoutes);
app.use("/manager", managerRoutes);
app.use("/notifications", notificationRoutes);
app.use("/reports", reportRoutes);
app.use("/brands", brandRoutes);
app.use("/company-admin", companyAdminRoutes);
app.use("/pcf", pcfRoutes);

let server: any;

// Retry DB connection with exponential backoff
const connectWithRetry = async (
    maxRetries = 5,
    baseDelay = 2000,
): Promise<void> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await AppDataSource.initialize();
            console.log("📦 Database connected");
            return;
        } catch (err: any) {
            const isTransient =
                err.code === "ECONNRESET" ||
                err.code === "ETIMEDOUT" ||
                err.code === "ECONNREFUSED" ||
                err.code === "EPIPE";

            if (isTransient && attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1); // 2s, 4s, 8s, 16s, 32s
                console.warn(
                    `⚠️  DB connection attempt ${attempt}/${maxRetries} failed (${err.code}). Retrying in ${delay / 1000}s...`,
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                console.error(
                    `❌ DB connection failed after ${attempt} attempt(s):`,
                    err,
                );
                process.exit(1);
            }
        }
    }
};

connectWithRetry()
    .then(async () => {
        // Start server immediately — don't block on RabbitMQ
        startHeartbeat();
        const port = Number(process.env.PORT) || 3000;
        server = app.listen(port, () => {
            console.log(`🚀 Server running on http://localhost:${port}`);
        });

        // Connect RabbitMQ in background (non-blocking)
        connectRabbitMQ()
            .then(async () => {
                await startEmailConsumer();
                await startDLQConsumer();
                startDeadlineScheduler();
            })
            .catch((err) => {
                console.warn("⚠️ RabbitMQ not available — email notifications disabled.", err?.message || "");
            });

        // Set server timeouts
        server.keepAliveTimeout = 65000; // Slightly higher than ALB idle timeout
        server.headersTimeout = 66000; // Must be higher than keepAliveTimeout
    })
    .catch(() => {
        process.exit(1);
    });

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    if (server) {
        server.close(async () => {
            console.log("HTTP server closed");

            if (AppDataSource.isInitialized) {
                await AppDataSource.destroy();
                console.log("Database connection closed");
            }

            process.exit(0);
        });
    }

    // Force close after 10 seconds
    setTimeout(() => {
        console.error("Forced shutdown after timeout");
        process.exit(1);
    }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions — only shut down for fatal errors, not transient ones
process.on("uncaughtException", (err: any) => {
    console.error("Uncaught exception:", err);
    // Transient connection errors: log and continue
    if (
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT" ||
        err.code === "EPIPE"
    ) {
        console.warn(`Transient error (${err.code}) — not shutting down`);
        return;
    }
    // Fatal errors: shut down
    gracefulShutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled rejection at:", promise, "reason:", reason);
});
