import { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger";

/**
 * Small in-memory rate limit for the sign-in and password-reset endpoints
 * (audit finding F-20): at most AUTH_RATE_LIMIT_MAX attempts (default 10) per
 * client IP and route in AUTH_RATE_LIMIT_WINDOW_MS (default 15 min), then 429.
 *
 * - "failures" counts only attempts that end in an error, so a team behind one
 *   office IP is not blocked by normal sign-ins; requests still in flight
 *   count too, so a burst of parallel attempts can't slip past the limit;
 *   "all" counts every request (forgot-password always answers 200).
 * - Counts live in this process only; with several instances each has its own.
 * - Behind a load balancer set TRUST_PROXY so req.ip is the client, not the
 *   balancer (otherwise every client shares one bucket).
 * - AUTH_RATE_LIMIT_DISABLED=true turns it off (e.g. for load tests).
 */
type Bucket = { count: number; inFlight: number; resetAt: number };

const envNumber = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const buckets = new Map<string, Bucket>();
let sweeper: NodeJS.Timeout | null = null;

const startSweeper = (windowMs: number) => {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, windowMs);
  sweeper.unref?.();
};

export const authRateLimit = (name: string, count: "all" | "failures" = "failures") =>
  (req: Request, res: Response, next: NextFunction) => {
    if (process.env.AUTH_RATE_LIMIT_DISABLED === "true") return next();

    const max = envNumber("AUTH_RATE_LIMIT_MAX", 10);
    const windowMs = envNumber("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
    startSweeper(windowMs);

    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, inFlight: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count + bucket.inFlight >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      log.warn("Auth", "Rate limit hit", { route: name, ip: req.ip });
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        message: `Too many attempts. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
    }

    if (count === "all") {
      bucket.count++;
    } else {
      const counted = bucket;
      counted.inFlight++;
      res.once("close", () => {
        counted.inFlight--;
        if (res.statusCode >= 400) counted.count++;
      });
    }
    next();
  };
