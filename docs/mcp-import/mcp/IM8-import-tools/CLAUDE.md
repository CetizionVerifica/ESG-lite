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
