# IM12 · MCP audit (project files: audit harness)

> Blueprint spec for the audit lane. Lives in `/mnt/project-files/audit/` (not a repo). Checklist rows are in `audit/e2e-workflow-audit.md` §12.
> Depends on: IM0 to write probes; runs each probe once its module merges.

## Outcome
Every MCP-xx row has an automated probe or a written manual step, results land in `audit/results/LATEST.md` like the other rows, and nothing ships to a client before §12 passes.

## Build (when coding is allowed)
- `audit/harness/mcp-probes.cjs`: boots the built ESG-lite on the throwaway DB (same pattern as `api-probes.cjs`), runs the OAuth flow with a scripted public client (PKCE), then uses the MCP SDK client over HTTP to call every tool as each fixture role and company. One probe per MCP-xx row that can be automated; each returns `{ id, check, expected, observed, status }`.
- Add a step to `run-audit.sh`: `mcp-probes` after `api-probes`, skipped with "n/a" until `/mcp` exists on the integration head.
- `audit/harness/mcp-fixture.sql`: extra fixture rows: `mcp_enabled` on company 1 only, a yearly-capable category, a `per_method` and a `per_unit` config, a FERA-trigger category, a category with no form, a P23 mapping for company 2 with the same name as a company 1 factor.
- Parity probe: same rows typed through `POST /user/emissions` and planned through `plan_import` → equal totals per category (MCP-09/10).
- Manual rows (MCP-03, MCP-25, E2E-10) are run by hand on staging with a claude.ai custom connector and recorded with screenshots in `audit/results/`.

## Each module's own tests vs this audit
Module tests prove the module in isolation (unit, API, protocol). The audit proves the whole path with real FE + API + DB, no mocks, across roles and companies, and re-runs after every merge. A module is done only when both pass.
