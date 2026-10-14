# IM0 · Contracts (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/imports/CLAUDE.md`. Every other IM module depends on it. One PR, small.
> Depends on: nothing. Blocks: IM1–IM12.

## Outcome
`01-contracts.md` exists as code, so seven lanes can build at once without guessing shapes.

## Build
- Copy this whole plan folder to `ESG-lite/docs/mcp-import/`.
- `src/imports/contracts.ts`: zod schemas and inferred types for `ImportRow`, `PlannedRow`, `RowIssue`, `ImportPlan`, `ImportContext`, `ActivityMatch`, request bodies of §4, tool inputs of §8. `ImportRow` uses `.strip()` and records stripped total-like keys so IM1 can raise `CLIENT_TOTAL_IGNORED`.
- `src/imports/errors.ts`: the API codes of §5 with status, `importError(res, code, details?)` helper; row issue codes as a const enum.
- `src/imports/limits.ts`: 2,000 rows per request, 20,000 per plan, 10 drafts per user, 24 h expiry, 200 page size. One place, imported everywhere.
- `src/imports/writer.ts`: the `EmissionWriter` and `WriterContext` interfaces (§6) and `onBatchCommitted` event type + a tiny in-process emitter (§7).
- `src/imports/router.ts`: empty Express router; mount `app.use("/imports", authenticate, importsRouter)` in `src/index.ts`. IM2 and IM3 add one line each.
- Add `zod` if not present (the MCP SDK needs it too); pin the version.
- Paste the ESG-lite block of `02-root-claude-snippets.md` into `ESG-lite/CLAUDE.md`.

## Own tests
`ci/unit/im0-contracts.test.cjs`: valid and invalid rows (each period kind, missing value with and without fields, stripped totals, long notes, bad dates), limits constants, every error code has a status.

## Audit rows
None of its own; makes MCP-09 (totals ignored) testable.

## Acceptance
- `npm run build` and unit tests pass; nothing else changes behaviour (`GET /imports` 404s inside an authenticated router).
- Other lanes can import the types on the day it merges.

## As built (IM0, 2026-10-12)
- `contracts.ts`: zod 4 (pinned exact in package.json). `ImportRowSchema` strips unknown keys; `parseImportRows(raw)` returns `{ rows, stripped, duplicate_row_refs }`, where `stripped` lists each row's dropped `TOTAL_LIKE_KEYS` so IM1 can add `CLIENT_TOTAL_IGNORED`. `ToolInputs` holds one zod object per MCP tool (IM6 passes them to the SDK as the input schema). `READ_ONLY_TOOLS` lists the read tools for the `readOnlyHint` annotation.
- `errors.ts`: `IMPORT_ERRORS` (code → status, default message), `ImportError` (throw from services), `importError(res, code, details?)` (send from controllers), `ROW_ISSUE_CODES` (code → severity). `CLIENT_INACTIVE` reuses the existing code from `services/clientStatus`.
- `limits.ts`: `IMPORT_LIMITS` constants (rows per request/plan, drafts per user, expiry, page sizes, text lengths).
- `writer.ts`: `EmissionWriter`, `WriterContext`, `BatchInfo`, `InsertResult`; `onBatchCommitted(listener)` returns an unsubscribe; `emitBatchCommitted(event)` awaits every listener and logs (never rethrows) failures; `clearBatchCommittedListeners()` for tests.
- `router.ts`: empty Express router mounted as `app.use("/imports", authenticate, importsRouter)`. IM2 and IM3 add one `importsRouter.use(...)` line each.
- Tests: `ci/unit/im0-contracts.test.cjs` (runs against `dist/` after `npm run build`).
- Review notes (2026-10-12): `RowChangeSchema.set` is `ImportRowShape.partial()`, so IM2 must re-validate the merged row with `ImportRowSchema` after applying a patch. `UploadBatchSummary.created_by` is `{ user_id, name }` and `IMPORT_VALIDATION` (400) is an extra code for bad bodies; both are additive to 01-contracts.md.

## Notifications (IM4, 2026-10-12)
Spec: `docs/mcp-import/backend/IM4-upload-notifications/CLAUDE.md`. Built in `src/services/uploadNotify.ts`.
- `registerUploadNotifyListener()` (called once at boot in `src/index.ts`) subscribes to `onBatchCommitted`. `notifyBatchCommitted(event)` does the work and never throws; it returns `{ notified, emailed }` (`emailed` = emails queued, not delivered). Idempotent per `upload_batch_id`: users already holding a notification for the batch are skipped, and the partial unique index `notification_upload_batch_user_uq` (`migrate:upload-notification-index`) makes two concurrent emits safe too (the loser's unique violation is swallowed). Admins count as the company's through their own `site_id` or any `user_sites` row.
- Recipients: Managers whose `user_sites` include any of the batch's `site_ids`, scoped to `event.company_id`; for a site with no manager, the company's Admins. The uploader is never included. One `UPLOAD_PENDING` notification per recipient per batch (bell + SSE), `link` `/data/approvals?view=batches&batch=<id>`, `meta` `{ upload_batch_id, rows, tco2e, site_ids, months, channel }`.
- Email: queued through `sendToQueue` as type `UPLOAD_PENDING` (`uploadPendingTemplate`, counts only). Preference key `email_uploads`; checked before queueing and again in `emailConsumer`.
- `NOTIFICATION_GROUPS.uploads` is the P13 filter (`GET /notifications?type=uploads`).
- `POST /internal/imports/batch-committed` (`src/routes/internalImports.routes.ts`) lets python_AI_service report a bulk-upload commit until IM11; it needs `X-Service-Key` = `AI_SERVICE_KEY` (route is off when the env var is unset). `ci/api/run.cjs` sets a CI-only key.
- Tests: `ci/unit/im4-upload-notify.test.cjs` (pure builder, wording, preference) and `ci/api/tests/im4-upload-notify.test.cjs` (recipients, tenant isolation, listener failure, service key). Audit row MCP-16.

## Smart Excel import contracts (XI0, 2026-10-14)
Plan: `docs/excel-import/` (00-plan, 01-contracts, modules/XI0–XI6). Approved by Shyam 2026-10-14; imports are **site-wise only** (one site chosen up front, one plan and batch per site).
- `src/imports/mapping.ts`: `MappingProposalSchema` (document_id, site_id, sheets; every sheet must carry the proposal's site_id), `SheetProposalSchema` (fingerprint sha256 hex, layout rows | months_as_columns, `site_column` informational, `category` fixed or from a column, `period` column | monthly_fixed | yearly | months_as_columns, `fields`, `activities`, `not_in_context`, `confidence`, `excluded`), `MappingProfileSchema` and `ListMappingProfilesQuerySchema` (XI3), `needsConfirmation(c)` (below `MAPPING_CONFIRM_BELOW` = 0.8). Unknown keys are stripped. The "every name must exist in the caller's context" rule is enforced by XI2 code, not by the schema.
- `contracts.ts`: `ImportRow.meta` (`{ source: profile | rules | llm, confidence }`, optional, stripped of other keys; the engine never reads it, it stays on `import_plan_row.input` for XI5 and XI3); `CreatePlanBodySchema.mapping` (unknown, optional; XI3 validates it with `MappingProposalSchema` for `bulk_upload` plans and stores it on `import_plan.mapping`); `RowIssueSeveritySchema` gains `info`.
- `errors.ts`: row codes `NOT_IN_CONTEXT` (error), `LOW_CONFIDENCE_MATCH` (warning), `PIVOT_EMPTY_CELL` (info). A sheet row naming a site other than the chosen one uses the existing `SITE_NOT_ALLOWED` (the plan's `SITE_OUT_OF_SCOPE` was not added: same meaning). API code `AI_IMPORT_DISABLED_FOR_CLIENT` (403).
- `limits.ts`: `MAPPING_*` (20 sheets, 15 sample rows, 200 distinct values, 8,000 prompt tokens, 1 model call per sheet, 10 propose calls per 10 minutes, confirm below 0.8, 300-char texts).
- Entities: `Company.ai_import_enabled` (default false, toggled through `PUT /admin/companies/:id`, validated as boolean), `ImportPlan.mapping` (jsonb, nullable). `migrate:ai-import` (`src/scripts/addAiImportColumns.ts`, two `ADD COLUMN IF NOT EXISTS`). `plans/scope.ts` `isAiImportEnabled(companyId)` reads as off until the column exists.
- Fixtures `ci/fixtures/xi0/*.json` are shared byte for byte with python_AI_service; tests `ci/unit/xi0-mapping.test.cjs` (im0's code count moved to 20).
