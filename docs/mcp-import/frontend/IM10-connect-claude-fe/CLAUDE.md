# IM10 · Connect Claude screens (ESG-lite_FE)

> Blueprint spec. Goes to `ESG-lite_FE/src/features/oauth-consent/CLAUDE.md` and `src/features/connected-apps/CLAUDE.md`.
> Depends on: IM5 API contract (mock with `page.route` until merged); IM2 batches `channel`. Lane L4.
> Follows the FE root CLAUDE.md (folders, src/ui, tokens only, definition of done).

## Outcome
Superadmins see what they're allowing and can disconnect Claude at any time; managers can tell Claude uploads apart. Only Superadmins can connect (D4).

## Build
1. **Consent page** `/oauth/consent?request=<id>` (route id `oauth-consent`; signs in first if needed and returns; any role but Superadmin sees "Only ESGLite staff (Superadmin) can connect Claude" and no Allow button). Shows the app name from registration, the user's name and client, what it can do ("read your sites, categories and forms", "create entries for review; it can't approve, edit or delete"), Allow / Deny. Brand theme of the user's client. Posts to `/oauth/authorize/decision`, then follows the redirect. As built (ESG-lite_FE #150): consent does **not** refuse when a client's switch is off, because a Superadmin grant is not tied to one client (D4); the switch is enforced per tool call (IM6). The page only hints, from `clients_with_imports_enabled`, when no client has the switch on. Audit row MCP-25 tests that hint, not a refusal.
2. **Connected apps** in Settings, Superadmin only (P14 tab "Connected apps", `/settings?tab=apps`, hidden for other roles): list of grants (app, connected on, last used, scopes), Disconnect with confirm (`DELETE /oauth/grants/:id`). Empty state explains how to add ESGLite in Claude (the connector URL `<API_BASE>/mcp`, with a copy button).
3. **Batch source chip** in P07 Upload batches: "Claude" / "Bulk upload" / "API" from `channel` (no channel = Bulk upload; the contract has no historical channel), filterable.
4. **Client switch** in P17 client detail (Superadmin): "Allow Claude imports" toggle bound to `mcp_enabled`, with a one-line explanation.

## Own tests
Unit: consent copy for Superadmin vs refused roles, scopes → sentences. Playwright: consent allow and deny (mocked), Connected apps list and disconnect, batch chip filter, client switch. Definition of done items 1–5 (themes, states, keyboard, widths).

## Audit rows
MCP-03, MCP-05, MCP-14 (chip), MCP-25.
