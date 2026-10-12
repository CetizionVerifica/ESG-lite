import crypto from "crypto";
import jwt from "jsonwebtoken";

// Read the secret on use (not at import time, which runs before dotenv in
// index.ts) and never fall back to a built-in value: a known default would let
// anyone sign their own tokens. index.ts calls assertJwtSecret() at startup.
export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
};

export const assertJwtSecret = () => {
  getJwtSecret();
};

export const signToken = (payload: object) => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "1d" });
};

/**
 * Verifies an app session token. Only tokens signToken() produced pass: a
 * payload with a numeric userId and a role, and no audience. Other JWTs the
 * server signs for one purpose (the OAuth consent request, see
 * oauth/consentRequest.ts) use a key derived with purposeKey() and carry an
 * audience, so neither can stand in for a session.
 */
export const verifyToken = (token: string) => {
  const payload = jwt.verify(token, getJwtSecret());
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.aud !== undefined ||
    typeof (payload as any).userId !== "number" ||
    typeof (payload as any).role !== "string"
  ) {
    throw new Error("Not a session token");
  }
  return payload;
};

/**
 * A separate signing key for a single-purpose token, derived from JWT_SECRET
 * so no extra setting is needed: HMAC-SHA256(JWT_SECRET, purpose). A token
 * signed with it never verifies under the session key and vice versa.
 */
export const purposeKey = (purpose: string): Buffer =>
  crypto.createHmac("sha256", getJwtSecret()).update(purpose).digest();
