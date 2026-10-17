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
