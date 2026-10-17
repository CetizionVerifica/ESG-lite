# 00 · Scope 3 plan

## 1. Goal and success test

ESGLite reports Scope 3 per GHG Protocol category (1–15). Each category is either calculated or excluded with a reason. For every calculated figure, the method, the data sources, the factor type and GWP set, and the data quality can be traced back to the row it came from. Contributors and managers move a month from entry to a locked, approved set of numbers through one guided flow.

**The plan is done (milestone S3-M4) when all of these hold:**
- The golden suite reproduces every worked example in the guidance that the app supports (`01-contracts.md` §9) to the kgCO₂e.
- A client set up with Midal-like data shows a Scope 3 table that covers all 15 categories with a status each.
- The GHG report PDF passes the Scope 3 Standard ch. 11 checklist (`modules/S3-13-reporting/CLAUDE.md` §Checklist).
- The audit probes S3-01… are green.

## 2. Non-negotiables (every module)

1. **One engine.** Every total is calculated by `ESG-lite/src/services/emissionWrite`, for typed entries, bulk upload, smart import and Claude/MCP alike. A new method is a new branch inside the engine (`01-contracts.md` §6), never a calculation in a controller, the FE or the AI service. The FE preview mirrors the engine and is never saved.
2. **Contracts first.** Enums, columns, endpoints, error codes and check ids live in `ESG-lite/src/scope3/contracts/` (copied from `01-contracts.md` by S3-0). Need a new one? Open an S3-0 follow-up PR first, then use it.
3. **Existing totals don't move silently.** The golden suite (`ci/golden`) must stay byte-identical unless the module's spec says which totals change and why. In that case the PR lists the old and new figure for every changed golden row.
4. **Backfill, never break.** New columns are nullable or defaulted, ship as idempotent `migrate:scope3-*` scripts registered in `scripts/migrate-all.cjs` (they run on container start, ESG-lite #126), and old rows keep working. Shyam: the live DB is staging data, so backfills there are fine (2026-10-14).
5. **Tenant isolation.** Every new endpoint gets a company-2-token-on-company-1-ids test. Company-level settings are keyed by `company_id`.
6. **Redesign rules in the FE.** Use `src/ui`, tokens only, no hex, no `isDark`. Pages work in the four themes and at 1280 / 1024 / 768 / 390 px. Loading, empty and error states are required. Copy uses "tCO₂e", sentence case, and the status words Pending / Approved / Rejected / Missing (plus Draft and Locked from S3-15).
7. **Guidance names.** Category names and numbers and method names are exactly as in `01-contracts.md` §1. User-facing method labels are the plain-language ones in the same table.
8. **No new GitHub issue work** and no changes outside the module's file list without saying so in the PR. Team PRs win on overlap: check open PRs by samidaire and PavithraCJ before starting.

## 3. Where the work lands

| Repo | New code | Existing code changed |
|---|---|---|
| ESG-lite | `src/scope3/` (contracts, taxonomy, boundary, suppliers, screening, baseYear, review checks), `src/scripts/migrateScope3*.ts` | `src/entities/{Category,EmissionFactor,Emission,Company}.ts`, `src/services/emissionWrite/*`, `src/reporting/ghg*.ts`, `src/controllers/{category,emissionFactor,emission,upload}.controller.ts`, `src/services/historicalImport.ts`, `src/imports/contracts.ts` (shared row shape) |
| ESG-lite_FE | `src/features/scope3/` (Boundary settings, Screening, Suppliers), `src/lib/scope3/` (labels, DQ helpers) | `src/features/{reference-data,emission-factors,add-data,my-month,approvals-ledger,ghg-report,targets-sbti,bulk-upload,capture-setup}` |
| python_AI_service | `app/scope3/` (factor sheet columns, EEIO sector suggestion) | `app/services/excel_parser.py` (keep WTT and gas columns), `app/services/category_matcher.py` (ghg_category hint) |

## 4. Modules, dependencies and file ownership

| Id | Depends on (merged) | Owns (only this module edits) | Touches (shared, keep-both on conflict) |
|---|---|---|---|
| S3-0 | — | `src/scope3/contracts/*`, `ci/golden/scope3/*`, `docs/scope3/*`, the root CLAUDE.md blocks | `package.json` scripts |
| S3-1 | S3-0 | `src/scope3/taxonomy/*`, `src/scope3/boundary/*`, `Category` columns, `company_scope3_category`, FE `features/scope3/boundary/*` | `reference-data` Categories tab, `scripts/migrate-all.cjs` |
| S3-2 | S3-0 | `EmissionFactor` columns, factor import/export, FE `emission-factors/*`, AI `excel_parser.py` sub-columns | `emissionWrite/compute.ts` snapshot |
| S3-3 | S3-0 | `Emission.method/dq/data_type/is_estimate`, `src/scope3/dq/*`, `ColumnConfig.method_options`, FE `src/lib/scope3/dq.ts`, add-data method picker | `emissionWrite/index.ts`, `imports/contracts.ts` |
| S3-4 | — | `emissionWrite/units.ts` null-unit rule, `historicalImport.ts`, `seedEmissionsFromExcel.ts`, scope validation in `category.controller.ts`, FE Findings S3 bug | `emissionWrite/resolve.ts` (warning only) |
| S3-5 | S3-2, S3-3 | `src/services/fxRate.ts`, `src/scope3/spend/*` (deflator, EEIO), `Emission.fx` | `emissionWrite/compute.ts` spend branch |
| S3-6 | S3-2, S3-3 | `src/scope3/suppliers/*`, `supplier` table, `Emission.supplier_id`, FE `features/scope3/suppliers/*` | `supplierRequest.controller.ts` (accept → corporate factor), `emissionWrite/compute.ts` supplier and hybrid branches |
| S3-7 | S3-2 | `emissionWrite/fera.ts` (split out of compute.ts), `Emission.scope3_sub` | `compute.ts` |
| S3-8 | S3-3 | transport and warehousing form configs, `src/scripts/seedScope3Transport.ts` | `calculationSpec.ts` (new units only) |
| S3-9 | S3-3 | travel and commuting configs, `src/scope3/commuting/*` (survey import, extrapolation) | `calculationSpec.ts` |
| S3-10 | S3-1, S3-3 | `src/scope3/soldProducts/*`, `product_sale` table | `Product` (read), PCF BOM read model |
| S3-11 | S3-1 | `Site.lease_role`, `src/scope3/assets/*`, `investment` table | — |
| S3-12 | S3-1, S3-5 | `src/scope3/screening/*`, FE `features/scope3/screening/*`, `Emission.proxy` | `company_scope3_category.status` (write via S3-1 service) |
| S3-13 | S3-1, S3-2, S3-3 | `src/reporting/ghg-scope3.ts`, PDF Scope 3 pages, FE `ghg-report` Scope 3 tab and Methodology section | `src/reporting/ghg.ts`, `ghg-data.ts`, FE `ghg-report/logic.ts` |
| S3-14 | S3-13 | `src/scope3/baseYear/*`, `company_base_year`, `recalculation_event`, FE Settings section, targets-sbti hook | `targets-sbti/logic.ts` |
| S3-15 | S3-0 (part 1), S3-3 (part 2) | `src/scope3/review/*` (checks, period lock), `Emission.status` adds `draft`, `period_lock` table, FE my-month and approvals-ledger changes from the canvas | `emission.controller.ts` approve/reject, `emissionWrite/index.ts` (status on insert) |
| S3-16 | S3-0 | `audit/harness/scope3-probes.cjs`, audit §14 rows, golden runner | — |

## 5. Waves

| Wave | Modules | Gate |
|---|---|---|
| 0 | S3-0, S3-4 | S3-0 merged → wave 1 starts. S3-4 is independent and can merge any time. |
| 1 | S3-1, S3-2, S3-3, S3-15·1, S3-16 draft | contracts merged |
| 2 | S3-5, S3-6, S3-7, S3-8, S3-15·2 | their deps in §4 |
| 3 | S3-9, S3-10, S3-11, S3-12, S3-13 | their deps |
| 4 | S3-14, S3-16 final | S3-13 |

## 6. Milestones

- **S3-M1 Foundations:** S3-0, S3-1, S3-2, S3-3 and S3-4 merged. Every new row carries its category number, method, factor type and DQ. The quick bugs are fixed.
- **S3-M2 Methods:** S3-5 to S3-9 and S3-15 merged. Supplier-specific, hybrid, spend and distance methods work. Cat 3 is split. Review checks and the month lock are live.
- **S3-M3 Coverage and report:** S3-10 to S3-13 merged. All 15 categories have a status, and the report meets the ch. 11 checklist.
- **S3-M4 Done:** S3-14 and S3-16 merged, and the §1 success test passes on staging.

## 7. Definition of done (every module)

1. Matches its module spec. Any deviation is listed in the PR body under "Deviations".
2. Contracts used, not redefined. `npm run lint:new` (FE), typecheck and unit tests are green. The API tests (`ci/api`) cover tenant isolation, role and the new error codes.
3. Golden totals are unchanged, or the changes are listed and match the spec.
4. Migrations are idempotent (run twice in CI) and registered in `migrate-all`. No data loss: `ci/check_delete_calls.py` is clean.
5. FE: the four themes, four widths, loading/empty/error states, keyboard access, and a Playwright smoke test for the main path.
6. The module's audit probe rows (S3-xx in `audit/e2e-workflow-audit.md` §14) are added or updated.
7. The spec is copied to the module's folder as `CLAUDE.md` in the first commit. The dashboard updates itself from the PR (see `tracking.md`).
8. The end-to-end data workflow test passes locally on the branch with `production` merged in (`bash ci/workflow/local.sh`, ESG-lite `ci/workflow/README.md`), the module's skipped workflow step is replaced by real checks, and the last PR body says "Workflow test: N passed, M skipped".

## 8. Working rules for parallel lanes

- **Claim before build.** Push a branch named `s3-<n>-<short-name>` from `production` and open a draft PR titled `[S3-<n> 1/m] <what it does>` whose first commit is the spec copy. Only then write code. The board picks up the claim, owner and status from that PR within the hour (`tracking.md`); nobody updates it by hand except for Blocked and notes.
- **One module per lane at a time.** Pick the next one only after the last PR is merged or handed to review.
- **Waiting lanes build the FE part against `01-contracts.md` with mocked responses.** The FE part merges after its backend part.
- **Review and merge** go through the project's existing hourly review and merge jobs (ledger row Safe at head, green CI, 15-min gap). Lanes never merge themselves.
- **Team members using Claude Code locally:** open the module file, tell Claude "Build module S3-n; read ESG-lite docs/scope3/ (README, 00-plan, 01-contracts, 04-decisions), the layer CLAUDE.md for this repo and docs/scope3/modules/S3-n-*/CLAUDE.md". The dashboard follows the PR (`tracking.md`).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Existing totals change when factors gain precision or rounding changes | D5 default keeps 2-dp tCO₂e storage and adds `total_kgco2e`. The golden suite guards it. |
| Category backfill maps a client's free-text category to the wrong number | S3-1 backfill writes a proposal. A Superadmin confirms per company on the Boundary page, and unconfirmed rows show "Unmapped" in reports. |
| WTT double count fix lowers Cat 4/9 totals | S3-7 only flags and splits. Any total that changes is listed in the PR and needs Shyam's OK (D6). |
| Draft status changes contributor behaviour | S3-15 behind a company switch `review_workflow_v2` (default off) until Shyam turns it on (D9). |
| EEIO data licence | D3 default USEEIO (public domain). EXIOBASE only if Shyam confirms the licence. |
| Many lanes edit `emissionWrite/compute.ts` | S3-0 splits compute.ts into `methods/*.ts` stubs so each method module owns its own file (§4). |
