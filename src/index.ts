import express from "express";
import { AppDataSource } from "./config/data-source";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import userRoutes from "./routes/user.routes";
import cors from "cors";
import dotenv from "dotenv";
import allDataEntryRoutes from "./routes/allDataEntry.routes";

dotenv.config();

const app = express();
app.use(express.json());
app.use(
    cors({
        origin: process.env.CORS_ORIGIN,
        credentials: true,
    }),
);

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/user", userRoutes);
app.use("/all-data-entry", allDataEntryRoutes);

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
    .then(() => {
        server = app.listen(3000, () => {
            console.log("🚀 Server running on http://localhost:3000");
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
