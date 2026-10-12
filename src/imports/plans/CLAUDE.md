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

## As built (part 1)

Files: `src/entities/ImportPlan.ts` (import_plan, import_plan_row, import_plan_match), `src/scripts/createImportPlanTables.ts` (`migrate:import-plans`), `src/imports/plans/` (`router.ts`, `controller.ts`, `service.ts`, `scope.ts`, `fakeWriter.ts`, `writerRegistry.ts`, `apiError.ts`), `ci/api/tests/im2-plans.test.cjs`. One line each in `src/imports/router.ts`, `src/config/data-source.ts` (entity registration) and `package.json`.

- **Writer wiring.** `writerRegistry.ts`: part 2 calls `setEmissionWriter(IM1 writer)` at startup. Until then the fake writer is used only when `IMPORT_FAKE_WRITER=true` or `CI_THROWAWAY_DB=true`; anywhere else the plans endpoints answer `503 IMPORT_ENGINE_NOT_READY` (a temporary code, not in contracts §5; part 2 removes it).
- **Fake writer** (`fakeWriter.ts`): scope, value and period checks from the context; a name containing "unknown" is `UNKNOWN_ACTIVITY`; a plan match wins; total = value / 1000 tCO₂e; `DUPLICATE_IN_PLAN` warning; `DUPLICATE_EXISTING` when a saved row has the same site, category, month and `activity_data.activity_name`; `insertRows` writes plain pending emission rows and throws on notes `__FAIL_INSERT__` (MCP-24 test).
- **Scope** (`scope.ts`): Superadmin names the client (`IMPORT_COMPANY_REQUIRED`); Admin every site of their client; Manager and User their sites, Users with grants only those categories. A `company_id` that is not the caller's own is `IMPORT_FORBIDDEN`, never swapped. `company.mcp_enabled` (IM5's column) reads as off until its migration exists.
- **Visibility.** A plan is readable by its creator and any Superadmin; everyone else, other clients included, gets 404. On plan-id routes a Superadmin needs no `company_id`: the context is built from the plan's client.
- **Versioning.** Every append, patch and re-check bumps `version`; a plan is created at version 1. The whole plan is re-planned on each change (plan matches included), so `counts`, `totals` and `issues_summary` are always current.
- **Commit.** One transaction: `SELECT … FOR UPDATE` on the plan, idempotency check (same key → stored result; a key used by another plan → 409), draft + version check, `IMPORT_PLAN_HAS_ISSUES` unless `skip_rows_with_issues`, `pg_advisory_xact_lock(site_id, category_id)` for each pair in sorted order (same lock as the AI importer), re-run `planRows` on the ready rows (new issues are written back, the version bumps and the answer is `409 IMPORT_PLAN_VERSION_CONFLICT` with those rows), `insertRows`, plan → committed with `upload_batch_id`, `idempotency_key`, `committed`. `onBatchCommitted` fires after the transaction. Skipped rows and issue rows stay as they are on the plan.
- **CLIENT_TOTAL_IGNORED.** The controller notes which raw rows carried `total_emission`, `total_tco2e`, `factor`, `factor_value`, `emission_factor` or `unit` before zod strips them; those rows get the warning after planning.
- **Batches list** (`GET /imports/batches`): emission rows grouped by `upload_batch_id` on the caller's sites (Superadmin: the named client's sites), joined to `import_plan` for `channel`, `source_name` and `plan_id`; batches with no plan show `channel: "bulk_upload"`. `status` is pending (any pending row), approved (none pending, some approved) or rejected (all rejected). 50 per page.
- **Expiry.** `expires_at` is set 24 h after every change; a draft past it reads as `expired` the next time it is loaded (status written back). No scheduler.
- Part 2 adds: the IM1 writer, `activity_matches[].save_mapping` → `emission_category_mapping` (Superadmin and company Admin only, D5).
- **Contract shapes.** Plan reads return `ImportPlanWithRows` (`rows`, `page`, `page_size`, `total_rows`); query strings are parsed with `GetPlanQuerySchema` / `ListBatchesQuerySchema` (a bad `code` or an oversized `page_size` is `400 IMPORT_VALIDATION`). `created_at` on a batch is ISO. Batch `status=mixed` means no pending rows and neither all approved nor all rejected.
- **P07 source chip (MCP-14).** `GET /user/emissions/batches` (emission.controller `getEmissionBatches`) also returns `channel` per row: the import plan's channel (`mcp`, `bulk_upload`, `api`) via a correlated lookup on `upload_batch_id`, `null` for batches made without a plan. Asked for by IM10; one addition to that shared controller, scoping unchanged.
