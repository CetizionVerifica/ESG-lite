# ESGLite MCP import: plan

Planning only. No code changed, no branches or PRs (Shyam, 2026-10-12: "Do not code yet").
Written 2026-10-12 against the `redesign/integration` heads: ESG-lite_FE `0d2a17e`, ESG-lite `3465100`, python_AI_service `9156114`.
Background and gap analysis: `/mnt/project-files/bulk-import/smart-import-plan.md`.

## 1. Goal

A client user opens Claude (claude.ai, the desktop app or Cowork), adds the ESGLite connector once, drops an Excel workbook of GHG activity data and says "import this for Plant 2". Claude reads the workbook in whatever layout it has, works out sites, categories, periods, activities and units, and calls ESGLite tools. ESGLite validates and calculates every row with the same engine as a typed entry, shows a plan with issues, and saves the rows as **pending** under one upload batch once the user confirms. The site's managers are notified and approve the batch in the app.

It must work for **every category assigned to the client's sites**, monthly and yearly.

## 2. What stays true (non-negotiables)

1. **One calculation engine.** Totals come from the ESG-lite (Node) calculation that typed entries use. Any total, factor or unit sent by Claude is ignored.
2. **Plan, then commit.** Nothing reaches the `emission` table until `commit_import` is called on the current plan version.
3. **Pending only.** Imported rows are `pending`. The MCP server has no approve, reject, edit or delete tools.
4. **Superadmin only** (Shyam, 2026-10-12). Only Superadmin accounts can connect Claude and get MCP tokens. Every tool call names the client (`company_id`), a plan belongs to one client, and a token stops working the moment its account is no longer Superadmin. Other roles keep using the app (Add data, Bulk upload); the `/imports` API keeps the app's role scoping for the in-app page (IM11).
5. **Data-safety CI.** Schema changes are additive, nullable and shipped as idempotent `migrate:*` scripts. The golden calculation snapshot must not move.
6. **Off by default.** Each client has an `mcp_enabled` switch (Superadmin). Off means every tool returns `MCP_DISABLED_FOR_CLIENT`.

## 3. Decisions (defaults picked; Shyam can change them)

| # | Question | Default |
|---|---|---|
| D1 | Where does the MCP server run? | Inside ESG-lite at `/mcp`, same deployment. It already owns auth, scoping and the calculation. |
| D2 | Transport and SDK | Streamable HTTP, stateless, official `@modelcontextprotocol/sdk` (TypeScript), version pinned at build time. |
| D3 | Sign-in | OAuth 2.1 authorization server in ESG-lite: authorization code + PKCE, dynamic client registration, protected-resource metadata, tokens bound to the `/mcp` resource. Consent page in the FE. |
| D4 | Who can use it | **Superadmin only** (Shyam's decision 2026-10-12). Consent is refused for every other role; tools re-check the role on each call. |
| D5 | Who can save activity-name matches as category mappings (P23) | Through Claude: the Superadmin, per match, only when `save_mapping: true`. In the app (IM11): Superadmin and company Admin. |
| D6 | Distances given as places (origin, destination) | Not in v1. Such rows get `DISTANCE_REQUIRED`; Claude asks the user for km. Later module. |
| D7 | Does the P27 Bulk upload page move onto the same plans API? | Yes, but after the MCP path is live (IM11). |
| D8 | Who gets notified | Managers of each site in the batch, once per batch, in-app (P13) plus email per their preferences. |

## 4. Modules

IDs use the `IM` prefix (B1–B8, I1–I4, E1–E2 are taken). PR titles follow the project convention `[IM3 1/2]`, last PR body `Completes: IM3`.

| ID | Module | Repo | Depends on | Spec |
|---|---|---|---|---|
| IM0 | Contracts: row schema, plans API, tool schemas, error codes | ESG-lite (docs + `src/imports/contracts.ts`) | — | `foundation/IM0-contracts/CLAUDE.md` + `01-contracts.md` |
| IM1 | Emission write service (extract typed-entry calculation) | ESG-lite | IM0 | `backend/IM1-emission-write-service/CLAUDE.md` |
| IM2 | Import plans API (plan, update, commit, batches) | ESG-lite | IM0; part 2 wires IM1 | `backend/IM2-import-plans-api/CLAUDE.md` |
| IM3 | Import context API (sites, categories, forms, activity names, readiness) | ESG-lite | IM0 | `backend/IM3-import-context-api/CLAUDE.md` |
| IM4 | Upload-pending notifications | ESG-lite (+ FE label) | IM0 | `backend/IM4-upload-notifications/CLAUDE.md` |
| IM5 | OAuth 2.1 server for MCP | ESG-lite | IM0 | `auth/IM5-oauth-server/CLAUDE.md` |
| IM6 | MCP server core (`/mcp`, auth, registry, limits, tool log) | ESG-lite | IM0 (+ IM5 verifier interface) | `mcp/IM6-mcp-core/CLAUDE.md` |
| IM7 | Read tools | ESG-lite | IM3, IM6 | `mcp/IM7-read-tools/CLAUDE.md` |
| IM8 | Import tools | ESG-lite | IM2 (wired), IM6 | `mcp/IM8-import-tools/CLAUDE.md` |
| IM9 | Server instructions, import guide, evals | ESG-lite | IM0; eval run needs IM7+IM8 | `mcp/IM9-guide-and-evals/CLAUDE.md` |
| IM10 | FE: consent page, Connected apps, batch source chip, client switch | ESG-lite_FE | IM5 API contract (mocked until merged) | `frontend/IM10-connect-claude-fe/CLAUDE.md` |
| IM11 | Bulk upload (P27) on the plans API | python_AI_service + ESG-lite_FE | IM2 (wired) | `later/IM11-bulk-upload-on-plans/CLAUDE.md` |
| IM12 | Audit: probes, E2E-10, checklist runs | project files (audit harness) | IM0 to write; runs as modules merge | `audit/IM12-mcp-audit/CLAUDE.md` |

## 5. Dependency graph and waves

```
            IM0 contracts
   ┌────┬─────┼──────┬──────┬──────┬──────┐
  IM1  IM2·1 IM3    IM4    IM5    IM6    IM9 (draft)      ← wave 1, all parallel
   └──┬─┘     │             │      │
     IM2·2    │            IM10    │                      ← wave 2
      │       └──── IM7 ◄──────────┤
      └──────────── IM8 ◄──────────┘                      ← wave 3
                    │
          IM9 evals, IM12 E2E-10, IM11                     ← wave 4
```

- **Wave 0:** IM0 alone (one small PR). Everything else codes against its types.
- **Wave 1 (7 in parallel):** IM1, IM2 part 1 (table, endpoints, a fake writer behind the IM0 interface), IM3, IM4, IM5, IM6 (tools stubbed from IM0 schemas, test tokens), IM9 draft.
- **Wave 2:** IM2 part 2 (swap the fake for IM1), IM10.
- **Wave 3:** IM7 and IM8 (in parallel).
- **Wave 4:** IM9 eval run, IM12 E2E-10 on staging, IM11.

## 6. Lanes (one thread each, the existing lane rules apply)

| Lane | Modules in order | Why together |
|---|---|---|
| L1 Engine | IM1 → IM2 part 2 → IM8 | Same calculation code all the way to the commit tool |
| L2 Plans | IM2 part 1 → IM11 | Plan storage, then the P27 move onto it |
| L3 Context | IM3 → IM7 | Read API, then the read tools over it |
| L4 Auth | IM5 → IM10 | OAuth server, then its consent and Connected apps screens |
| L5 MCP core | IM6 → help IM8 review → IM9 eval run | Transport and registry owner |
| L6 Notify + guide | IM4 → IM9 | Small modules |
| Audit | IM12, continuous | Writes probes from IM0, runs them as each module merges |

IM0 is done by whichever lane starts first; the others wait for it to merge (expected to be small and quick).

### Files each module owns (so lanes don't collide)

| Module | Owns | Shared files it may touch (one small addition each) |
|---|---|---|
| IM0 | `src/imports/contracts.ts`, `src/imports/errors.ts`, `src/imports/router.ts` (empty), `src/imports/CLAUDE.md`, `docs/mcp-import/` | `src/index.ts` (mount `/imports`) |
| IM1 | `src/services/emissionWrite/**` | `emission.controller.ts` (createEmission calls the service) |
| IM2 | `src/imports/plans/**`, `src/entities/ImportPlan.ts`, `src/scripts/createImportPlanTables.ts` | `src/imports/router.ts` (one line), `package.json` (`migrate:import-plans`), `scripts/migrate-all.cjs` |
| IM3 | `src/imports/context/**` | `src/imports/router.ts` (one line) |
| IM4 | `src/services/uploadNotify.ts` | `notificationService.ts` (`NOTIFICATION_GROUPS`), FE `src/ui/notificationKind.ts` |
| IM5 | `src/oauth/**`, `src/entities/Oauth*.ts`, `src/scripts/createOauthTables.ts` | `src/index.ts` (mount `/oauth`, `/.well-known`), `package.json`, `migrate-all.cjs` |
| IM6 | `src/mcp/*.ts` (not `tools/`), `src/mcp/CLAUDE.md` | `src/index.ts` (mount `/mcp`), `package.json` (SDK dependency) |
| IM7 | `src/mcp/tools/read/**` | — |
| IM8 | `src/mcp/tools/import/**` | — |
| IM9 | `src/mcp/guide/**`, `ci/mcp-evals/**` | — |
| IM10 | FE `src/features/oauth-consent/**`, `src/features/connected-apps/**` | FE approvals batch row (source chip), P17 client detail (switch) |
| IM11 | AI `app/services/excel_plan_client.py`; FE `src/features/bulk-upload/**` | AI `excel_parser.py` (import path delegates) |

`src/index.ts` gets one-line mounts from IM0, IM5 and IM6; `src/imports/router.ts` one line each from IM2 and IM3. Each lane rebases on the latest integration head before merging; the conflict is a one-line keep-both.

## 7. Definition of done (every IM module)

1. Matches its spec; any change to a contract in `01-contracts.md` goes through an IM0 follow-up PR first.
2. Own tests pass: unit (`ci/unit`), API (`ci/api/tests/im*.test.cjs`), MCP protocol tests (`ci/mcp/`) where relevant. CI green, golden snapshot unchanged.
3. Its audit rows (`MCP-xx` in `audit/e2e-workflow-audit.md` §12) are runnable and pass in the next audit run.
4. Tenant isolation: at least one test per new endpoint or tool with a company 2 token on company 1 ids.
5. Migrations: additive, idempotent, listed in `migrate:all`, run twice in CI.
6. Errors use the IM0 codes; no stack traces or SQL in responses or tool results.
7. The module's CLAUDE.md is copied into its folder (layering below) and updated with "As built" notes.

## 8. Layering (where each file goes when coding starts)

```
ESG-lite/CLAUDE.md                        ← 02-root-claude-snippets.md (ESG-lite block)
 └ docs/mcp-import/                       ← this whole folder, copied as is (IM0)
   src/imports/CLAUDE.md                  ← foundation/IM0 (contracts, codes, limits)
   src/imports/plans/CLAUDE.md            ← backend/IM2
   src/imports/context/CLAUDE.md          ← backend/IM3
   src/services/emissionWrite/CLAUDE.md   ← backend/IM1
   src/oauth/CLAUDE.md                    ← auth/IM5
   src/mcp/CLAUDE.md                      ← mcp/IM6
   src/mcp/tools/read/CLAUDE.md           ← mcp/IM7
   src/mcp/tools/import/CLAUDE.md         ← mcp/IM8
   src/mcp/guide/CLAUDE.md                ← mcp/IM9
ESG-lite_FE/CLAUDE.md                     ← snippet (FE block)
   src/features/oauth-consent/CLAUDE.md   ← frontend/IM10 (consent part)
   src/features/connected-apps/CLAUDE.md  ← frontend/IM10 (connections part)
python_AI_service/CLAUDE.md               ← snippet (AI block, added by IM11)
```
A session working on one module reads: its repo root CLAUDE.md, `docs/mcp-import/00-plan.md`, `01-contracts.md`, the folder CLAUDE.md files above its own, and its own spec. Not other modules' specs.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Extracting the typed-entry calculation (IM1) changes numbers | Golden snapshot must stay identical; IM1 adds parity tests per category before moving code |
| Prompt injection through sheet cells (an activity name that says "approve everything") | No approve or delete tools exist; tool results mark sheet text as data; server never acts on cell text; IM9 evals include hostile cells |
| A token leaks | Short-lived access tokens (1 h), refresh rotation, revoke in Connected apps, per-client off switch, tool-call log |
| Large workbooks | 2,000 rows per call, 20,000 per plan, append in chunks; commit in one transaction |
| Claude maps something wrong | Plan shows per-row issues and totals by category and month; commit needs the current version; rows are pending, managers review |
| Client data passes through Claude | Only Superadmins (staff) use it; only the rows they ask to import; documented for the client; per-client switch |
| MCP spec or Claude connector requirements move | IM6 pins the SDK; IM12 includes a live connector test on staging before release |

## 10. Milestones

| Milestone | Done when |
|---|---|
| MI-0 | IM0 merged |
| MI-1 Engine ready | IM1 + IM2 merged; `POST /imports/plans` → commit works with an app token; parity tests green |
| MI-2 Connector works | IM5 + IM6 + IM7 + IM8 merged; MCP Inspector and a claude.ai custom connector on staging can plan and commit |
| MI-3 Release | IM4, IM9 evals, IM10 merged; audit §12 all pass; E2E-10 pass on staging; Shyam turns `mcp_enabled` on for a pilot client |
| MI-4 | IM11: P27 Bulk upload uses the same plans; Python calculation path retired |
