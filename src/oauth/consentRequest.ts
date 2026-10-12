import jwt from "jsonwebtoken";
import { purposeKey } from "../utils/jwt";
import { CONSENT_REQUEST_TTL_S, Scope } from "./config";

/**
 * The authorize endpoint hands the browser to the FE consent page with a
 * signed, short-lived request id (a JWT over the validated parameters). The
 * consent page reads it back through GET /oauth/authorize/request and posts
 * the decision with it; nothing about a pending request is stored server side.
 */
export interface ConsentRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scopes: Scope[];
  state?: string;
}

const AUDIENCE = "esglite-oauth-consent";
// Its own key (derived from JWT_SECRET), so a consent request can never pass
// as an app session even if a verifier forgot to check the audience.
const key = () => purposeKey(AUDIENCE);

export const signConsentRequest = (request: ConsentRequest): string =>
  jwt.sign(request, key(), { expiresIn: CONSENT_REQUEST_TTL_S, audience: AUDIENCE });

export const readConsentRequest = (token: unknown): (ConsentRequest & { exp: number }) | null => {
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = jwt.verify(token, key(), { audience: AUDIENCE }) as any;
    if (!payload || typeof payload.client_id !== "string" || typeof payload.redirect_uri !== "string") return null;
    return payload;
  } catch {
    return null;
  }
};
