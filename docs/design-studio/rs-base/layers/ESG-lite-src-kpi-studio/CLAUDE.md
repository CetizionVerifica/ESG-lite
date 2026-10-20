# src/kpi/studio (ESG-lite): report studio backend layer

> **Layer spec.** Goes to `ESG-lite/src/kpi/studio/CLAUDE.md`.
> **Read it** after the root CLAUDE.md, `docs/report-studio/00-plan.md`, `01-contracts.md`, `04-decisions.md` and the KPI layer `src/kpi/CLAUDE.md`, and before your module's CLAUDE.md.

## Shape
```
src/kpi/studio/
  CLAUDE.md        this file
  contracts/       enums.ts schema.ts (zod ReportDoc) errors.ts checks.ts ai.ts       (RS-0)
  router.ts        mounted by src/kpi/router.ts after esgRouter; requireReportStudio; one router.use per module (RS-0)
  guard.ts         requireReportStudio, studioScope (company, sites, role R/M)        (RS-0)
  bindings/        resolve.ts tokens.ts derived.ts hash.ts materiality.ts            (RS-2)
  designs/         designs.ts layouts.ts seed.ts saveAs.ts (RS-10)                  (RS-3)
  assets/          upload.ts (R2, sanitise svg, downscale) list.ts                   (RS-3)
  docs/            crud.ts autosave.ts readiness.ts build.ts (auto-build) versions.ts (RS-4)
  jobs/            enqueue.ts worker.ts preview.ts storage.ts                         (RS-5)
  ai/              actions/*.ts prompts/*.md schemas.ts guard.ts budget.ts client.ts (RS-8)
  checks/          run.ts content.ts layout.ts numbers.ts gate.ts                     (RS-9)
  review/          status.ts comments.ts drift.ts                                     (RS-10)
```
- **Entities:** `src/entities/Report*.ts`.
- **Migrations:** `src/scripts/migrateRs<Thing>.ts` → `migrate:rs-<thing>`.
- **Seeds:** `data/report-studio/` (designs, layouts, icons).
- **Tests:** `ci/api/tests/rs-<n>-*.test.cjs`, `ci/unit/rs-*.test.cjs`, `ci/golden/rs/`.

## Rules
1. **Switches and roles first.**
   - Every route runs `authenticate` → `requireKpiTracking` → `requireReportStudio` (403 `RS_STUDIO_OFF`), except `GET /status`.
   - Roles follow `01-contracts` §4 (R/M). Users get `RS_ROLE`.
   - A Superadmin acting for a client passes `company_id`.
   - Another company's ids answer 404 (`RS_DOC_NOT_FOUND`).
2. **Site scope.** `meta.sites='all'` needs the caller to reach every company site (`accessibleSiteIds`). Otherwise the doc's sites must be a subset of the caller's sites (`RS_SITES_SCOPE`).
3. **Company scoping in SQL.** Every query filters by `company_id`. System designs and layouts (`company_id IS NULL`) are readable by all and writable only by seeds and migrations.
4. **Numbers only through `bindings/`.**
   - Resolve from **approved** KPI values via `src/kpi/values/yearly.ts` (never counting missing as 0), targets via `targets/progress.ts`, headlines via `esg/headlines.ts`, and framework rows and omissions via `reports/model.ts`.
   - Units convert via `src/kpi/values/units.ts`. Derived figures (change, share, progress, intensity) live in `bindings/derived.ts` and nowhere else.
   - Don't change KPI modules for the studio. Ask for an RS-0 follow-up or a KPI follow-up instead.
5. **The doc is validated on every write.** Use `contracts/schema.ts`: `RS_DOC_INVALID` with zod issues, `RS_DOC_TOO_LARGE` over 2 MB. PATCH needs the current `rev` (`RS_VERSION_CONFLICT`). Finals are read-only (`RS_FINAL_IMMUTABLE`).
6. **Rendering only via the renderer and the queue.**
   - HTML comes from `src/reporting/studio/` (`html.ts`). PDFs are only made by `jobs/worker.ts` through the `report.render` queue, never inside a request.
   - The worker uses the existing Playwright printer settings plus `tagged` and `outline`, with a 120 s time limit and concurrency 1.
7. **Storage.**
   - PDFs and assets go to R2 (`src/config/r2.ts`) under `reports/<companyId>/…` and `report-assets/<companyId>/…`.
   - Downloads are streamed after the role check or given as a short-lived signed URL (≤ 5 min).
   - Never put R2 keys in client-visible URLs without a signature.
8. **AI** (RS-8):
   - Only through `ai/client.ts`, which wraps the shared OpenRouter helper.
   - Every call is budgeted (`ai/budget.ts`, R8) and logged in `report_ai_call`.
   - Outputs pass `ai/guard.ts` (`01-contracts` §8).
   - Prompts are versioned files in `ai/prompts/`.
   - Prompts contain resolved values and company context only: no user emails, no evidence file contents.
9. **Audit.** Create, delete, final, approve, reopen and restore write an `audit_log` row (`entity_type` `report_doc`) with ids and version numbers, never document text.
10. **Tests every module adds:** tenant isolation, the role matrix, switch-off (both switches) for each endpoint, every new error code, migrations run twice, and its golden cases switched from `skip` to `run`.
