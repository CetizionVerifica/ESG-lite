# src/kpi (ESG-lite) — KPI tracking backend layer

> Layer spec. Goes to `ESG-lite/src/kpi/CLAUDE.md`. Read it after the root CLAUDE.md, `docs/kpi/00-plan.md`, `01-contracts.md` and `04-decisions.md`, and before your module folder's CLAUDE.md.

## Shape
```
src/kpi/
  CLAUDE.md        this file
  contracts/       enums.ts errors.ts checks.ts schemas.ts (zod) labels.ts  (KPI-0)
  router.ts        mounted once at /kpi by KPI-0; one router.use per module
  guard.ts         requireKpiTracking, kpiScope (company, sites, topics)      (KPI-1)
  library/         definitions, frameworks, disclosures, mappings, seeds     (KPI-2)
  setup/           settings, frameworks, material topics, selection, owners (KPI-3)
  values/          period engine, units, aggregation, statuses, evidence     (KPI-4, KPI-7 entry endpoints)
  auto/            adapters: emissions, energy, production, waste            (KPI-5)
  formulas/        parser, dependency graph, recompute                       (KPI-6)
  review/          checks, approve/reject, period lock                       (KPI-8)
  targets/         targets and progress                                      (KPI-9)
  dashboard/       coverage per framework, gaps, trends                      (KPI-10)
  reports/         GRI index, BRSR tables, ESRS list; xlsx + pdf templates   (KPI-11)
  ai/              proxy to python app/kpi (suggest only)                    (KPI-12)
```
Entities: `src/entities/Kpi*.ts`. Migrations: `src/scripts/migrateKpi<Thing>.ts`, registered as `migrate:kpi-<thing>`. Seeds: `data/kpi/` (library CSV/JSON with source URLs). Tests: `ci/api/tests/kpi-<n>-*.test.cjs`, `ci/unit/kpi-*.test.cjs`, `ci/golden/kpi/`.

## Rules
1. **The switch first.**
   - Every route in `router.ts` runs `authenticate` then `requireKpiTracking`, which answers 403 `KPI_TRACKING_OFF` when the caller's company has `kpi_tracking_enabled = false`.
   - The exceptions are `GET /kpi/status`, which reports the state, and `/kpi/library/*`, which is Superadmin only.
   - A Superadmin acting for a client passes `company_id`, and the guard checks that company.
2. **Same access as emissions.**
   - Sites come from `accessibleSiteIds` (`src/utils/companyScope.ts`); topics from `kpi_topic_grant` (empty = all).
   - Contributors write only KPIs assigned to them (`kpi_assignment`) or, with no assignment, on their own site.
   - Managers review their sites. Admins set up and enter company-level values. Superadmin can do everything.
   - Another company's ids answer 404, never 403.
3. **Company scoping in SQL.** Every query filters by the caller's `company_id`; library rows (`company_id IS NULL`) are readable by all, writable by Superadmin only.
4. **No emission maths here.** Auto KPIs call the reporting functions (`computeGhgTables`, `computeScope3`, …) or read approved emission rows' stored totals. Don't change `src/reporting/*` or `src/services/emissionWrite/*` for KPIs; ask for a follow-up in their owners' plans instead.
5. **Units.**
   - Values are stored as entered (`value_numeric`, `unit`) and canonical (`value_canonical`).
   - Conversions use `src/services/emissionWrite/units.ts` (`getConversionFactor`, `canonicalUnit`), extended in `values/units.ts` for water, mass and count where needed.
   - Never guess a conversion: an unconvertible unit is `KPI_UNIT_NOT_ALLOWED`.
6. **Periods.**
   - A value's period comes from the KPI's frequency and the company's year type (`companyYearType`, FY start month 4 as `src/reporting/ghg-data.ts`).
   - Writes into a locked KPI period answer `KPI_PERIOD_LOCKED`. Locks are separate from the emissions `period_lock`.
7. **Status flow.**
   - Draft → Pending (submit) → Approved/Rejected (Manager). A contributor's edit of a Rejected value makes it a Draft.
   - Drafts are visible to their author and to Admins of the company, never in reviews, dashboards or reports.
   - Reports and exports read **approved** values only.
8. **Audit.**
   - Every write records an `audit_log` row (`entity_type` `kpi_*`) with old and new values and the reason when there is one.
   - Logs carry ids and codes, never values typed by users or document contents.
9. **Validation** with the zod schemas from `contracts/schemas.ts`. Errors use the `{code, message, details}` shape and the codes in `contracts/errors.ts`.
10. **Tests every module adds:** tenant isolation, role matrix, switch-off (`KPI_TRACKING_OFF`) for each endpoint, every new error code, migrations run twice, and its golden cases switched from `skip` to `run`.

## KPI-1 as built
- `company.kpi_tracking_enabled` (migrate:kpi-switch, `src/scripts/addKpiSwitch.ts`); set through `PUT /admin/companies/:id` (Superadmin; non-boolean → 400 `FIELD_INVALID`). A change writes `audit_log` (`kpi_setup`, `switch`, `{kpi_tracking_enabled:{old,new}}`); switching on sends `kpi_enabled` ("KPI tracking is ready: set it up", `/kpi/setup`) to the company's Admins (`src/kpi/switch.ts`).
- `src/kpi/guard.ts`: `kpiCompanyFor` (Superadmin passes `company_id` in query or body, else 400 `KPI_COMPANY_REQUIRED`; another company's id → 404), `requireKpiTracking` (sets `req.kpi = {companyId, userId, role, sites}`), `requireKpiSuperadmin`, `kpiStatus`.
- `src/kpi/http.ts`: `handle` (KpiError → `{code, message, details}`), `parse` (zod → `KPI_VALIDATION`).
- In `router.ts`, `/status` and the library routes come before `router.use(requireKpiTracking)`. Unknown paths under `/kpi` answer `KPI_TRACKING_OFF` when off.
- `setup_completed` is always false until KPI-3 (`kpiSetupCompleted`, TODO(KPI-3)).

## KPI-2 as built
- Tables `kpi_framework`, `kpi_definition`, `kpi_disclosure`, `kpi_disclosure_map` (migrate:kpi-library, `src/scripts/migrateKpiLibrary.ts`). Extra columns beyond 01-contracts §2: `edited_at` on all four (set by every Superadmin write; a re-seed never overwrites such a row), `kpi_disclosure.verified`, `kpi_framework.created_at`. KPI codes are unique per owner through the expression index `UQ_kpi_definition_owner_code` on `(COALESCE(company_id, 0), code)`.
- Seeds in `data/kpi/` (frameworks.json, definitions.json, disclosures/<FW>-<version>.json, mappings.json), loaded by migrate:kpi-library-seed (`src/scripts/seedKpiLibrary.ts` → `src/kpi/library/seed.ts`): refuses a seed with integrity problems, adds missing rows, refreshes rows with `edited_at` null, keeps edited rows, never deletes. 58 KPIs, 64 disclosures (GRI 26, BRSR 23, ESRS 15, all verified against the official sources on 2026-10-17), 128 mappings.
- Routes (`src/kpi/library/router.ts`): `/kpi/library/{frameworks,definitions,disclosures,mappings}` GET/POST/PUT `:id`, `GET /kpi/library/definitions/:id`, `GET /kpi/library/coverage` — Superadmin only (403 `KPI_FORBIDDEN`), before the switch. `GET /kpi/catalogue` behind it. Responses are wrapped: `{frameworks}`, `{definition}`, … No DELETE: retire with `active:false`.
- Formula check before KPI-6: `library/formulaRefs.ts` (allowed characters, known codes, no cycles). TODO(KPI-6): the real parser.
- The catalogue shows every active framework version until KPI-3 adds `company_framework` (TODO(KPI-3)).
