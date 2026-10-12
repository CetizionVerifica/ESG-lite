import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../config/data-source";
import { UserRole } from "../types/type";
import { Scope } from "./config";
import { apiBaseUrl } from "./config";
import { findAccessToken, splitScopes, touchGrant } from "./service";

/**
 * Token verification for the MCP server (IM6 imports this).
 *
 * A token is good only when: it is an MCP access token (never an app JWT),
 * unexpired, not revoked, its grant not revoked, AND the account behind it is
 * still a Superadmin right now (D4). The role is re-read from the database on
 * every call, cached for MCP_ROLE_CACHE_MS (default 60 s; 0 under
 * NODE_ENV=test so the API tests can demote a user and see the effect).
 */
export interface McpPrincipal {
  user_id: number;
  role: UserRole;
  scopes: Scope[];
  grant_id: number;
  client_id: string;
}

const roleCacheMs = (): number => {
  const env = process.env.MCP_ROLE_CACHE_MS;
  if (env !== undefined && env !== "") return Math.max(0, Number(env) || 0);
  return process.env.NODE_ENV === "test" ? 0 : 60_000;
};

let roleCache = new Map<number, { role: string | null; at: number }>();
export const clearMcpRoleCache = (): void => {
  roleCache = new Map();
};

const currentRole = async (user_id: number): Promise<string | null> => {
  const ttl = roleCacheMs();
  const hit = roleCache.get(user_id);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.role;
  const rows: { role: string }[] = await AppDataSource.query(`SELECT role FROM "user" WHERE user_id = $1`, [user_id]);
  const role = rows[0]?.role ?? null;
  roleCache.set(user_id, { role, at: Date.now() });
  return role;
};

const touched = new Map<number, number>();

export const verifyMcpToken = async (token: string | undefined | null): Promise<McpPrincipal | null> => {
  if (!token) return null;
  const row = await findAccessToken(token);
  if (!row) return null;
  if (row.token_revoked_at || row.grant_revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const role = await currentRole(row.user_id);
  if (role !== UserRole.SUPERADMIN) return null;
  // last_used_at, at most once a minute per grant.
  const last = touched.get(row.grant_id) ?? 0;
  if (Date.now() - last > 60_000) {
    touched.set(row.grant_id, Date.now());
    await touchGrant(row.grant_id).catch(() => undefined);
  }
  return { user_id: row.user_id, role: UserRole.SUPERADMIN, scopes: splitScopes(row.scopes), grant_id: row.grant_id, client_id: row.client_id };
};

export interface McpRequest extends Request {
  mcp?: McpPrincipal;
}

export const bearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
};

/** The WWW-Authenticate challenge the MCP authorization spec expects on 401. */
export const mcpChallenge = (req: Request, error?: "invalid_token" | "insufficient_scope", description?: string): string => {
  const parts = [`resource_metadata="${apiBaseUrl(req)}/.well-known/oauth-protected-resource/mcp"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(", ")}`;
};

/**
 * Express middleware for /mcp (IM6): 401 + WWW-Authenticate without a valid
 * MCP token; sets req.mcp otherwise.
 */
export const requireMcpToken = async (req: McpRequest, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) {
    res.setHeader("WWW-Authenticate", mcpChallenge(req));
    return res.status(401).json({ error: "invalid_token", error_description: "An MCP access token is required." });
  }
  let principal: McpPrincipal | null = null;
  try {
    principal = await verifyMcpToken(token);
  } catch (err) {
    console.error("MCP token verification failed:", err);
    return res.status(500).json({ error: "server_error", error_description: "Could not verify the token." });
  }
  if (!principal) {
    res.setHeader("WWW-Authenticate", mcpChallenge(req, "invalid_token", "The token is invalid, expired, revoked or its account is no longer a Superadmin."));
    return res.status(401).json({ error: "invalid_token", error_description: "The token is invalid, expired, revoked or its account is no longer a Superadmin." });
  }
  req.mcp = principal;
  next();
};
