import { IsNull } from "typeorm";
import { AppDataSource } from "../config/data-source";
import { OauthClient } from "../entities/OauthClient";
import { OauthGrant } from "../entities/OauthGrant";
import { OauthCode } from "../entities/OauthCode";
import { OauthToken } from "../entities/OauthToken";
import { ACCESS_TOKEN_TTL_MS, CODE_TTL_MS, REFRESH_TOKEN_TTL_MS, Scope } from "./config";
import { ACCESS_PREFIX, CODE_PREFIX, REFRESH_PREFIX, hashToken, pkceMatches, randomToken } from "./tokens";
import { log } from "../utils/logger";

/**
 * Database side of the OAuth server: clients, grants, codes and tokens.
 * Plain values of codes and tokens leave this module exactly once, in the
 * return value of the function that minted them; only hashes are stored and
 * nothing here logs them.
 */

const clients = () => AppDataSource.getRepository(OauthClient);
const grants = () => AppDataSource.getRepository(OauthGrant);
const codes = () => AppDataSource.getRepository(OauthCode);
const tokens = () => AppDataSource.getRepository(OauthToken);

export const joinScopes = (scopes: readonly Scope[]): string => scopes.join(" ");
export const splitScopes = (scopes: string): Scope[] => scopes.split(" ").filter(Boolean) as Scope[];

// ---- clients ---------------------------------------------------------------

export interface RegisterClientInput {
  client_name: string;
  redirect_uris: string[];
  client_uri?: string | null;
  logo_uri?: string | null;
}

export const registerClient = async (input: RegisterClientInput): Promise<OauthClient> => {
  const client = clients().create({
    client_id: randomToken("", 16),
    client_name: input.client_name,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    client_uri: input.client_uri ?? null,
    logo_uri: input.logo_uri ?? null,
  });
  return clients().save(client);
};

export const findClient = (client_id: string): Promise<OauthClient | null> =>
  typeof client_id === "string" && client_id ? clients().findOne({ where: { client_id } }) : Promise.resolve(null);

// ---- grants ----------------------------------------------------------------

/** The user's live grant for this client, or a new one. Scopes are the union. */
export const upsertGrant = async (user_id: number, client_id: string, scopes: Scope[]): Promise<OauthGrant> => {
  const existing = await grants().findOne({ where: { user_id, client_id, revoked_at: IsNull() } });
  if (existing) {
    const merged = Array.from(new Set([...splitScopes(existing.scopes), ...scopes]));
    if (merged.length !== splitScopes(existing.scopes).length) {
      existing.scopes = joinScopes(merged as Scope[]);
      await grants().save(existing);
    }
    return existing;
  }
  return grants().save(grants().create({ user_id, client_id, scopes: joinScopes(scopes) }));
};

export const listGrants = (user_id: number, includeRevoked = false) =>
  grants().find({
    where: includeRevoked ? { user_id } : { user_id, revoked_at: IsNull() },
    relations: ["client"],
    order: { created_at: "DESC" },
  });

/** Sets revoked_at on the grant and every token under it. Returns false when it isn't the user's. */
export const revokeGrant = async (grant_id: number, user_id?: number): Promise<boolean> => {
  const grant = await grants().findOne({ where: user_id === undefined ? { grant_id } : { grant_id, user_id } });
  if (!grant) return false;
  const now = new Date();
  if (!grant.revoked_at) {
    grant.revoked_at = now;
    await grants().save(grant);
  }
  await tokens().update({ grant_id, revoked_at: IsNull() }, { revoked_at: now });
  log.info("OAuth", "Grant revoked", { grantId: grant_id });
  return true;
};

export const touchGrant = (grant_id: number): Promise<unknown> =>
  grants().update({ grant_id }, { last_used_at: new Date() });

// ---- codes -----------------------------------------------------------------

export interface IssueCodeInput {
  grant_id: number;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scopes: Scope[];
}

export const issueCode = async (input: IssueCodeInput): Promise<string> => {
  const code = randomToken(CODE_PREFIX);
  await codes().save(
    codes().create({
      code_hash: hashToken(code),
      grant_id: input.grant_id,
      client_id: input.client_id,
      redirect_uri: input.redirect_uri,
      code_challenge: input.code_challenge,
      resource: input.resource,
      scopes: joinScopes(input.scopes),
      expires_at: new Date(Date.now() + CODE_TTL_MS),
    }),
  );
  return code;
};

export type CodeExchangeFailure =
  | "unknown_code"
  | "code_used"
  | "code_expired"
  | "client_mismatch"
  | "redirect_mismatch"
  | "resource_mismatch"
  | "pkce_failed"
  | "grant_revoked";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  grant_id: number;
}

/**
 * Exchanges a code once. A reused code revokes nothing by itself (the first
 * exchange already minted tokens for the legitimate client) but is refused.
 */
export const exchangeCode = async (input: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
  resource?: string;
}): Promise<{ ok: true; tokens: TokenPair } | { ok: false; reason: CodeExchangeFailure }> => {
  if (typeof input.code !== "string" || !input.code.startsWith(CODE_PREFIX)) return { ok: false, reason: "unknown_code" };
  return AppDataSource.transaction(async (tx) => {
    const repo = tx.getRepository(OauthCode);
    const row = await repo.findOne({ where: { code_hash: hashToken(input.code) }, lock: { mode: "pessimistic_write" } });
    if (!row) return { ok: false as const, reason: "unknown_code" as const };
    if (row.used_at) return { ok: false as const, reason: "code_used" as const };
    row.used_at = new Date();
    await repo.save(row);
    if (row.expires_at.getTime() < Date.now()) return { ok: false as const, reason: "code_expired" as const };
    if (row.client_id !== input.client_id) return { ok: false as const, reason: "client_mismatch" as const };
    if (row.redirect_uri !== input.redirect_uri) return { ok: false as const, reason: "redirect_mismatch" as const };
    if (input.resource !== undefined && input.resource !== row.resource) return { ok: false as const, reason: "resource_mismatch" as const };
    if (!pkceMatches(input.code_verifier, row.code_challenge)) return { ok: false as const, reason: "pkce_failed" as const };
    const grant = await tx.getRepository(OauthGrant).findOne({ where: { grant_id: row.grant_id } });
    if (!grant || grant.revoked_at) return { ok: false as const, reason: "grant_revoked" as const };
    const pair = await mintTokens(tx.getRepository(OauthToken), grant.grant_id, splitScopes(row.scopes), row.resource);
    return { ok: true as const, tokens: pair };
  });
};

// ---- tokens ----------------------------------------------------------------

const mintTokens = async (
  repo: ReturnType<typeof tokens>,
  grant_id: number,
  scopes: Scope[],
  resource: string,
): Promise<TokenPair> => {
  const access_token = randomToken(ACCESS_PREFIX);
  const refresh_token = randomToken(REFRESH_PREFIX);
  const now = Date.now();
  await repo.save([
    repo.create({ token_hash: hashToken(access_token), kind: "access", grant_id, scopes: joinScopes(scopes), resource, expires_at: new Date(now + ACCESS_TOKEN_TTL_MS) }),
    repo.create({ token_hash: hashToken(refresh_token), kind: "refresh", grant_id, scopes: joinScopes(scopes), resource, expires_at: new Date(now + REFRESH_TOKEN_TTL_MS) }),
  ]);
  return { access_token, refresh_token, expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000), scope: joinScopes(scopes), grant_id };
};

export type RefreshFailure = "unknown_token" | "token_expired" | "token_revoked" | "token_reused" | "grant_revoked" | "scope_exceeded" | "resource_mismatch";

/**
 * Refresh rotation. The presented refresh token is marked replaced; a second
 * presentation of the same token means it leaked (or the client lost the new
 * one), so the whole grant is revoked.
 */
export const refreshTokens = async (input: {
  refresh_token: string;
  scope?: string | null;
  resource?: string;
}): Promise<{ ok: true; tokens: TokenPair } | { ok: false; reason: RefreshFailure }> => {
  if (typeof input.refresh_token !== "string" || !input.refresh_token.startsWith(REFRESH_PREFIX)) return { ok: false, reason: "unknown_token" };
  const hash = hashToken(input.refresh_token);
  return AppDataSource.transaction(async (tx) => {
    const repo = tx.getRepository(OauthToken);
    const row = await repo.findOne({ where: { token_hash: hash, kind: "refresh" }, lock: { mode: "pessimistic_write" } });
    if (!row) return { ok: false as const, reason: "unknown_token" as const };
    if (row.replaced_at) {
      // Reuse of a rotated refresh token: revoke the grant (outside this tx's lock scope is fine).
      await tx.getRepository(OauthGrant).update({ grant_id: row.grant_id }, { revoked_at: new Date() });
      await repo.update({ grant_id: row.grant_id, revoked_at: IsNull() }, { revoked_at: new Date() });
      log.warn("OAuth", "Refresh token reuse detected; grant revoked", { grantId: row.grant_id });
      return { ok: false as const, reason: "token_reused" as const };
    }
    if (row.revoked_at) return { ok: false as const, reason: "token_revoked" as const };
    if (row.expires_at.getTime() < Date.now()) return { ok: false as const, reason: "token_expired" as const };
    if (input.resource !== undefined && input.resource !== row.resource) return { ok: false as const, reason: "resource_mismatch" as const };
    const grant = await tx.getRepository(OauthGrant).findOne({ where: { grant_id: row.grant_id } });
    if (!grant || grant.revoked_at) return { ok: false as const, reason: "grant_revoked" as const };
    let scopes = splitScopes(row.scopes);
    if (input.scope) {
      const wanted = input.scope.trim().split(/\s+/) as Scope[];
      if (wanted.some((s) => !scopes.includes(s))) return { ok: false as const, reason: "scope_exceeded" as const };
      scopes = wanted;
    }
    row.replaced_at = new Date();
    await repo.save(row);
    // Access tokens minted from the previous refresh keep running until they expire (1 h).
    const pair = await mintTokens(repo, grant.grant_id, scopes, row.resource);
    return { ok: true as const, tokens: pair };
  });
};

/** RFC 7009: an access token is revoked alone; a refresh token revokes its grant. */
export const revokeToken = async (token: string): Promise<void> => {
  if (typeof token !== "string" || !token) return;
  const row = await tokens().findOne({ where: { token_hash: hashToken(token) } });
  if (!row) return;
  if (row.kind === "refresh") {
    await revokeGrant(row.grant_id);
    return;
  }
  if (!row.revoked_at) await tokens().update({ token_id: row.token_id }, { revoked_at: new Date() });
};

export interface AccessTokenRow {
  token_id: number;
  grant_id: number;
  user_id: number;
  client_id: string;
  scopes: string;
  resource: string;
  expires_at: Date;
  token_revoked_at: Date | null;
  grant_revoked_at: Date | null;
}

export const findAccessToken = async (token: string): Promise<AccessTokenRow | null> => {
  if (typeof token !== "string" || !token.startsWith(ACCESS_PREFIX)) return null;
  const rows: AccessTokenRow[] = await AppDataSource.query(
    `SELECT t.token_id, t.grant_id, g.user_id, g.client_id, t.scopes, t.resource, t.expires_at,
            t.revoked_at AS token_revoked_at, g.revoked_at AS grant_revoked_at
       FROM oauth_token t JOIN oauth_grant g ON g.grant_id = t.grant_id
      WHERE t.token_hash = $1 AND t.kind = 'access'`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
};
