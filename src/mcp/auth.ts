import { createHash } from "crypto";
import { AppDataSource } from "../config/data-source";
import { UserRole } from "../types/type";

/**
 * Who is calling /mcp, as the token verifier (IM5) describes them.
 * `scopes` is the subset of MCP_SCOPES the grant carries.
 */
export interface McpPrincipal {
  user_id: number;
  role: string;
  scopes: string[];
  grant_id: string;
}

/**
 * IM5's `verifyMcpToken(token) → principal | null`. Returns null for an
 * unknown, expired or revoked token, an app JWT, or a user who is no longer
 * Superadmin. IM5 registers it with setMcpTokenVerifier at startup; until
 * then only test tokens (below) can reach /mcp.
 */
export type McpTokenVerifier = (token: string) => Promise<McpPrincipal | null>;

export const MCP_SCOPES = ["imports:read", "imports:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

let verifier: McpTokenVerifier | null = null;

/** Called once by the OAuth module (IM5) when it loads. */
export const setMcpTokenVerifier = (fn: McpTokenVerifier | null): void => {
  verifier = fn;
};

/**
 * Test tokens for CI and local development, never in production:
 *   mcp-test.<user_id>.<scope,scope>[.<label>]
 * On only when MCP_TEST_TOKENS=true and NODE_ENV is not "production". The
 * grant id is a hash of the whole token, so two labels are two grants (the
 * rate limit is per grant).
 */
const TEST_TOKEN = /^mcp-test\.(\d{1,9})\.([a-z:,]*)(?:\.([A-Za-z0-9_-]{1,40}))?$/;

export const testTokensEnabled = (): boolean =>
  process.env.MCP_TEST_TOKENS === "true" && process.env.NODE_ENV !== "production";

const verifyTestToken = (token: string): McpPrincipal | null => {
  const m = TEST_TOKEN.exec(token);
  if (!m) return null;
  const scopes = m[2].split(",").filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s));
  return {
    user_id: Number(m[1]),
    role: "", // filled from the database by resolveRole
    scopes,
    grant_id: "test-" + createHash("sha256").update(token).digest("hex").slice(0, 24),
  };
};

/** The user's role as the database has it right now (defence in depth over IM5's cache). */
export const readUserRole = async (userId: number): Promise<string | null> => {
  const rows: { role: string }[] = await AppDataSource.query(`SELECT role FROM "user" WHERE user_id = $1`, [userId]);
  return rows[0]?.role ?? null;
};

export type VerifyOutcome =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; reason: "invalid_token" }
  | { ok: false; reason: "not_superadmin" };

/**
 * Verifies a bearer token and re-reads the account's role. Only a Superadmin
 * gets through (decision D4), whatever the token claims.
 */
export const verifyMcpBearer = async (token: string): Promise<VerifyOutcome> => {
  let principal: McpPrincipal | null = null;
  if (verifier) principal = await verifier(token);
  if (!principal && testTokensEnabled()) principal = verifyTestToken(token);
  if (!principal) return { ok: false, reason: "invalid_token" };

  const role = await readUserRole(principal.user_id);
  if (role === null) return { ok: false, reason: "invalid_token" };
  if (role !== UserRole.SUPERADMIN) return { ok: false, reason: "not_superadmin" };
  return { ok: true, principal: { ...principal, role } };
};
