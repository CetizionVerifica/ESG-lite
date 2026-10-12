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
