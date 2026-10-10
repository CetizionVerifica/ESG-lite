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

export const verifyToken = (token: string) => {
  return jwt.verify(token, getJwtSecret());
};
