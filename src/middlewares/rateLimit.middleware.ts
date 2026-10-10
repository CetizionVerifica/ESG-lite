import { Request, Response, NextFunction } from "express";
import { log } from "../utils/logger";

/**
 * Small in-memory rate limit for the sign-in and password-reset endpoints
 * (audit finding F-20): at most AUTH_RATE_LIMIT_MAX attempts (default 10) per
 * client IP, route and account (the normalised `email` in the body, when the
 * route has one) in AUTH_RATE_LIMIT_WINDOW_MS (default 15 min), then 429.
 * Each IP also has a looser cap across all accounts, AUTH_RATE_LIMIT_IP_MAX
 * (default 5 x the per-account limit), so one office behind a NAT address is
 * not locked out by a single person's typos.
 *
 * - "failures" counts only attempts that end in an error, so normal sign-ins
 *   never use up the limit; on the per-account bucket requests still in
 *   flight count too, so a burst of parallel guesses can't slip past it;
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

const takeBucket = (key: string, now: number, windowMs: number): Bucket => {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, inFlight: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  return bucket;
};

export const authRateLimit = (name: string, count: "all" | "failures" = "failures") =>
  (req: Request, res: Response, next: NextFunction) => {
    if (process.env.AUTH_RATE_LIMIT_DISABLED === "true") return next();

    const max = envNumber("AUTH_RATE_LIMIT_MAX", 10);
    const ipMax = envNumber("AUTH_RATE_LIMIT_IP_MAX", max * 5);
    const windowMs = envNumber("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
    startSweeper(windowMs);

    const now = Date.now();
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const account = takeBucket(`${name}:${req.ip}:${email}`, now, windowMs);
    const ip = takeBucket(`${name}:${req.ip}`, now, windowMs);

    const full = account.count + account.inFlight >= max ? account : ip.count >= ipMax ? ip : null;
    if (full) {
      const retryAfter = Math.max(1, Math.ceil((full.resetAt - now) / 1000));
      log.warn("Auth", "Rate limit hit", { route: name, ip: req.ip, perAccount: full === account });
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        message: `Too many attempts. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
    }

    if (count === "all") {
      account.count++;
      ip.count++;
    } else {
      account.inFlight++;
      res.once("close", () => {
        account.inFlight--;
        if (res.statusCode >= 400) {
          account.count++;
          ip.count++;
        }
      });
    }
    next();
  };
