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
