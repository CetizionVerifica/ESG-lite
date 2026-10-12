/**
 * Tool-call rate limit: MCP_RATE_LIMIT_MAX calls (default 60) per grant per
 * minute, in memory, same shape as middlewares/rateLimit.middleware.ts.
 * Counted per JSON-RPC `tools/call` message (every one in a batch), not per
 * HTTP request, so initialize and tools/list are free. MCP_RATE_LIMIT_DISABLED=true turns it off.
 */
type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();
let sweeper: NodeJS.Timeout | null = null;

const limit = (): number => {
  const v = Number(process.env.MCP_RATE_LIMIT_MAX);
  return Number.isFinite(v) && v > 0 ? v : 60;
};

const startSweeper = () => {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, WINDOW_MS);
  sweeper.unref?.();
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Takes `calls` tool calls from the grant's bucket (a JSON-RPC batch carries
 * several). All or nothing: if the batch would go over the limit none of it
 * is counted and the request is refused, so a batch cannot slip past MCP-18.
 */
export const takeToolCall = (grantId: string, calls = 1): RateLimitResult => {
  if (process.env.MCP_RATE_LIMIT_DISABLED === "true" || calls <= 0) return { allowed: true };
  startSweeper();
  const now = Date.now();
  let bucket = buckets.get(grantId);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(grantId, bucket);
  }
  if (bucket.count + calls > limit()) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += calls;
  return { allowed: true };
};

/** Test hook: forget every in-memory bucket (no database involved). */
export const resetToolCallBuckets = (): void => {
  for (const key of [...buckets.keys()]) buckets.delete(key);
};
