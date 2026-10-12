# IM6 · MCP server core (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/mcp/CLAUDE.md`. Parent layer of IM7, IM8, IM9.
> Depends on: IM0, IM5's `verifyMcpToken` signature (a test verifier until IM5 merges). Blocks: IM7, IM8. Lane L5.

## Outcome
`POST /mcp` speaks MCP over Streamable HTTP, authenticates every request, lists the tools the token's scopes allow, runs them with the caller's scope, limits and logs them.

## Build
- Dependency: `@modelcontextprotocol/sdk` (pin exact). `McpServer` + `StreamableHTTPServerTransport` in stateless mode (new server per request, no session id), JSON responses; `GET /mcp` and `DELETE /mcp` → 405.
- `src/mcp/http.ts`: Express handler. Bearer token → `verifyMcpToken`. Missing or bad token → 401 with `WWW-Authenticate: Bearer resource_metadata="<API_BASE>/.well-known/oauth-protected-resource"`. Wrong scope → 403 `insufficient_scope`.
- `src/mcp/server.ts`: builds the server with `name: "esglite"`, version from package.json, `instructions` from IM9 (`src/mcp/guide/instructions.md`, a placeholder until IM9).
- `src/mcp/registry.ts`: `defineTool({ name, title, description, input (zod from IM0), scope, annotations, handler(ctx, input) })`. Tools register from `tools/read/index.ts` and `tools/import/index.ts` (IM7/IM8 fill them; IM6 ships one `ping` tool and stubs that return `NOT_IMPLEMENTED`).
- Superadmin gate: every request checks `role === "Superadmin"` (defence in depth over IM5); otherwise 403 `MCP_SUPERADMIN_ONLY`.
- `ctx`: `{ user, scopes, grant_id, writerContext(company_id), log }`. Handlers call the IM2/IM3 **services** directly (not HTTP).
- Errors: IM0 codes → `isError` results (contracts §9). Unknown errors → `INTERNAL` with a request id, details only in logs.
- Limits: request body 5 MB; 60 tool calls per minute per grant (`rateLimit.middleware.ts` pattern); 30 s timeout per call.
- Tool-call log: table `mcp_tool_call` (grant_id, user_id, company_id, tool, plan_id null, ok, error_code, duration_ms, created_at). No row payloads. Migration `migrate:mcp-log`. Updates `oauth_grant.last_used_at`.
- `mcp_enabled` off for the named `company_id` → that tool call returns `MCP_DISABLED_FOR_CLIENT`; inactive client → `CLIENT_INACTIVE`.
- CORS: `/mcp` and `/.well-known/*` allow the Claude web origins needed by connectors; nothing else changes.

## Own tests
`ci/mcp/im6-core.test.cjs` with the SDK's client over HTTP against the built server: initialize, `tools/list` filtered by scope, `ping`, 401 + header without token, 403 on scope, 405 on GET, rate limit 429, body too large 413, error mapping, log row written without payload, `mcp_enabled` off, a non-Superadmin token (forced in the DB) → 403.

## Audit rows
MCP-01 (401 header), MCP-06, MCP-15, MCP-18, MCP-19.

## Acceptance
MCP Inspector connects with a test token and lists tools; CI runs the protocol tests on every PR.
