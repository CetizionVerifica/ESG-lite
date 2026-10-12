# IM5 · OAuth 2.1 server for MCP (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/oauth/CLAUDE.md`.
> Depends on: IM0. Blocks: IM10 (consent and Connected apps screens), live use of IM6. Lane L4.

## Outcome
A **Superadmin** can add ESGLite as a custom connector in Claude, sign in with their ESGLite account, approve access once, and revoke it later. No other role can get a token (D4). Tokens work only at `/mcp`.

## Build (MCP authorization spec: OAuth 2.1, PKCE, protected-resource metadata, resource indicators, dynamic client registration)
- Metadata:
  - `GET /.well-known/oauth-protected-resource` (and `/.well-known/oauth-protected-resource/mcp`) → `{ resource: "<API_BASE>/mcp", authorization_servers: ["<API_BASE>"], scopes_supported }`.
  - `GET /.well-known/oauth-authorization-server` → issuer, endpoints, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `registration_endpoint`.
- `POST /oauth/register`: dynamic client registration (public clients, `token_endpoint_auth_method: none`). Redirect URIs must be https (localhost http allowed for dev). Rate limited.
- `GET /oauth/authorize`: validates client, redirect_uri, `code_challenge` (S256 only), `resource` must equal the `/mcp` resource, scope. Redirects the browser to the FE consent page (IM10) with a signed, short-lived request id. The FE posts the decision to `POST /oauth/authorize/decision` with the user's normal app session.
- `POST /oauth/token`: `authorization_code` (PKCE verify, one-time code, 60 s life) and `refresh_token` (rotation; reuse of an old refresh token revokes the grant).
- `POST /oauth/revoke`; `GET /oauth/grants` and `DELETE /oauth/grants/:id` for the user's Connected apps page (status change, not a hard delete of history: set `revoked_at`).
- Tokens: opaque random strings, stored hashed (sha256). Access 1 h, refresh 30 days sliding, both bound to user, client, resource and scopes. Scopes: `imports:read`, `imports:write`.
- Consent decision refuses any user whose role isn't Superadmin with `MCP_SUPERADMIN_ONLY` (no code issued, nothing stored).
- `verifyMcpToken(token) → { user_id, role, scopes, grant_id } | null` exported for IM6. Re-reads the user's role on every call (cached ≤ 60 s) and returns null when it isn't Superadmin any more; rejects revoked grants and app JWTs. App endpoints (`authenticate`) must reject MCP tokens.
- Tables (`migrate:oauth`, idempotent): `oauth_client`, `oauth_grant` (user, client, scopes, created_at, last_used_at, revoked_at), `oauth_code`, `oauth_token` (hash, kind, grant_id, expires_at).
- Company switch: `company.mcp_enabled boolean default false` (same migration); Superadmin toggles it through the existing client update endpoint. It is checked per tool call against the `company_id` named (IM6), since a Superadmin's token is not tied to one client.
- Config: `API_BASE_URL`, `FE_BASE_URL` (consent page), `OAUTH_ALLOWED_REDIRECT_HOSTS` (optional allowlist; default allows claude.ai and claude.com callback hosts plus localhost in dev).

## Must not
- Accept the implicit grant, plain PKCE or tokens in query strings.
- Log tokens or codes (extend `requestLogger` redaction).

## Own tests
`ci/api/tests/im5-oauth.test.cjs`: metadata shapes; full code + PKCE flow with a scripted client; wrong verifier, reused code, expired code, mismatched redirect_uri, missing or wrong `resource` → errors; refresh rotation and reuse detection; revoke → `verifyMcpToken` null; MCP token on `/user/emissions` → 401; app JWT to `verifyMcpToken` → null; Manager, Admin and User consent → `MCP_SUPERADMIN_ONLY`, no code; a Superadmin demoted after consent → next `verifyMcpToken` null; tokens stored hashed (DB check); rate limit on register and token.

## Audit rows
MCP-01 to MCP-06.

## Acceptance
MCP Inspector (OAuth flow) and a claude.ai custom connector on staging both complete sign-in against a local or staging API.

## As built (2026-10-12)

Files: `config.ts` (env, scopes, redirect allowlist), `tokens.ts` (random values, sha256, PKCE S256), `consentRequest.ts` (signed request id = JWT over the validated authorize params, 10 min, audience `esglite-oauth-consent`, signed with its own key `purposeKey(audience)` = HMAC(JWT_SECRET, audience) so it can never pass as an app session; nothing pending is stored), `service.ts` (clients, grants, codes, tokens; the only place plain values exist), `verify.ts` (`verifyMcpToken`, `requireMcpToken` middleware, `mcpChallenge`), `router.ts` (`/oauth/*`), `wellKnown.ts` (`/.well-known/*`). Entities `src/entities/Oauth{Client,Grant,Code,Token}.ts`; migration `src/scripts/createOauthTables.ts` (`migrate:oauth`, also adds `company.mcp_enabled`).

Endpoints beyond the spec, both under the app session (`authenticate`):
- `GET /oauth/authorize/request?request=<id>` → what the consent page shows: `{ client: { client_id, client_name, redirect_host, client_uri, logo_uri }, scopes: [{ scope, description }], resource, user: { user_id, name, email, role }, can_allow, refusal: { code: "MCP_SUPERADMIN_ONLY", message } | null, clients_with_imports_enabled, expires_at }`. 400 `OAUTH_REQUEST_INVALID` when the request is expired, tampered with or its client is gone.
- `POST /oauth/authorize/decision { request, decision: "allow" | "deny" }` → `{ decision, redirect_to, grant_id? }`. A non-Superadmin "allow" gets 403 `{ code: "MCP_SUPERADMIN_ONLY", message, redirect_to }` (redirect_to carries `error=access_denied`, so the FE can send the person back to Claude); nothing is stored.
- `GET /oauth/grants` → `{ grants: [{ grant_id, client, scopes, created_at, last_used_at, revoked_at }], connector_url }` (live grants; `?include_revoked=1` for history). `DELETE /oauth/grants/:id` → 200, 404 for another user's grant.
- `GET /oauth/userinfo` (MCP bearer token) → `{ user_id, role, scopes, grant_id, client_id }`. It runs the exact check IM6 puts in front of `/mcp` (`requireMcpToken`), so the connector flow is testable before the MCP server exists.

Decisions:
- Codes and tokens carry prefixes `esgl_ac_`, `esgl_at_`, `esgl_rt_` (32 random bytes). Only sha256 hashes are stored. A failed PKCE check burns the code. A replayed code revokes the tokens its first exchange minted (OAuth 2.1 §4.1.2). Refresh reuse revokes the grant; access tokens from the previous refresh keep running until they expire (≤ 1 h).
- Refresh and revoke are bound to the client: `client_id` must match the grant's (`invalid_grant` on refresh; revoke answers 200 but changes nothing, and 401 `invalid_client` without a `client_id`).
- `utils/jwt.ts` `verifyToken` (used by `authenticate`, `reportAuth` and the notification stream) now accepts only session tokens: an object payload with numeric `userId`, string `role` and no `aud`. Any other JWT the server signs must use `purposeKey()`.
- `resource` is required on `/oauth/authorize` and, when sent, must match on `/oauth/token` (RFC 8707). `OAUTH_RESOURCE_OPTIONAL=true` relaxes the authorize side for clients that don't send it.
- Redirect hosts: default `claude.ai`, `claude.com` and subdomains; `localhost` / `127.0.0.1` outside production (MCP Inspector). `OAUTH_ALLOWED_REDIRECT_HOSTS` replaces the default list.
- `API_BASE_URL` and `FE_BASE_URL` fall back to the request's host and the first `CORS_ORIGIN`, so CI and local runs need no extra settings. Set both in staging and production.
- Role cache: `MCP_ROLE_CACHE_MS` (default 60 s; 0 under `NODE_ENV=test`).
- The consent page does not check `company.mcp_enabled`: a Superadmin's grant is not tied to one client (D4), so the switch is enforced per tool call (IM6). The request info carries `clients_with_imports_enabled` so the page can hint when it is 0.
- `PUT /admin/companies/:id { mcp_enabled }` validates the boolean; the companies list returns the field.
- Rate limits reuse `authRateLimit`: register counts every request (10 per IP); authorize 60 per IP; token counts failures per `client_id` and IP (30, via the new `options` argument); revoke 60 per `client_id` and IP.
- Request log redaction now covers `code`, `code_challenge`, `code_verifier`, `refresh_token`, `state` and `request` query values.
- IM6 wiring: `setMcpTokenVerifier(verifyMcpToken)` (one line in `src/mcp/auth.ts` or here, whichever merges second); `requireMcpToken` and `mcpChallenge` are exported for it too.

Tests: `ci/api/tests/im5-oauth.test.cjs` (24 tests), `ci/unit/request-logger.test.cjs` (redaction).
