# XI0 · Contracts (ESG-lite + python twin)

> Goes to `ESG-lite/src/imports/CLAUDE.md` (section "Smart import, XI0") and `python_AI_service/app/services/CLAUDE.md`. Depends on IM0. Blocks XI1–XI6. One small PR per repo.

## Outcome
`01-contracts.md` exists as code so three lanes can build at once.

## Build
- ESG-lite: `MappingProposalSchema`, `SheetProposalSchema`, `MappingProfileSchema` in `src/imports/contracts.ts`; `ImportRow.meta` (optional, stripped before the engine); new `ROW_ISSUE_CODES` and `AI_IMPORT_DISABLED_FOR_CLIENT`; limits in `limits.ts`; migration `migrate:ai-import` adding `company.ai_import_enabled boolean not null default false` and `import_plan.mapping jsonb null` (idempotent, in `migrate:all`). `isAiImportEnabled(companyId)` next to `isMcpEnabled` in `plans/scope.ts`.
- python: `app/services/mapping_contracts.py` pydantic models mirroring the above, with a test that round-trips the JSON fixtures shared with ESG-lite (`ci/fixtures/xi0/*.json` in both repos, identical files).
- Copy this plan folder to `ESG-lite/docs/excel-import/`.

## Own tests
`ci/unit/xi0-contracts.test.cjs` (valid/invalid proposals, context rule not enforced here, limits, codes have severities); python `ci/tests/test_mapping_contracts.py`.

## Acceptance
Build and tests pass in both repos; migration runs twice; nothing else changes behaviour.
