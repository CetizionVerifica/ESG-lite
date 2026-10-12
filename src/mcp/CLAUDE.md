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

## As built (IM6, 2026-10-12)

Files: `http.ts` (router: CORS, 5 MB body, auth, rate limit, transport), `auth.ts` (verifier hook + test tokens + role re-read), `server.ts`, `registry.ts` (`defineTool`, wrapper), `clientAccess.ts` (status + `mcp_enabled` per call), `rateLimit.ts`, `toolCallLog.ts` + `entities/McpToolCall.ts` + `scripts/createMcpToolCallTable.ts` (`migrate:mcp-log`), `codes.ts`, `errors.ts`, `ping.ts`, `guide/` (IM9: `loadInstructions()` feeds `McpServer`, `registerGuide(server)` adds the `import_workbook` prompt and the `esglite://guide/import` resource), `tools/read/index.ts` (IM7, see `tools/read/CLAUDE.md`) and `tools/import/index.ts` (IM8, see `tools/import/CLAUDE.md`).

- **Mount order.** `app.use("/mcp", mcpRouter)` sits in `src/index.ts` before the app-wide `express.json` and `cors`, so the router owns its 5 MB cap and its origin list (claude.ai, claude.com, anthropic.com subdomains plus the `MCP_CORS_ORIGINS` comma list; the app-wide `CORS_ORIGIN` is deliberately not admitted). `/.well-known/*` CORS is IM5's.
- **Token verifier.** IM5's `verifyMcpToken` (`src/oauth/verify.ts`) is the default verifier in `auth.ts`, wrapped so its numeric `grant_id` becomes the string the rate limit and log key on; `setMcpTokenVerifier` swaps it (tests) or clears it. After the verifier answers, `auth.ts` re-reads the role itself as well. The 401 challenge points at `/.well-known/oauth-protected-resource/mcp`, the same URL as IM5's `mcpChallenge`. Until then only test tokens work: `mcp-test.<user_id>.<scope,scope>[.<label>]`, on only when `MCP_TEST_TOKENS=true` and `NODE_ENV !== "production"` (`ci/api/run.cjs` sets it). After any verifier answers, `auth.ts` re-reads the user's role from the database on every request; anything but Superadmin is 403 `MCP_SUPERADMIN_ONLY` (MCP-08, demotion included).
- **Scopes.** `imports:read`, `imports:write`. A token with neither → HTTP 403 `insufficient_scope`. `tools/list` only shows tools whose `scope` the grant carries; `ping` has `scope: null`.
- **Per-call client check.** `defineTool.clientKey` (default `"company_id"`): when the input carries it, `assertClientUsable` runs before the handler: unknown → `CLIENT_NOT_FOUND`, `status = false` → `CLIENT_INACTIVE`, `mcp_enabled = false` → `MCP_DISABLED_FOR_CLIENT`. Tools that take a `plan_id` instead set `clientKey: null` and must check the plan's client themselves (IM8).
- **`company.mcp_enabled`.** Owned by IM5 (Company entity column, `migrate:oauth`, toggled via the admin companies endpoint). The core reads it with plain SQL (`SELECT mcp_enabled FROM company WHERE company_id = $1`) so either PR can merge first; a missing column reads as "off" (fail closed) with one warning. 
- **Errors.** `McpToolError(code, message?, details?)` for deliberate errors; `mapToolError` also passes through IM0's `ImportError` (or any thrown object whose `code` is a key of `IMPORT_ERRORS`). Anything else, Node and pg errors with their own `code` included, → `INTERNAL` with a `request_id`; the real message and stack go to the server log only, so host names never reach a client. Codes raised by the core itself live in `codes.ts`.
- **Rate limit.** `tools/call` messages only (initialize and tools/list are free), 60 per grant per minute (`MCP_RATE_LIMIT_MAX`, `MCP_RATE_LIMIT_DISABLED=true` to turn off), in memory per process. A JSON-RPC batch counts every `tools/call` it carries and is refused whole (429) when it would cross the limit.
- **Timeout.** `withTimeout` gives the handler `ctx.signal`, aborted after 30 s or when the client cancels the request; handlers pass it to queries and fetches so the work stops, not just the wait.
- **`API_BASE_URL`.** The 401 challenge and the `/.well-known` URLs are built from `API_BASE_URL`. Set it in production (the server logs a warning once if it is missing there); without it the URL is derived from the request's `Host` and `X-Forwarded-Proto`, which is fine locally and in CI only.
- **Log row.** Written after every call, `ok`/`error_code`/`duration_ms`, `company_id` from the input, `plan_id` from the input or `ctx.setPlanId(...)`. Never inputs or outputs. `oauth_grant.last_used_at` is updated best effort (skipped for test grants and where the table does not exist yet).
- **Guide.** `server.ts` passes IM9's `loadInstructions()` as the server `instructions` and calls `registerGuide(server)` once per request-scoped server. IM9 reads its markdown from `src/mcp/guide/` at runtime; the Docker image must keep that folder (it copies the repo today).
- **Stubs.** None left: IM7 (`tools/read/`) and IM8 (`tools/import/`) replaced the IM6 stubs with handlers over the IM3 and IM2 services, inputs from the IM0 zod objects; the registry wrapper stays. `NOT_IMPLEMENTED` remains in `codes.ts` for a future stub.
- **`ctx.writerContext`** from the spec is not in `McpToolContext` yet: it needs IM1's `WriterContext` shape, so IM8 adds it in `tools/import` where it is used, or IM6 adds it in a follow-up once IM1 merges.
- **Tests.** `ci/mcp/im6-core.test.cjs` runs inside `ci/api/run.cjs` (that runner now also picks up `ci/mcp/*.test.cjs`). Covers MCP-01, MCP-05 (real OAuth token at /mcp, revoked grant → 401), MCP-06, MCP-08, MCP-15, MCP-18, MCP-19 plus CORS, 405, scope filtering, the IM9 prompt and resource, validation errors and error shape.
