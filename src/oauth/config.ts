import { Request } from "express";

/**
 * OAuth server settings (IM5). Everything is derived from the environment,
 * with request-based fallbacks so a local or CI server works without extra
 * configuration:
 *
 *   API_BASE_URL                 public base URL of this API, e.g. https://api.esglite.example
 *                                (fallback: scheme + host of the incoming request)
 *   FE_BASE_URL                  where the consent page lives (fallback: first CORS_ORIGIN,
 *                                then http://localhost:5173)
 *   OAUTH_ALLOWED_REDIRECT_HOSTS comma-separated allowlist of redirect hosts; "*.claude.ai"
 *                                matches subdomains. Default: claude.ai, claude.com and their
 *                                subdomains, plus localhost / 127.0.0.1 outside production.
 *   OAUTH_RESOURCE_OPTIONAL      "true" lets a client omit the RFC 8707 `resource` parameter
 *                                (it then defaults to the /mcp resource). Off by default.
 */

export const SCOPES = ["imports:read", "imports:write"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "imports:read": "Read your clients' sites, categories, forms and activity names",
  "imports:write": "Create entries for review; it can't approve, edit or delete anything",
};

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 h
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
export const CODE_TTL_MS = 60 * 1000; // 60 s
export const CONSENT_REQUEST_TTL_S = 10 * 60; // the signed request id the consent page carries

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const apiBaseUrl = (req?: Request): string => {
  const env = process.env.API_BASE_URL;
  if (env) return trimSlash(env);
  if (!req) return "http://localhost:3000";
  return `${req.protocol}://${req.get("host")}`;
};

export const feBaseUrl = (): string => {
  const env = process.env.FE_BASE_URL;
  if (env) return trimSlash(env);
  const cors = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean)[0];
  return trimSlash(cors || "http://localhost:5173");
};

/** The protected resource every token is bound to. */
export const mcpResource = (req?: Request): string => `${apiBaseUrl(req)}/mcp`;

export const resourceOptional = (): boolean => process.env.OAUTH_RESOURCE_OPTIONAL === "true";

const DEFAULT_HOSTS = ["claude.ai", "*.claude.ai", "claude.com", "*.claude.com"];
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const allowedRedirectHosts = (): string[] => {
  const env = (process.env.OAUTH_ALLOWED_REDIRECT_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const hosts = env.length ? env : [...DEFAULT_HOSTS];
  if (process.env.NODE_ENV !== "production") hosts.push(...LOCAL_HOSTS);
  return hosts;
};

const hostMatches = (host: string, pattern: string): boolean => {
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern;
};

/**
 * A redirect URI is accepted when it is https (http only for localhost), has
 * no fragment, and its host is on the allowlist.
 */
export const isAllowedRedirectUri = (uri: string): boolean => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const host = url.hostname.toLowerCase();
  const local = LOCAL_HOSTS.includes(host);
  if (url.protocol === "http:" && !local) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return allowedRedirectHosts().some((p) => hostMatches(host, p));
};

export const parseScopes = (raw: string | undefined | null): Scope[] | null => {
  if (!raw || !raw.trim()) return [...SCOPES];
  const parts = raw.trim().split(/\s+/);
  const out: Scope[] = [];
  for (const p of parts) {
    if (!(SCOPES as readonly string[]).includes(p)) return null;
    if (!out.includes(p as Scope)) out.push(p as Scope);
  }
  return out;
};
