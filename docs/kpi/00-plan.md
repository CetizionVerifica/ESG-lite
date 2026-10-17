# 00 · KPI tracking plan

## 1. Goal and success test

A Superadmin switches **KPI tracking** on for a client with one toggle. From then on the client's existing people use it:
- **Users (contributors)** enter KPI values for their sites, next to their emission data.
- **Managers** review and close periods.
- **Admins** choose frameworks and KPIs.

Each KPI is entered once, mapped to the disclosures of GRI, BRSR and ESRS, and reported in each framework's shape.

**The plan is done (milestone KPI-M4) when all of these hold:**
1. With the switch **off** (the default), nothing about KPIs is visible or reachable for that client: no nav item, no route, every `/kpi` endpoint answers `KPI_TRACKING_OFF`. Every existing total, report and golden snapshot is byte-identical.
2. With the switch **on**, an Admin finishes setup in under 5 minutes:
   - pick GRI + BRSR + ESRS and the year type;
   - mark ESRS topics material;
   - accept the recommended KPIs;
   - assign owners per site.
3. A contributor's "My KPIs" list shows only what they owe, by due date. Each KPI is one plain-language question:
   - the unit is fixed;
   - last period's value is shown;
   - evidence is attached by dropping a file;
   - drafts save automatically;
   - it is submitted in one action.
4. KPIs that ESGLite already knows are filled automatically and marked "From your data", never typed: Scope 1/2/3, energy from fuel and electricity rows, production volume, waste quantities. They match the GHG report to the decimal.
5. Calculated KPIs (intensities, percentages) update when their inputs change and show their formula.
6. A Manager reviews KPI values with the same Ready / Needs attention flow as emissions, approves all ready values in one action, and closes the period.
7. The dashboard shows, per framework, how complete the year is and what's missing, with a link to fix each gap.
8. Exports produce:
   - a GRI content index (XLSX and PDF);
   - BRSR Section C principle tables in SEBI's layout (XLSX);
   - an ESRS datapoint list (XLSX), with approved values only;
   - each value traceable to its evidence and audit trail.
9. Targets per KPI show progress against a baseline.
10. Every new endpoint has a tenant-isolation test and a role test, and every new table ships as an idempotent `migrate:kpi-*` script.

## 2. Non-negotiables

1. **Same people, same access.** No new role and no separate login: KPI entry, review and setup use Superadmin / Admin / Manager / User with the existing site scope (`accessibleSiteIds`), the `user_categories`-style grant (KPI topics, see 01-contracts §2) and the existing guards.
2. **One switch decides.** `company.kpi_tracking_enabled` (default `false`, Superadmin only). Gated in the backend (a guard on the whole `/kpi` router, MCP and exports) and in the frontend (nav, routes, command palette, deep links). Turning it off hides KPIs and keeps the data.
3. **One value, many frameworks.** A KPI is defined once in the library; frameworks map to it. A value is never entered twice to satisfy two frameworks.
4. **Emissions stay in the engine.** GHG KPIs are read from `src/services/emissionWrite` results and the reporting layer (approved rows); KPI code never recomputes an emission total. Existing totals, reports and goldens never move because of KPI work.
5. **Contracts first.** Enums, error codes, framework codes and API shapes live only in `ESG-lite/src/kpi/contracts/` and `ESG-lite_FE/src/lib/kpi/`; change them there first (KPI-0 follow-up).
6. **Backfill, never break.** New tables and columns ship as idempotent `migrate:kpi-*` scripts (CI runs them twice); entities match (schema-diff clean); no destructive change.
7. **Standards text.** Store framework **codes**, our own **plain-language titles and help**, and a link to the official source. Do not paste copyrighted standard text (D7).
8. **Redesign rules in the FE.**
   - Shared components from `src/ui`, tokens only, and the four themes.
   - Loading, empty and error states.
   - Keyboard support, and widths of 1280 / 1024 / 768 / 390 px.
   - `05-ux.md` is binding.
9. **Suggest, never decide (AI).** The AI service suggests values and mappings with a source and a confidence; a person confirms. Nothing is approved automatically.

## 3. Where the work lands

| Repo | New code | Changed code |
|---|---|---|
| ESG-lite | `src/kpi/` (contracts, library, setup, values, auto, formulas, review, targets, reports, router), `src/entities/Kpi*.ts`, `src/scripts/migrateKpi*.ts`, `ci/api/tests/kpi-*.test.cjs`, `ci/unit/kpi-*.test.cjs`, `ci/golden/kpi/` | `Company.ts` (+switch), `company.controller.ts` updateCompany, `index.ts` (mount `/kpi`), `report` printer (new templates), `notificationService` (new kinds), `audit_log` entity types, `ci/workflow` (new steps) |
| ESG-lite_FE | `src/features/kpi/` (setup, my-kpis, review, dashboard, reports, library admin), `src/lib/kpi/` (contracts, labels, units, formulas preview), `src/test/msw/kpi.ts`, `e2e/kpi-*.spec.ts` | `clients/DetailPage.tsx` (+`KpiTrackingToggle`), `shell/nav.ts` + `navFor` + `commands.ts` (switch-aware items), `routeMap.ts`, `my-month` (a "KPIs due" card), `approvals-ledger` (a KPIs tab), `overview` (KPI tiles) |
| python_AI_service | `app/kpi/` (document → KPI value suggestions; custom KPI → library mapping suggestions) | none |

## 4. Modules, dependencies and file ownership

| Id | Depends on | Owns | Touches |
|---|---|---|---|
| KPI-0 | — | `src/kpi/contracts/*`, `src/lib/kpi/contracts.ts`, `src/test/msw/kpi.ts`, `docs/kpi/*`, empty `src/kpi/router.ts`, `src/features/kpi/routes.tsx` | root CLAUDE.md files |
| KPI-1 | KPI-0 | `company.kpi_tracking_enabled`, `requireKpiTracking` guard, `lib/kpi/switch.ts`, `KpiTrackingToggle` | `Company.ts`, `company.controller.ts`, `clients/DetailPage.tsx`, `shell/nav.ts`, `commands.ts`, `routeMap.ts` |
| KPI-2 | KPI-0 | `kpi_definition`, `kpi_framework`, `kpi_disclosure`, `kpi_disclosure_map`, seeds `data/kpi/*`, `src/kpi/library/*`, FE `kpi/library` (Superadmin) | — |
| KPI-3 | KPI-1, KPI-2 | `company_kpi_settings`, `company_framework`, `company_material_topic`, `company_kpi`, `kpi_assignment`, `src/kpi/setup/*`, FE `kpi/setup` | — |
| KPI-4 | KPI-0 | `kpi_value`, `kpi_value_evidence`, `kpi_period_lock`, `src/kpi/values/*` (period engine, units, aggregation, statuses, audit) | `audit_log` types |
| KPI-5 | KPI-4, KPI-2 | `src/kpi/auto/*` (adapters: emissions, energy, production, waste) | reads `src/reporting/ghg-data.ts`, `ghg-scope3.ts` (no edits) |
| KPI-6 | KPI-4, KPI-2 | `src/kpi/formulas/*` (parser, dependency graph, recompute), FE `lib/kpi/formula.ts` | — |
| KPI-7 | KPI-3, KPI-4 (FE can start on mocks) | FE `kpi/my-kpis`, `src/kpi/values/entry*` endpoints, Excel template upload | `my-month` (KPIs due card) |
| KPI-8 | KPI-4, KPI-7 | `src/kpi/review/*` (checks, approve, lock), FE `kpi/review` | `approvals-ledger` (KPIs tab), `notificationService` |
| KPI-9 | KPI-4 | `kpi_target`, `src/kpi/targets/*`, FE `kpi/targets` | — |
| KPI-10 | KPI-3, KPI-4, KPI-9 | `src/kpi/dashboard/*`, FE `kpi/dashboard` | `overview` (KPI tiles) |
| KPI-11 | KPI-2, KPI-4, KPI-5, KPI-6 | `src/kpi/reports/*` (GRI index, BRSR tables, ESRS list), FE `kpi/reports` | report printer (new templates only) |
| KPI-12 | KPI-4, KPI-7 | python `app/kpi/*`, `src/kpi/ai/*` proxy, FE suggestion chips in `kpi/my-kpis` | — |
| KPI-13 | KPI-0 (draft), all (final) | `ci/golden/kpi/*`, `ci/workflow` KPI steps, `audit/harness/kpi-probes.cjs` | — |

## 5. Waves

| Wave | Modules | Needs merged |
|---|---|---|
| 0 | KPI-0 | — |
| 1 | KPI-1, KPI-2, KPI-4, KPI-13 draft | KPI-0 |
| 2 | KPI-3, KPI-5, KPI-6, KPI-7 (FE on mocks), KPI-9 | KPI-1, KPI-2, KPI-4 |
| 3 | KPI-7 (wire up), KPI-8, KPI-10 | KPI-3, KPI-5, KPI-6 |
| 4 | KPI-11, KPI-12, KPI-13 final | KPI-8, KPI-10 |

## 6. Milestones

- **KPI-M1, switch and library:**
  - KPI-0, KPI-1 and KPI-2 are merged.
  - A Superadmin can switch a client on.
  - The library holds the seeded GRI, BRSR and ESRS mappings.
  - Nothing is visible to clients that are off.
- **KPI-M2, collect:** KPI-3, KPI-4, KPI-5, KPI-6 and KPI-7 are merged, so a client can set up and enter a year.
- **KPI-M3, review and see:** KPI-8, KPI-9 and KPI-10 are merged, so a Manager approves and closes, and the dashboard shows coverage.
- **KPI-M4, report:** KPI-11, KPI-12 and KPI-13 are merged, so framework exports, AI suggestions and the full verification are in. This is the §1 success test.

## 7. Definition of done (every module)

1. Its spec's "Done when" holds, and the module spec copy is updated with an "As built" section (files, deviations, decisions).
2. **Backend checks:**
   - tenant-isolation and role tests for every new endpoint;
   - a `KPI_TRACKING_OFF` test for every new endpoint;
   - migrations run twice;
   - schema-diff clean;
   - the full lane green: build, unit, both goldens unchanged, API, workflow.
3. **FE checks:**
   - the redesign definition of done (four themes, four widths, states, keyboard);
   - `05-ux.md` copy rules;
   - unit tests for logic;
   - a Playwright check of the main path and of the switch-off path.
4. The last PR body has "Workflow test: N passed, M skipped" and `Completes: KPI-<n>`.

## 8. Working rules for parallel lanes

- Branch from `production`. Open the first PR as a draft at once; the draft is the claim.
- Shared files are append-only blocks with a `// KPI-n` comment:
  - `Company.ts`;
  - `package.json` `migrate:*` lines (before `migrate:scope3-row-quality-backfill`);
  - `src/kpi/router.ts` (one `router.use` per module);
  - `src/features/kpi/routes.tsx` (one page entry per module);
  - `shell/nav.ts`.
- The FE of a module merges after its backend. While waiting, build against `01-contracts.md` with MSW mocks (`src/test/msw/kpi.ts`).
- A contract change is a KPI-0 follow-up PR first, then the modules use it.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Framework versions change: ESRS simplification (EFRAG 2025–26), BRSR updates, GRI topic revisions such as GRI 101 Biodiversity 2024 | The library is versioned per framework (`kpi_framework.version`). Mappings belong to a version, and a client picks the version it reports on (D6). |
| Definitions differ across frameworks (e.g. energy in GJ for BRSR, MWh for ESRS; "water consumption" boundaries) | Each mapping carries `fit` (exact / partial / derived) and a conversion. Exports convert from the KPI's canonical unit and note partial fits. |
| Scope creep into a full double-materiality assessment tool | KPI-3 keeps a light topic-level materiality: material yes/no plus a reason per ESRS topic. A full DMA is out of scope (D13). |
| Users overwhelmed by hundreds of datapoints | Recommended defaults. Only material and selected KPIs are shown. One question at a time. Progress per framework (`05-ux.md`). |
| Auto KPIs disagreeing with reports | KPI-5 reads the same approved-row functions as the GHG report. A golden case compares them to the decimal. |
| Copyright on standards text | Codes, our own wording and links only (D7). |
