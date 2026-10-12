# IM2 · Import plans API (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/imports/plans/CLAUDE.md`.
> Depends on: IM0 (part 1), IM1 (part 2). Blocks: IM8, IM11. Lanes: part 1 L2, part 2 L1.

## Outcome
Rows from any channel become a stored, re-checkable plan, and a plan commits as one pending upload batch.

## Part 1 (parallel with IM1)
- Tables (`migrate:import-plans`, `src/scripts/createImportPlanTables.ts`, idempotent, added to `migrate:all`):
  - `import_plan` (uuid pk, company_id, created_by, channel, source_name, status, version, counts jsonb, totals jsonb, upload_batch_id null, idempotency_key null unique, expires_at, created_at, updated_at).
  - `import_plan_row` (plan_id fk, row_ref, position, input jsonb, state, issues jsonb, result jsonb; unique plan_id + row_ref).
  - `import_plan_match` (plan_id, site_id, category_id, sheet_name, factor_name).
- Endpoints of `01-contracts.md` §4 marked IM2, in `src/imports/plans/` (router, controller, service). Use a **fake writer** behind the IM0 `EmissionWriter` interface for tests.
- Scope: `WriterContext` built from the token (role, company, sites, User's categories); Superadmin must pass `company_id`; `mcp_enabled` checked when `channel = "mcp"`.
- Version: every change bumps `version`; `PATCH`, append and commit need the current one (`IMPORT_PLAN_VERSION_CONFLICT`).
- Expiry: a plan untouched for 24 h reads as `expired` (status updated lazily and by the existing scheduler if one fits).
- Batches list: reads `import_plan` for committed plans and counts emission rows by status for each `upload_batch_id`; old batches without a plan show `channel: "bulk_upload"` (legacy).

## Part 2 (after IM1 merges)
- Swap the fake writer for IM1. `commit`:
  1. lock the plan row (`SELECT … FOR UPDATE`), check status draft + version, check no error rows unless `skip_rows_with_issues`;
  2. re-run `planRows` on ready rows (data may have changed since planning, e.g. a duplicate typed meanwhile); any new error → 409 with the rows;
  3. advisory lock per site (same as the AI importer) so two commits for one site serialise;
  4. `insertRows`, set status `committed`, store `upload_batch_id`, `idempotency_key` (a repeat with the same key returns the stored result);
  5. after commit, emit `onBatchCommitted` (IM0 §7).
- `activity_matches` with `save_mapping: true` write `emission_category_mapping` rows for the company, only for Superadmin and company Admin (D5); others keep the match in `import_plan_match`.

## Must not
- Delete emission rows. Cancel and expiry change plan status only. (FE/BE delete-call guards apply.)
- Trust totals from the request.

## Own tests
`ci/api/tests/im2-plans.test.cjs`: create, append, page, patch, skip, cancel, expiry, version conflict, row limits, 10-draft limit, duplicate row_ref, commit with and without issues, idempotent commit, two parallel commits → one batch, re-check catches a duplicate typed after planning, Superadmin needs company_id, forced DB failure mid-commit leaves no rows and the plan draft, company 2 token on company 1 plan → 404, User cannot plan another site, `mcp_enabled = false` → 403 for channel mcp, batches list counts.

## Audit rows
MCP-07, MCP-08, MCP-12, MCP-13, MCP-14, MCP-17, MCP-18, MCP-21, MCP-24.

## Acceptance
- A plan built from an app token commits and the batch shows in P07 Upload batches with the right counts.
- Migration runs twice cleanly; schema diff CI shows only additions.
