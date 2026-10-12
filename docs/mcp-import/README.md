# ESGLite MCP import plan

Planning only. No code changed in ESG-lite_FE, ESG-lite or python_AI_service, no branches or PRs (Shyam, 2026-10-12: "Do not code yet").
Written 2026-10-12 against `redesign/integration`: FE `0d2a17e`, ESG-lite `3465100`, python_AI_service `9156114`.
Why and gap analysis: `../bulk-import/smart-import-plan.md`.

| File | What it is |
|---|---|
| `00-plan.md` | Goal, non-negotiables, decisions, modules, dependency graph, waves, lanes, file ownership, definition of done, layering, risks, milestones |
| `01-contracts.md` | Row schema, plan, HTTP API, error codes, writer interface, batch hook, MCP tools |
| `02-root-claude-snippets.md` | Always-on rules for each repo's root CLAUDE.md |
| `foundation/IM0-contracts/CLAUDE.md` | Contracts as code (zod), errors, limits, empty router |
| `backend/IM1-emission-write-service/CLAUDE.md` | One calculation engine for typed and imported rows, every category |
| `backend/IM2-import-plans-api/CLAUDE.md` | Plans: create, append, fix, commit as one pending batch |
| `backend/IM3-import-context-api/CLAUDE.md` | Sites, categories, forms, activity names, readiness |
| `backend/IM4-upload-notifications/CLAUDE.md` | Managers told when a batch is waiting |
| `auth/IM5-oauth-server/CLAUDE.md` | OAuth 2.1 + PKCE + client registration, revocation, per-client switch |
| `mcp/IM6-mcp-core/CLAUDE.md` | `/mcp` transport, auth, registry, limits, tool-call log |
| `mcp/IM7-read-tools/CLAUDE.md` | whoami, sites and categories, forms, activity search, readiness |
| `mcp/IM8-import-tools/CLAUDE.md` | plan, get, update, commit, cancel, batches |
| `mcp/IM9-guide-and-evals/CLAUDE.md` | Server instructions, import guide, 12-workbook eval set |
| `frontend/IM10-connect-claude-fe/CLAUDE.md` | Consent page, Connected apps, batch source chip, client switch |
| `later/IM11-bulk-upload-on-plans/CLAUDE.md` | P27 page moves to the plans API, Python calculation retired |
| `audit/IM12-mcp-audit/CLAUDE.md` | Probes and manual runs behind audit §12 |

Audit rows: `/mnt/project-files/audit/e2e-workflow-audit.md` §12 (MCP-01 to MCP-26) and flow E2E-10.

## Parallel lanes at a glance
Wave 0: IM0. Wave 1 (7 parallel): IM1, IM2 part 1, IM3, IM4, IM5, IM6, IM9 draft. Wave 2: IM2 part 2, IM10. Wave 3: IM7, IM8. Wave 4: IM9 evals, E2E-10, IM11.
