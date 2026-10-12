# IM7 · Read tools (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/mcp/tools/read/CLAUDE.md`.
> Depends on: IM3 (services), IM6 (registry). Lane L3.

## Outcome
Claude can find out, without guessing, which clients, sites and categories the user can import into, what each category's form needs, which activity names exist, and what's missing before an import.

## Build
Tools `whoami`, `list_sites_and_categories`, `get_category_form`, `find_activity`, `check_readiness` (`01-contracts.md` §8), scope `imports:read`, annotations `readOnlyHint: true, openWorldHint: false`.
- Descriptions say when to use each, in one or two sentences, e.g. "Call before plan_import to get site_id and category_id; names are not accepted by plan_import."
- Results: a one-line human summary in `content[0].text` and the full object in `structuredContent` (with `outputSchema`). Sheet or user text never goes into the summary line.
- `check_readiness` returns, for gaps, the app page that fixes them (P24 forms, P22 factors) as full URLs from `FE_BASE_URL`.
- Keep outputs small: no activity lists in `list_sites_and_categories`; `get_category_form` returns the 50 most used names; `find_activity` up to 10.

## Own tests
`ci/mcp/im7-read-tools.test.cjs`: each tool as Superadmin; missing `company_id` → `IMPORT_COMPANY_REQUIRED`; client with `mcp_enabled` off → `MCP_DISABLED_FOR_CLIENT`; `get_category_form` with a site of another client than `company_id` → `IMPORT_FORBIDDEN`; non-Superadmin token → 403; output validates against `outputSchema`; summary line has no sheet text.

## Audit rows
MCP-07, MCP-08, MCP-20.

## As built (2026-10-12, lane L3)
- `index.ts` exports `readTools` (five `defineTool`s, scope `imports:read`, `readOnlyHint: true`, `idempotentHint: true`, `destructiveHint: false`, `openWorldHint: false`). Inputs are IM0's `ToolInputs` shapes; `get_category_form` and `find_activity` also accept an optional `company_id`. Handlers wrap the IM3 service (`src/imports/context/service.ts`: `resolveImportScope`, `buildImportContext`, `loadForm`, `searchActivities`, `buildReadiness`), never HTTP routes, and each re-checks `role === "Superadmin"` (D4) before anything else.
- Client check (MCP-07): `whoami` names no client. `list_sites_and_categories` and `check_readiness` take `company_id`, which the registry checks (`CLIENT_NOT_FOUND` / `CLIENT_INACTIVE` / `MCP_DISABLED_FOR_CLIENT`) before the handler. The site-addressed tools resolve the site's client: with `company_id` given, a site of another client is `IMPORT_FORBIDDEN`; without it, the site's client goes through the same `assertClientUsable` check. An unknown site, or a category the site is not assigned, is `IMPORT_FORBIDDEN` too (never "not found"). A missing `company_id` on the two client-addressed tools is refused by the input schema (the SDK's validation error names the field), so the handler never sees it; `IMPORT_COMPANY_REQUIRED` only arises if a schema change lets it through.
- Summary lines (`content[0].text`) carry ids and counts only (`find_activity: site 1 × category 1, 2 match(es)`); names from factors, mappings, users or sheets stay inside `structuredContent` (MCP-20).
- `whoami`: the user row, the connection's scopes, the clients with `mcp_enabled = true AND status = true` (empty when IM5's column is not migrated yet) and the IM0 limits plus `find_activity_matches` (10).
- `list_sites_and_categories`: the IM3 `ImportContext` as is (activity counts, no activity lists).
- `get_category_form`: site and category names, period modes, the form (read fresh with `loadForm`, so a config change shows at once rather than after the 60 s context cache), units, readiness and `activities`: the site × category's factor names and mappings with `uses` (saved rows whose `activity_data.emission_category` is that name, rejected rows excluded), most used first, then alphabetical, at most 50.
- `find_activity`: `searchActivities` with the query, at most 10 matches, `truncated: true` when more matched.
- `check_readiness`: IM3 readiness (`cells`, `gaps`) plus `ready` (count). Fix links come from `FRONTEND_URL`, the backend's existing name for the FE base (the spec's `FE_BASE_URL` does not exist in this repo).
- `outputSchema` is deliberately not published. The official TypeScript client validates `structuredContent` of error results as well, and the §9 error shape `{ code, details }` would turn every tool error into a client-side `McpError`. The output shapes live in `ReadToolOutputs` and CI validates every success result against them (`.strict()`); publish them once §9 or the SDK changes.
- Tests: `ci/mcp/im7-read-tools.test.cjs` (10 tests, run by `ci/api/run.cjs` with `MCP_TEST_TOKENS=true`; seeds its own forms, factors, mappings and emission rows and removes them after). Audit rows MCP-07, MCP-08, MCP-20.
