# IM8 · Import tools (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/mcp/tools/import/CLAUDE.md`.
> Depends on: IM2 part 2 (wired to IM1), IM6. Lane L1.

## Outcome
Claude can turn a workbook into a plan, fix it with the user, and commit it as one pending batch.

## Build
Tools `plan_import`, `get_import_plan`, `update_import_plan`, `commit_import`, `cancel_import_plan`, `list_upload_batches` (`01-contracts.md` §8) over the IM2 service with `channel: "mcp"`.
- Scopes: `imports:read` for get and list; `imports:write` for the rest.
- `plan_import` with `plan_id` appends (chunks of ≤ 2,000 rows). Result: plan summary, issues summary, first 50 issue rows.
- `commit_import` requires `confirm: true` and the current `version`; description tells Claude to show the user the totals by category and month and the issue count, and to get an explicit yes, before calling it. Idempotency key = `plan_id:version`.
- Annotations: `commit_import` `destructiveHint: false, idempotentHint: true`; `cancel_import_plan` `destructiveHint: false`.
- `list_upload_batches` shows pending / approved / rejected counts so Claude can answer "has my upload been approved?".

## Own tests
`ci/mcp/im8-import-tools.test.cjs`: full flow plan → append → update (skip, set, activity match) → commit → batch listed; commit without confirm → validation error; stale version → conflict; repeat commit → same batch, no new rows; totals in rows ignored (`CLIENT_TOTAL_IGNORED`); a row whose site belongs to another client than `company_id` → `SITE_NOT_ALLOWED`; a plan of client 1 can't be appended or committed with `company_id` 2; non-Superadmin token → 403; batches carry `created_by` = the Superadmin; rows in DB are pending with the batch id and audit text "Imported via Claude".

## Audit rows
MCP-09 to MCP-14, MCP-17, MCP-19, MCP-21.

## As built (IM8, 2026-10-12)

`src/mcp/tools/import/index.ts` replaces IM6's stubs; `ci/mcp/im8-import-tools.test.cjs` runs inside `ci/api/run.cjs` after the IM6 core tests.

- **Thin handlers.** Each tool maps its input to one call on `src/imports/plans/service.ts` (`createPlan` / `appendRows`, `getPlan`, `patchPlan`, `commitPlan`, `cancelPlan`, `listBatches`) with `channel: "mcp"` and the principal as `{ userId, role }`. Rules, totals and transactions stay in the service and IM1's writer; nothing here computes or stores a total.
- **Client switch.** `plan_import` and `list_upload_batches` carry `company_id`, so the registry's `assertClientUsable` runs first. The `plan_id` tools (`get_import_plan`, `update_import_plan`, `commit_import`, `cancel_import_plan`) set `clientKey: null` and call `loadPlanForTool`: `loadVisiblePlan` (404 for an unknown id), then `assertClientUsable(plan.company_id)`. A client switched off after planning gets `MCP_DISABLED_FOR_CLIENT` on every one of them.
- **Append.** `plan_import` with `plan_id` requires `version` (else `IMPORT_VALIDATION`) and refuses a plan of another client than `company_id` with `IMPORT_FORBIDDEN` (the plan id and the *named* company id in `details`). That comparison runs before the plan owner's switch check, so a mismatch never reveals which client owns the plan or whether its switch is on. `source_name` is required by the contract but ignored on append: the plan keeps the name it was created with. Row-level scope (a site of another client) is the writer's `SITE_NOT_ALLOWED` issue, as for every channel.
- **Rows arrive loose.** The tool input is `ImportRowShape.loose()` (and `set` on a change likewise), so total-like keys reach the handler; `parseImportRows` / `findTotalLikeChanges` record them and the IM0 schema strips them, and the rows get `CLIENT_TOTAL_IGNORED`. The JSON schema shown to Claude still documents every row field (`items.properties`).
- **Result shape.** `plan_import` returns the plan view plus `rows` = the rows with issues only (up to 50, `PLAN_PREVIEW_ROWS`) and `total_rows`; `get_import_plan` pages 50 rows issues-first; `list_upload_batches` returns `{ company_id, page, page_size, batches }`. The summary line is always `<tool>: ok`; sheet text lives only in `structuredContent`.
- **Commit.** `commit_import` needs `confirm: true` (a zod literal, so a missing or false confirm is a validation error before the handler) and the current `version`; the idempotency key is `plan_id:version`, so a repeat with the same version returns the stored batch and inserts nothing. The committed plan's version is one higher; a call with that version gets `IMPORT_PLAN_NOT_DRAFT`.
- **Log row.** Every plan tool calls `ctx.setPlanId` before any work, so a refused call is logged against its plan too. `company_id` on the log row is null for the plan tools (the input has none); the plan row carries it.
- **Not here.** No approve, reject, edit, delete, user, site, factor or form tools (`registry.ts` refuses such names at registration; MCP-19). `ctx.writerContext` from the IM6 spec is not needed: the service builds the writer context from the principal and the plan's client.
