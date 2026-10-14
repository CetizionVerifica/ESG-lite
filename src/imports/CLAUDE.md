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
- `contracts.ts`: `ImportRow.meta` (`{ source: profile | rules | llm, confidence }`, optional, stripped of other keys; it stays on `import_plan_row.input` for XI5 and XI3, and the engine reads it only to raise `LOW_CONFIDENCE_MATCH`, below); `CreatePlanBodySchema.mapping` (unknown, optional; the plans controller parses the body with `CreatePlanWithMappingBodySchema` from `mapping.ts`, so an invalid proposal is a 400 before the service runs; XI3 stores it on `import_plan.mapping` for `bulk_upload` plans); `RowIssueSeveritySchema` gains `info`.
- `errors.ts`: row codes `NOT_IN_CONTEXT` (error), `LOW_CONFIDENCE_MATCH` (warning; raised by `emissionWrite` on every row whose `meta.source` is `llm` with `meta.confidence` below 0.8, so a match the uploader confirmed still shows to the approver, Shyam 2026-10-14; the row stays ready), `PIVOT_EMPTY_CELL` (info). A sheet row naming a site other than the chosen one uses the existing `SITE_NOT_ALLOWED` (the plan's `SITE_OUT_OF_SCOPE` was not added: same meaning). API code `AI_IMPORT_DISABLED_FOR_CLIENT` (403).
- `limits.ts`: `MAPPING_*` (20 sheets, 15 sample rows, 200 distinct values, 8,000 prompt tokens, 1 model call per sheet, 10 propose calls per 10 minutes, confirm below 0.8, 300-char texts).
- Entities: `Company.ai_import_enabled` (default false, toggled through `PUT /admin/companies/:id`, validated as boolean), `ImportPlan.mapping` (jsonb, nullable). `migrate:ai-import` (`src/scripts/addAiImportColumns.ts`, two `ADD COLUMN IF NOT EXISTS`). `plans/scope.ts` `isAiImportEnabled(companyId)` reads as off until the column exists.
- Fixtures `ci/fixtures/xi0/*.json` are shared byte for byte with python_AI_service; both repos' tests pin their sha256, so change a fixture in both repos and update both pins. Tests `ci/unit/xi0-mapping.test.cjs` (im0's code count moved to 20).

## Mapping memory (XI3, 2026-10-14)
`src/imports/profiles/` (spec and as-built notes in its CLAUDE.md): table `import_mapping_profile` (`migrate:mapping-profiles`), `GET /imports/mapping-profiles`, `DELETE /imports/mapping-profiles/:id`, learning on `onBatchCommitted` for bulk_upload plans that carried a confirmed proposal. `src/imports/router.ts` gained one line; `src/index.ts` registers the listener next to IM4's.

## Review polish, backend half (XI5, 2026-10-14)
Spec: `docs/excel-import/modules/XI5-review-polish/CLAUDE.md`. FE half is ESG-lite_FE's.
- `GET /user/emissions?batchId=<id>&attention=1` (emission.controller `getEmissions`): only the batch's rows that need attention: the plan row they came from has `input.meta.confidence` below `MAPPING_CONFIRM_BELOW` (0.8), a `LOW_CONFIDENCE_MATCH` issue, or `input.meta.edited`, or the emission was edited after commit (`extra_data.import.edited`). Joined through `import_plan.upload_batch_id` and `import_plan_row.row_ref = emission.extra_data->'import'->>'row_ref'` (what IM1 stores), so no new column was needed; rows of batches without a plan, and Claude/API rows without `meta`, never need attention. The paged summary gains `attention` (the spec's and the FE's name) and the same number as `attention_count` whenever `batchId` is given (counted before the attention filter, so the chip can show "Needs attention (n)"); without `batchId` the flag is ignored and the summary keeps its old shape. Site scoping is unchanged.
- `ImportRow.meta.edited` (contracts.ts, optional boolean): `PATCH /imports/plans` sets it on a row whose `set` was applied, and on every row a corrected `activity_matches` entry applies to (same site, category and normalised wording), when the row carries `meta` (smart-import rows do; Claude and API rows carry no `meta` and are not flagged: adding provenance to them is a contract change for both repos).
- Commit (`emissionWrite.insertRows`) copies a row's `meta` as `extra_data.import.meta = { source, confidence }` (smart-import rows only; never `edited`) for the Review rows drawer's "Matched by".
- Edits after commit (`PUT /user/emissions/:id`, `PUT /user/emissions/manager-edit/:id`): `keepImportProvenance` keeps `extra_data.import` (channel, row_ref) whatever `extra_data` the edit sends, and records `edited: true`, `edited_by`. The row stays joined to its plan row and reads as needing attention.
- Decision 6 (uploader may approve their own upload): the self-review block of `scope.middleware` (audit F-01/F-02, "nobody reviews their own entries") lets the uploader APPROVE (not reject) their own rows only when the row is in a bulk-upload batch (plan channel `bulk_upload`, or a batch with no plan) and nobody edited it after commit (`extra_data.import.edited`). Typed entries, Claude and API batches, edited rows and rejections keep the block. The approve routes pass `"approve"` to `guardEmissionReview`, `guardEmissionIdsReview` and `guardBatch`. `audit.middleware` writes the audit reason "Approved by the uploader" (plus ". <comment>" when one was given) and `changed_fields.approved_by_uploader = true` on an approve of an uploaded row (`upload_batch_id` set) whose approver is the row's creator; a Superadmin approving their own typed entry gets no such note.  The plan's premise that typed entries already allowed this was wrong; the narrowing to uploaded rows is Claude's default, put to Shyam in the lane thread.
- Index `IDX_1980e1c19b18e5d90431b69500` on `import_plan.upload_batch_id` (`migrate:import-plans`, runs on container start) for the attention join and the uploader rule.
- Tests: `ci/api/tests/xi5-attention.test.cjs` (filter, summary count, tenant and site scoping, uploader approval per row and per batch, typed entries, API batches, edited rows and uploader rejections refused, post-commit edits keep provenance and need attention, `meta.edited` on patch and on match corrections). Audit row XI-08.
