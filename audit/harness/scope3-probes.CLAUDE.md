# S3-16 · Audit probes and golden regression

> Module spec. Lane L6. Copy to `/mnt/project-files/audit/harness/scope3-probes.CLAUDE.md` as the first change (the audit folder is shared and edited in place; no repo PR unless a probe needs a test hook, then `[S3-16 k/m] …`).
> Depends on (merged): S3-0 · Owns: `audit/harness/scope3-probes.cjs`, audit §14 rows, golden runner · Touches: —

## Job to be done
After every merge, the hourly audit tells Shyam and the lanes, row by row, which Scope 3 promises hold on the real stack (calculation, tenant isolation, roles, review flow, report) and which guidance examples ESGLite reproduces, without anyone reading code.

## Guidance (what the GHG Protocol expects)
- The plan's success test: every supported worked example reproduced to the kgCO₂e (`01-contracts.md` §9, `00-plan.md` §1). Examples sit at guidance L1754-2125 (Cat 1), L2577-2660 (Cat 3), L2939-3653 (Cat 4), L3777-3850 (Cat 5), L4258-4321 (Cat 6), L4454-4581 (Cat 7), L4702-4755 (Cat 8), L4950-4971 (Cat 9), L5096-5191 (Cat 10), L5348-5613 (Cat 11), L5691-5713 (Cat 12), L5754-5970 (Cat 13-14), L6258-6393 (Cat 15).
- Exclusions need reasons, methods and data sources must be described, GWP disclosed (L1120-1121, L1209-1210, L1276-1277): checked through the S3-13 checklist rows R1-R10.

## Today (evidence)
- Audit doc format: rows `# | Expected behaviour | Layers | Own test (module) | Audit check | Pre-audit | Result`, with ⏸ planned until built (`/mnt/project-files/audit/e2e-workflow-audit.md` §0 lines 17-31, §13 lines 521-540). Sections end at §13 and E2E-11.
- Probe harness pattern: `xi-probes.cjs` takes `<ESG-lite dir> <out.json>`, refuses a non-throwaway DB (`ci/lib/throwaway-db.cjs`), signs JWTs for fixture users (company 1: users 1, 2, 3, 5; company 2: user 6), records `{ids, title, expected, observed, status}` with pass / fail / error / na / manual (`harness/xi-probes.cjs:1-45, 85-92`), and is run by `run-audit.sh` after `ai-probes` (`run-audit.sh:73-74`).
- Golden: `ci/golden/run.cjs` locks today's 20 entry and 4 report cases; S3-0 adds `ci/golden/scope3/cases.json` (all `skip`, each with an owner) and an in-memory runner `ci/golden/scope3/run.cjs`.

## Build
### Backend (ESG-lite)
No repo code. The work is in the shared audit folder and runs against the ESG-lite stack. S3-0 follow-up: §4 gives S3-16 the "golden runner" while S3-0 owns `ci/golden/scope3/*`; this spec reads it as the live-stack runner in step 3 and leaves `ci/golden/scope3/run.cjs` with S3-0.
1. `audit/harness/scope3-probes.cjs` in the `xi-probes.cjs` shape (same args, ports 3996/8997, `assertThrowawayDb`, `record/pass/na/manual/probe`). Detect what the head has built: columns (`category.ghg_category`, `emission.method`, `emission.dq`, `emission.total_kgco2e`, `emission.fx`, `emission.supplier_id`, `emission.scope3_sub`, `emission.proxy`, `emission.checks`), tables (`company_scope3_category`, `supplier`, `investment`, `product_sale`, `company_base_year`, `period_lock`), routes (`GET /scope3/categories`, `/scope3/screening`, `/reports/ghg/scope3`, `/periods/lock`: 404 = not built). Anything missing → `na` naming the module.
2. Fixture: seed through SQL only what the API can't create (ghg numbers on fixture categories, the factor rows each example needs with `factor_type` and `gwp_set`, `review_workflow_v2` on for company 1 only). Clean up by ids at the end; re-runnable.
3. Live golden runner inside the same script (step `scope3-golden`): for every case marked `run` in `cases.json`, post the inputs through `POST /user/emissions` (or the plan path for survey and sold-products cases), approve, and compare Σ `total_kgco2e` with `expected_kgco2e` (S3-0 tolerance: 0.5 kg or 0.1 %). Also run `npm run test:scope3-golden` and `node ci/golden/run.cjs`, and write `audit/results/runs/<ts>-scope3-golden.json` with case → owner → skip/pass/fail.
4. `run-audit.sh`: one step after `xi-probes`, same summary line format (`s scope3-probes "… pass / … fail / … error / … n/a / … manual"`).
5. Audit doc `e2e-workflow-audit.md`: add "## 14. Scope 3 (GHG Protocol categories) — modules S3-0–S3-15" with the intro (plan link `/mnt/project-files/scope3/`, harness, extra setup) and these rows, Pre-audit ⏸ planned:
   - S3-01 golden: every case owned by a merged module is `run` and passes; `ci/golden` byte-identical unless the PR lists changes (all).
   - S3-02 taxonomy: every Scope 3 category has 1-15 or reads Unmapped; scope only the four values (S3-1, S3-4).
   - S3-03 boundary: 15 rows per company; exclusion without reason → `EXCLUSION_REASON_REQUIRED`; Manager PUT → 403 (S3-1, D12).
   - S3-04 factors: new factors carry type, GWP, geography, dataset; snapshot copies them; `FACTOR_TYPE_MISMATCH` warns only (S3-2).
   - S3-05 method and DQ on every new Scope 3 row from every channel; backfill done (S3-3).
   - S3-06 integrity: `UNIT_REQUIRED`; historical import through the engine; `total_kgco2e` on every row (S3-4).
   - S3-07 spend: `fx` stored and reproducible; `FX_RATE_FALLBACK`, `NO_DEFLATOR` (S3-5).
   - S3-08 suppliers: supplier factor boundary `SUPPLIER_FACTOR_BOUNDARY`; hybrid allocation (S3-6).
   - S3-09 Cat 3: `scope3_sub` on twins; `WTT_ALREADY_IN_FACTOR`; no total moved without the PR list (S3-7, D6).
   - S3-10 transport, S3-11 travel and commuting, S3-12 sold products, S3-13 leased assets, franchises, investments: each form computes its golden cases through the API (S3-8 to S3-11).
   - S3-14 screening: estimates never become rows; proxy rows Pending, secondary, with basis (S3-12).
   - S3-15 report: `/reports/ghg/scope3` and the PDF text contain checklist items R1-R10 or "Not tracked" (S3-13).
   - S3-16 base year: freeze, proposal at ≥ threshold, approve re-freezes, rows untouched (S3-14).
   - S3-17 review checks: every check id held and passed; "approve all ready" approves only ready rows (S3-15·1).
   - S3-18 draft and lock: drafts hidden from queues and reports; `PERIOD_LOCKED` on create, edit, delete, approve, reject, batch, import commit and MCP commit; unlock needs a reason (S3-15·2).
   - S3-19 tenant isolation: every `/scope3/*`, `/periods/*`, `/reports/ghg/scope3` endpoint with company 2's token on company 1 ids → 403/404 (all).
   - S3-20 role matrix: User, Manager, Admin, Superadmin per D12 and layer rule 3 (all).
   - S3-21 migrations: `migrate:all` twice clean with every `migrate:scope3-*` (all).
   - S3-22 channel parity: one Scope 3 row typed, bulk, smart import and MCP gives the same `total_kgco2e`, `method`, `dq` (S3-3 to S3-11).
   - S3-23 logs: no sheet text, supplier names, prices or survey refs in API or AI logs (layer rule 7).
   - S3-24 FE: Scope 3 routes in the route sweep, four themes, 390 px, no console errors (manual + `route-sweep.mjs`).
   - E2E-12 Scope 3 month cycle (manual on staging): contributor drafts, submits; manager approves all ready, fixes one held row, locks the month; Admin screens, sets status, reads the report and the base year.
6. Add §0.2 and §10/§11 lines for the harness and the S3 modules.

### Frontend (ESG-lite_FE)
None in the repo. S3-24 uses `audit/harness/route-sweep.mjs`: add `/settings/scope3`, `/settings/scope3/screening`, `/settings/scope3/sold-products`, `/settings/scope3/investments`, `/settings/scope3/commuting`, `/suppliers` and the close-month view to its route list.
### AI service
None (S3-23 reads the AI service log for cell text, using the existing `ai-probes.sh` log path).

## Golden cases
Turns none on itself. Verifies every `run` case through the live API and fails S3-01 when a merged module's case is still `skip`.

## Tests
- `node audit/harness/scope3-probes.cjs` on today's `production` head: every row `na` with the missing module named, zero `error`, exit 0. Run twice: same result, fixture cleaned.
- Each module's merge: the hourly audit fills its rows; a fail files `F-xx` in §9 against the owning module.

## Out of scope
Fixing what the probes find (the owning lane does). New CI jobs in the repos. Performance testing.

## Done when
- §14 rows S3-01 to S3-24 and E2E-12 are in the audit doc (draft, wave 1).
- `scope3-probes.cjs` and the live golden step run inside `run-audit.sh` and report `na` cleanly before modules land.
- At S3-M4 every row is pass (or manual with a dated result) and every §9 golden case runs green on staging.

## As built (2026-10-16, against ESG-lite `production` 6aa5bda)
- **What is built** is read from the stack, never from merge state: `information_schema` columns and tables, routes asked with a Superadmin token (404 = not built; `/reports/ghg/scope3` counts only when it answers JSON `rows`, because `/reports/ghg/:companyId` caught the path before S3-13), and the `migrate:*` scripts the build carries (S3-8 has no table or route of its own, so `migrate:scope3-transport` stands for it). Extra features beyond step 1: `emission_factors.factor_type` (S3-2), `fx_rate` (S3-5), `company.review_workflow_v2` (S3-15·2), `GET /scope3/commuting/sites` (S3-9), `GET /scope3/product-sales` (S3-10), `GET /scope3/investments` (S3-11), `GET /scope3/base-year` (S3-14).
- **Live golden (step 3):** every `run` case is posted as typed entries through `POST /user/emissions` on a probe category numbered with the case's GHG category, one probe factor per case factor (created through `POST /admin/emission-factors` with `factor_type`, `gwp_set` AR6, `geography` GLO, `dataset`), approved with `PUT /user/emissions/bulk-approve`, and Σ `total_kgco2e` compared with `expected_kgco2e` (0.5 kg or 0.1 %). The plan paths (commuting survey, sold-products plan, investments plan) are not used yet: each owner's API test covers them, and the typed path checks the same engine. Report cases (`report.json`) post each case's kg on an identity factor (D13) and read `GET /reports/ghg/scope3`.
- A `skip` case is `fail` for S3-01 when its owner is built and nothing its note "Runs once …" names is missing (ex-15.2: S3-11 built, waits for S3-5, so it stays skip).
- Results: `<out>` and, beside it, `<out with scope3-probes → scope3-golden>` (`audit/results/runs/<ts>-scope3-golden.json` under `run-audit.sh`), case → owner → engine (in-memory) → live result.
- **Fixture:** only what the API can't make is SQL (site assignment of the probe categories; one legacy unitless factor for S3-06). Everything is named `S3-16 probe …` and removed by id and by name at the start and end of each run; a row count of every table before and after turns any residue into an `error`. `review_workflow_v2` is not switched on yet: S3-18 stays `manual` when S3-15·2 lands, and the probe that learns the lock API must turn it on for company 1 only and back off at the end.
- **S3-21** runs `node scripts/migrate-all.cjs` twice after cleanup (its seeds touch every site with a Scope 3 category) and compares row counts and columns between the two passes. Before the rows, the probe runs migrate:all once, as production does on start.
- **S3-15** reads the report JSON for R2-R10 and the PDF text for the blocks; on a host without Chromium the PDF answers 500 and the probe reads the same Scope 3 blocks from `dist/reporting/ghg-scope3.js` and says so.
- **S3-20** expectations come from D12, layer rule 3 and each module spec: boundary read by all, written by Admin and Superadmin; category map confirm Superadmin only; commuting, product sales and investments read by Manager and above, investments and lease fields written by Admin and Superadmin; bulk approve by today's reviewers (Manager, Superadmin). Writes use invalid bodies, so an allowed role gets a 400 and nothing is written.
- **S3-23** fails when the API log of the run carries the probe's activity names; otherwise it stays `manual` for the AI service log.
- `pg` and `jsonwebtoken` resolve from the ESG-lite checkout under audit, so the audit folder needs no `node_modules`.

## Verification follow-up (2026-10-16, against `production` 563cffc: S3-3, S3-5 and S3-14 merged)
- **Background jobs off:** the harness sets `FX_JOB_DISABLED=true` and `SCOPE3_BASE_YEAR_JOB=off` for every server it starts. With S3-5 merged the daily FX job fetched rates from the network mid-run and filled `fx_rate` (2,033 → 11,982 rows), which the residue check turned into an `S3-00` error.
- **Golden scratch database:** `<DB_NAME>_golden` is made and removed through `createScratchDb` / `dropScratchDb` in `ci/lib/throwaway-db.cjs`, which run the throwaway checks and accept only a `<DB_NAME>_<suffix>` name. The harness carries no `DROP DATABASE` of its own (the data-safety CI job blocked it).
- **S3-07** now posts four typed spend rows (`@method: spend_based`) on a probe EEIO factor (USD, price year = the first stored US index): INR on a day with a probe-stored rate (no warning; `fx.rate` = 1 / stored rate, `as_of` = that day), INR with no rate that week (`FX_RATE_FALLBACK`), USD before the first index year (`NO_DEFLATOR`) and USD after the latest index (`DEFLATOR_FALLBACK_YEAR`, only once that year has started). Each stored total must equal the amount × stored `fx.rate` × index ratio × factor. The probe's rate is stored with source `S3-16 probe` and removed at the end.
- **S3-16** freezes company 1's base year on the golden year (only when company 1 has none; rationale `S3-16 probe`), checks the snapshot against the preview and Manager 403, adds an approved late row of about 20 %, expects exactly one proposal at or above 5 %, `RECALCULATION_REASON_REQUIRED` without a reason, Manager 403, and an Admin approval that re-freezes as version 2 with every emission row unchanged. The base year, its recalculation events and their audit rows are removed at the end.
- **S3-19** also asks with a company 2 Admin (created through `POST /admin/users`, removed at the end): the fixture has none, so Admin-only writes answered company 2's Manager and User 403 on role alone. Routes without a `company_id` get `?company_id=1`; the base-year preview, PUT and recalculation routes are in the list.
- **S3-03** reads company 1's Cat 8 boundary row (every column) before its two PUTs and puts it back exactly, audit rows included, also when a PUT throws; a PUT that should have been refused but wrote is a `fail` that says the row was restored. The residue check also compares that row, not only row counts.
- **S3-15** no longer assumes R6. R1 (KPI row) and R6 (base-year block, compared with `GET /scope3/base-year`: "Scope 3 base year <year>" or "No Scope 3 base year set") are only in the rendered PDF; when the host can't render it or has no `pdftotext`, the row is `manual` and names what was not read.

