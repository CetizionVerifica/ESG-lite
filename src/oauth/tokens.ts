import crypto from "crypto";

/**
 * Opaque tokens and codes. Only the sha256 hash is stored; the plain value
 * exists in the response once and is never logged. Prefixes make an MCP token
 * recognisable (so the app's JWT middleware and this module can't confuse
 * each other) without revealing anything.
 */
export const ACCESS_PREFIX = "esgl_at_";
export const REFRESH_PREFIX = "esgl_rt_";
export const CODE_PREFIX = "esgl_ac_";

export const randomToken = (prefix: string, bytes = 32): string =>
  prefix + crypto.randomBytes(bytes).toString("base64url");

export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

/** RFC 7636 S256: base64url(sha256(verifier)) must equal the stored challenge. */
export const pkceMatches = (verifier: string, challenge: string): boolean => {
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) return false;
  const digest = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(digest);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export const isCodeChallenge = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
