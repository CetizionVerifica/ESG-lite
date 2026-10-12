import express, { Router, Request, Response } from "express";
import cors from "cors";
import { AppDataSource } from "../config/data-source";
import { AuthRequest, authenticate } from "../middlewares/auth.middleware";
import { authRateLimit } from "../middlewares/rateLimit.middleware";
import { UserRole } from "../types/type";
import { log } from "../utils/logger";
import {
  SCOPES,
  SCOPE_DESCRIPTIONS,
  Scope,
  feBaseUrl,
  isAllowedRedirectUri,
  mcpResource,
  parseScopes,
  resourceOptional,
} from "./config";
import { readConsentRequest, signConsentRequest } from "./consentRequest";
import { MCP_SUPERADMIN_ONLY, MCP_SUPERADMIN_ONLY_MESSAGE, oauthError } from "./errors";
import {
  exchangeCode,
  findClient,
  issueCode,
  listGrants,
  refreshTokens,
  registerClient,
  revokeGrant,
  revokeToken,
  splitScopes,
  upsertGrant,
} from "./service";
import { isCodeChallenge } from "./tokens";
import { McpRequest, requireMcpToken } from "./verify";

/**
 * OAuth 2.1 authorization server for the MCP connector (IM5). Mounted at
 * /oauth. Endpoints a Claude client calls directly (register, token, revoke)
 * allow any origin; the consent endpoints run under the app session and the
 * app's CORS policy. See src/oauth/CLAUDE.md.
 */
const router = Router();
const open = cors({ origin: true });
const formOrJson = [express.urlencoded({ extended: false }), express.json()];

const noStore = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

// ---- dynamic client registration (RFC 7591) ---------------------------------

router.options("/register", open);
router.post("/register", open, authRateLimit("oauth-register", "all"), async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const uris: unknown = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || uris.some((u) => typeof u !== "string")) {
    return oauthError(res, "invalid_redirect_uri", "redirect_uris must be a non-empty array of URLs.");
  }
  const bad = (uris as string[]).find((u) => !isAllowedRedirectUri(u));
  if (bad) return oauthError(res, "invalid_redirect_uri", "A redirect URI is not https, or its host is not allowed for this server.");
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") {
    return oauthError(res, "invalid_client_metadata", "Only public clients (token_endpoint_auth_method \"none\") are supported.");
  }
  if (Array.isArray(body.grant_types) && body.grant_types.some((g: unknown) => g !== "authorization_code" && g !== "refresh_token")) {
    return oauthError(res, "invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
  }
  if (Array.isArray(body.response_types) && body.response_types.some((t: unknown) => t !== "code")) {
    return oauthError(res, "invalid_client_metadata", "Only the code response type is supported.");
  }
  const name = str(body.client_name)?.trim().slice(0, 200) || "Unnamed client";
  const client = await registerClient({
    client_name: name,
    redirect_uris: uris as string[],
    client_uri: str(body.client_uri)?.slice(0, 500) ?? null,
    logo_uri: str(body.logo_uri)?.slice(0, 500) ?? null,
  });
  log.info("OAuth", "Client registered", { clientId: client.client_id, name });
  noStore(res);
  return res.status(201).json({
    client_id: client.client_id,
    client_id_issued_at: Math.floor(client.created_at.getTime() / 1000),
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: client.grant_types,
    response_types: ["code"],
    client_uri: client.client_uri ?? undefined,
    logo_uri: client.logo_uri ?? undefined,
  });
});

// ---- authorization endpoint ------------------------------------------------

const redirectWithError = (res: Response, redirect_uri: string, error: string, description: string, state?: string) => {
  const url = new URL(redirect_uri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  noStore(res);
  return res.redirect(302, url.toString());
};

router.get("/authorize", async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const client_id = str(q.client_id);
  const redirect_uri = str(q.redirect_uri);
  const client = client_id ? await findClient(client_id) : null;
  // Without a known client and one of its registered redirect URIs there is no
  // safe place to send an error, so answer the browser directly.
  if (!client) return oauthError(res, "invalid_client", "Unknown client_id.", 400);
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri) || !isAllowedRedirectUri(redirect_uri)) {
    return oauthError(res, "invalid_redirect_uri", "redirect_uri is not registered for this client.");
  }
  const state = str(q.state);
  if (q.response_type !== "code") return redirectWithError(res, redirect_uri, "unsupported_response_type", "Only response_type=code is supported.", state);
  if (q.code_challenge_method !== "S256") return redirectWithError(res, redirect_uri, "invalid_request", "PKCE with code_challenge_method=S256 is required.", state);
  if (!isCodeChallenge(q.code_challenge)) return redirectWithError(res, redirect_uri, "invalid_request", "code_challenge must be a 43-character base64url S256 value.", state);
  const resource = str(q.resource) ?? (resourceOptional() ? mcpResource(req) : undefined);
  if (!resource) return redirectWithError(res, redirect_uri, "invalid_target", "The resource parameter is required and must name this server's /mcp endpoint.", state);
  if (resource !== mcpResource(req)) return redirectWithError(res, redirect_uri, "invalid_target", `Unknown resource. Use ${mcpResource(req)}.`, state);
  const scopes = parseScopes(str(q.scope));
  if (!scopes) return redirectWithError(res, redirect_uri, "invalid_scope", `Supported scopes: ${SCOPES.join(" ")}.`, state);

  const request = signConsentRequest({ client_id: client.client_id, redirect_uri, code_challenge: q.code_challenge as string, resource, scopes, state });
  const consent = new URL(`${feBaseUrl()}/oauth/consent`);
  consent.searchParams.set("request", request);
  noStore(res);
  return res.redirect(302, consent.toString());
});

// ---- consent (FE, app session) -----------------------------------------------

interface ConsentUser {
  user_id: number;
  name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

const loadConsentUser = async (userId: number): Promise<ConsentUser | null> => {
  const rows: ConsentUser[] = await AppDataSource.query(
    `SELECT user_id, name, last_name, email, role FROM "user" WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
};

const countMcpClients = async (): Promise<number> => {
  const rows: { n: string }[] = await AppDataSource.query(`SELECT count(*)::int AS n FROM company WHERE mcp_enabled = true AND status = true`);
  return Number(rows[0]?.n ?? 0);
};

const describeRequest = async (request: ReturnType<typeof readConsentRequest>, user: ConsentUser) => {
  if (!request) return null;
  const client = await findClient(request.client_id);
  if (!client) return null;
  const can_allow = user.role === UserRole.SUPERADMIN;
  return {
    client: { client_id: client.client_id, client_name: client.client_name, redirect_host: new URL(request.redirect_uri).host, client_uri: client.client_uri, logo_uri: client.logo_uri },
    scopes: request.scopes.map((s: Scope) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
    resource: request.resource,
    user: { user_id: user.user_id, name: [user.name, user.last_name].filter(Boolean).join(" ") || user.email, email: user.email, role: user.role },
    can_allow,
    refusal: can_allow ? null : { code: MCP_SUPERADMIN_ONLY, message: MCP_SUPERADMIN_ONLY_MESSAGE },
    clients_with_imports_enabled: await countMcpClients(),
    expires_at: new Date(request.exp * 1000).toISOString(),
  };
};

router.get("/authorize/request", authenticate, async (req: AuthRequest, res: Response) => {
  const request = readConsentRequest(req.query.request);
  if (!request) return res.status(400).json({ code: "OAUTH_REQUEST_INVALID", message: "This sign-in request has expired or is not valid. Start again from Claude." });
  const user = await loadConsentUser(Number(req.user?.userId));
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  const info = await describeRequest(request, user);
  if (!info) return res.status(400).json({ code: "OAUTH_REQUEST_INVALID", message: "The app behind this request is no longer registered. Start again from Claude." });
  noStore(res);
  return res.json(info);
});

router.post("/authorize/decision", authenticate, async (req: AuthRequest, res: Response) => {
  const body = req.body ?? {};
  const request = readConsentRequest(body.request);
  if (!request) return res.status(400).json({ code: "OAUTH_REQUEST_INVALID", message: "This sign-in request has expired or is not valid. Start again from Claude." });
  const client = await findClient(request.client_id);
  if (!client || !client.redirect_uris.includes(request.redirect_uri)) {
    return res.status(400).json({ code: "OAUTH_REQUEST_INVALID", message: "The app behind this request is no longer registered. Start again from Claude." });
  }
  const denied = new URL(request.redirect_uri);
  denied.searchParams.set("error", "access_denied");
  if (request.state) denied.searchParams.set("state", request.state);
  noStore(res);

  if (body.decision === "deny") {
    denied.searchParams.set("error_description", "The user denied the request.");
    return res.json({ decision: "deny", redirect_to: denied.toString() });
  }
  if (body.decision !== "allow") return res.status(400).json({ code: "OAUTH_DECISION_INVALID", message: 'decision must be "allow" or "deny".' });

  const user = await loadConsentUser(Number(req.user?.userId));
  if (!user) return res.status(401).json({ message: "Unauthorized" });
  if (user.role !== UserRole.SUPERADMIN) {
    // D4: nothing is stored, no code is issued; the FE can still send the person back.
    denied.searchParams.set("error_description", MCP_SUPERADMIN_ONLY_MESSAGE);
    log.warn("OAuth", "Consent refused: not a Superadmin", { userId: user.user_id, clientId: client.client_id });
    return res.status(403).json({ code: MCP_SUPERADMIN_ONLY, message: MCP_SUPERADMIN_ONLY_MESSAGE, redirect_to: denied.toString() });
  }

  const grant = await upsertGrant(user.user_id, client.client_id, request.scopes);
  const code = await issueCode({
    grant_id: grant.grant_id,
    client_id: client.client_id,
    redirect_uri: request.redirect_uri,
    code_challenge: request.code_challenge,
    resource: request.resource,
    scopes: request.scopes,
  });
  const allowed = new URL(request.redirect_uri);
  allowed.searchParams.set("code", code);
  if (request.state) allowed.searchParams.set("state", request.state);
  log.info("OAuth", "Consent granted", { userId: user.user_id, clientId: client.client_id, grantId: grant.grant_id });
  return res.json({ decision: "allow", grant_id: grant.grant_id, redirect_to: allowed.toString() });
});

// ---- token endpoint ------------------------------------------------------------

router.options("/token", open);
// Failures per client_id and IP (a legitimate client fails rarely; codes and
// tokens are 256-bit random, so this guards the database, not the secrets).
const tokenRateLimit = authRateLimit("oauth-token", "failures", {
  keyOf: (req) => (typeof req.body?.client_id === "string" ? req.body.client_id : ""),
  max: 30,
});
router.post("/token", open, ...formOrJson, tokenRateLimit, async (req: Request, res: Response) => {
  const body = req.body ?? {};
  noStore(res);
  const client_id = str(body.client_id);
  if (!client_id) return oauthError(res, "invalid_client", "client_id is required.");
  const client = await findClient(client_id);
  if (!client) return oauthError(res, "invalid_client", "Unknown client_id.");
  if (str(body.client_secret)) return oauthError(res, "invalid_client", "This is a public client; no client_secret is accepted.");
  const resource = str(body.resource);
  if (resource !== undefined && resource !== mcpResource(req)) return oauthError(res, "invalid_target", `Unknown resource. Use ${mcpResource(req)}.`);

  if (body.grant_type === "authorization_code") {
    const code = str(body.code);
    const redirect_uri = str(body.redirect_uri);
    const code_verifier = str(body.code_verifier);
    if (!code || !redirect_uri || !code_verifier) return oauthError(res, "invalid_request", "code, redirect_uri and code_verifier are required.");
    const result = await exchangeCode({ code, client_id, redirect_uri, code_verifier, resource });
    if (!result.ok) {
      log.warn("OAuth", "Code exchange refused", { clientId: client_id, reason: result.reason });
      return oauthError(res, "invalid_grant", `The authorization code was refused (${result.reason.replace(/_/g, " ")}).`);
    }
    const { grant_id: _grant, ...tokens } = result.tokens;
    return res.json({ ...tokens, token_type: "Bearer" });
  }

  if (body.grant_type === "refresh_token") {
    const refresh_token = str(body.refresh_token);
    if (!refresh_token) return oauthError(res, "invalid_request", "refresh_token is required.");
    const result = await refreshTokens({ refresh_token, scope: str(body.scope) ?? null, resource });
    if (!result.ok) {
      log.warn("OAuth", "Refresh refused", { clientId: client_id, reason: result.reason });
      if (result.reason === "scope_exceeded") return oauthError(res, "invalid_scope", "The requested scope is wider than the grant.");
      return oauthError(res, "invalid_grant", `The refresh token was refused (${result.reason.replace(/_/g, " ")}).`);
    }
    const { grant_id: _grant, ...tokens } = result.tokens;
    return res.json({ ...tokens, token_type: "Bearer" });
  }

  return oauthError(res, "unsupported_grant_type", "Use authorization_code or refresh_token.");
});

// ---- revocation (RFC 7009) --------------------------------------------------------

router.options("/revoke", open);
router.post("/revoke", open, ...formOrJson, async (req: Request, res: Response) => {
  const token = str(req.body?.token);
  if (token) await revokeToken(token);
  noStore(res);
  return res.status(200).end();
});

// ---- the user's connected apps (FE, app session) -----------------------------

const grantView = (g: Awaited<ReturnType<typeof listGrants>>[number]) => ({
  grant_id: g.grant_id,
  client: { client_id: g.client_id, client_name: g.client?.client_name ?? "Unknown app", client_uri: g.client?.client_uri ?? null, logo_uri: g.client?.logo_uri ?? null },
  scopes: splitScopes(g.scopes),
  created_at: g.created_at,
  last_used_at: g.last_used_at,
  revoked_at: g.revoked_at,
});

router.get("/grants", authenticate, async (req: AuthRequest, res: Response) => {
  const rows = await listGrants(Number(req.user?.userId), req.query.include_revoked === "1");
  noStore(res);
  return res.json({ grants: rows.map(grantView), connector_url: mcpResource(req) });
});

router.delete("/grants/:id", authenticate, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid grant id" });
  const ok = await revokeGrant(id, Number(req.user?.userId));
  if (!ok) return res.status(404).json({ message: "Connected app not found" });
  return res.json({ message: "Disconnected", grant_id: id });
});

// ---- who am I (MCP token) ------------------------------------------------------------
// The same check IM6 puts in front of /mcp; lets the connector flow be tested
// end to end before the MCP server exists.
router.get("/userinfo", requireMcpToken, (req: McpRequest, res: Response) => {
  noStore(res);
  const p = req.mcp!;
  return res.json({ user_id: p.user_id, role: p.role, scopes: p.scopes, grant_id: p.grant_id, client_id: p.client_id });
});

export default router;
