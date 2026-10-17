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
- `setup_completed` reads `company_kpi_settings.setup_completed_at` (`kpiSetupCompleted`, since KPI-3).

## KPI-2 as built
- Tables `kpi_framework`, `kpi_definition`, `kpi_disclosure`, `kpi_disclosure_map` (migrate:kpi-library, `src/scripts/migrateKpiLibrary.ts`). Extra columns beyond 01-contracts §2: `edited_at` on all four (set by every Superadmin write; a re-seed never overwrites such a row), `kpi_disclosure.verified`, `kpi_framework.created_at`. KPI codes are unique per owner through the expression index `UQ_kpi_definition_owner_code` on `(COALESCE(company_id, 0), code)`.
- Seeds in `data/kpi/` (frameworks.json, definitions.json, disclosures/<FW>-<version>.json, mappings.json), loaded by migrate:kpi-library-seed (`src/scripts/seedKpiLibrary.ts` → `src/kpi/library/seed.ts`): refuses a seed with integrity problems, adds missing rows, refreshes rows with `edited_at` null, keeps edited rows, never deletes. 58 KPIs, 64 disclosures (GRI 26, BRSR 23, ESRS 15, all verified against the official sources on 2026-10-17), 128 mappings.
- Routes (`src/kpi/library/router.ts`): `/kpi/library/{frameworks,definitions,disclosures,mappings}` GET/POST/PUT `:id`, `GET /kpi/library/definitions/:id`, `GET /kpi/library/coverage` — Superadmin only (403 `KPI_FORBIDDEN`), before the switch. `GET /kpi/catalogue` behind it. Responses are wrapped: `{frameworks}`, `{definition}`, … No DELETE: retire with `active:false`.
- Formula checks: KPI-6's parser and graph since KPI-6 (`checkDefinition` → `formulas/graph.ts` `definitionProblems`); `library/formulaRefs.ts` is a thin wrapper kept for the seed's integrity check.
- The catalogue shows the company's enabled versions since KPI-3 (every active one until it enables one).

## KPI-4 as built
- Tables `kpi_value`, `kpi_value_evidence`, `kpi_period_lock` (migrate:kpi-values). Unique keys that treat null as a value are expression indexes (`UQ_kpi_value_company_site_kpi_period` on COALESCE(site_id, 0); `UQ_kpi_period_lock_company_site_year_period`), mirrored in `ci/api/fixture.sql`. Additions to 01-contracts §2: `kpi_value_evidence.public_id` (stored file id, for removal), `kpi_period_lock.year_type` (how `year` reads; `period` is a calendar month 1–12 or null for the whole year).
- `values/period.ts` (pure): CY / FY (FY 2026 = Apr 2025–Mar 2026), monthly / quarterly / annual, labels (`Sep 2026`, `Q1 FY2025-26`, `FY2025-26`), `dueDate` (due_day of the next month, clamped).
- `values/units.ts`: spellings through the engine's `canonicalUnit`, then a KPI registry by dimension and family (energy, mass, CO2e, volume incl. kL/ML, count, days, %, injury rates, time, same-currency scales). Cross-family → `KPI_UNIT_NOT_ALLOWED`. Factors are exact (the engine's table rounds GJ↔kWh).
- `values/aggregate.ts` (pure): sum / average / max / latest / weighted_average / none; missing ≠ 0 (`missing`, `complete`, `missing_periods`, `missing_sites`); `WEIGHT_KPI` (LTIFR by HOURS_WORKED).
- `values/service.ts`: `upsertDrafts` (per-item transaction and result), `submit`, `listValues`. The KPI-3 hooks (`isKpiSelected`, `companyKpiYearType`, `companyKpiFrequency`, `assertCanWrite`, `needsEvidence`) read the setup since KPI-3 (see below).
- Writes hold `pg_advisory_xact_lock_shared(KPI_LOCK_CLASS = 4150, company)`; KPI-8's lock takes it exclusively.
- Pending and approved values aren't editable (`KPI_NOT_DRAFT`); someone else's draft answers `KPI_NOT_DRAFT` on save and 404 elsewhere. Approved values: only Manager/Admin/Superadmin change evidence; a removal is audited as `evidence_removed_after_approval`.
- Audit actions on `kpi_value`: create, update, reopen (rejected → draft), submit, evidence_added, evidence_removed, evidence_removed_after_approval.

## KPI-3 as built
- Tables `company_kpi_settings` (pk company_id; + `updated_by`, `created_at`, `updated_at`), `company_framework` (+ `framework_code`, so `UQ_company_framework_company_code` holds "one version per framework code"), `company_material_topic`, `company_kpi` (+ `updated_by`, `updated_at`), `kpi_assignment` (+ `created_at`, `updated_at`; unique `UQ_kpi_assignment_company_kpi_site` on (company, KPI, COALESCE(site, 0)), an expression index mirrored in `ci/api/fixture.sql`), `kpi_topic_grant` (migrate:kpi-setup, `src/scripts/migrateKpiSetup.ts`).
- `setup/settings.ts`: the reads other modules use (`kpiSettings` with defaults: year type prefilled from the company's emission rows, else CY; `setupCompleted`, `companyKpiRow`, `enabledFrameworks`, `assignmentFor`, `topicGrants`, `userSiteIds`).
- `setup/recommend.ts` (pure): recommended = maps to a disclosure of an enabled version that is `required`/`core` (an ESRS one with a topic marked not material doesn't count) or `if_material` with its topic material; formula inputs pulled in transitively (`pulled_in_by`). Undecided topics aren't material.
- `setup/service.ts`:
  - `GET /kpi/setup` (any role) → `{settings, frameworks, material_topics, kpis, assignments, recommended, available_frameworks, sites}`; Admin/Superadmin also get `people` (id, name, role, site_ids; no emails), `topic_grants`, `suggested_assignments` (default owners: the site's first User, reviewer null = the site's managers; company level → the first Admin; manual KPIs only).
  - `PUT /kpi/setup` (Admin, Superadmin; else 403 `KPI_FORBIDDEN`): any subset of `settings` (`year_type`, `first_year`, `due_day` 1–28, `complete`), `frameworks` (ids; `framework_ids` accepted too), `material_topics`, `kpis`, `assignments`, in one transaction under advisory lock (4152, company); answers the GET shape. Each changed step writes an audit row (`kpi_setup`, entity_id = company, actions `settings`, `frameworks`, `material_topics`, `kpis`, `assignments`, `complete`).
  - Rules: one version per framework code (`KPI_VALIDATION`); not material without a reason and a recommended KPI left out without a reason → 400 `KPI_REASON_REQUIRED` (`details.esrs_topic` / `details.kpi`); owner not a user of the site (company for company level) or reviewer not a Manager of the site → 422 `KPI_VALUE_INVALID` (`details.rule` `user_of_the_site` | `user_of_the_company` | `manager_of_the_site`); another company's site or KPI → 404; assigning an unselected KPI → `KPI_NOT_SELECTED`; level/site mismatch → `KPI_VALIDATION`; the year type can't change once values use the other one (`KPI_VALIDATION`); an omitted `frequency` keeps the override, null clears it. `settings.complete: true` needs a framework and a selected KPI (409 `KPI_SETUP_INCOMPLETE`, `details.missing`) and sets `setup_completed_at` once.
  - `POST /kpi/setup/custom-kpis` (Admin, Superadmin) → 201 `{definition}` (+ `mappings`): `code` optional (made from the name, `C<company>_<NAME>`, `_2`… when taken; a library code → `KPI_CODE_TAKEN`), `source` manual (default) or formula, checked like library KPIs (`checkDefinition(m, d, selfId, companyId)`), selected at once, mappings into `kpi_disclosure_map` for the company's KPI.
- `PATCH /company-admin/users/:id {kpi_topics: KpiTopic[]}` (Admin; `setup/topicGrants.ts`): replaces the user's grants (audited `topic_grant`), answers `kpi_topics`; 403 `KPI_TRACKING_OFF` when the switch is off; bad topics → 400 `KPI_VALIDATION`.
- Wired into KPI-4: `GET /kpi/status.setup_completed`; value writes and submits need a finished setup (409 `KPI_SETUP_INCOMPLETE`; reads still answer); only selected KPIs take values; an item's `frequency` / `year_type` must be the company's (`KPI_VALUE_INVALID` `company_frequency_<f>` / `company_year_type_<t>`); BRSR Core evidence only when the company enabled that BRSR version; `assertCanWrite`: Admin/Superadmin all; the assigned owner; Managers their sites and company level; Users only unassigned site-level pairs on their sites in their topics. `GET /kpi/catalogue` shows the enabled versions (all active ones until the company enables one).
- Not built: the "Invite your team" `kpi_assigned` notification (no endpoint or notification kind in 01-contracts yet: KPI-0 follow-up).

## KPI-6 as built
- `formulas/parse.ts` (pure): a recursive-descent parser, no `eval`: KPI codes, numbers (`1.5e3`), `+ - * /` (and `× ÷ −`), brackets, unary minus, `CODE.part` (breakdown), `sum(CODE)` / `avg(CODE)` over sites. Errors: 422 `KPI_FORMULA_INVALID` `{problems:[text], position}` (0-based). `formulaCodes` (refs, [] when invalid). Units: `parseUnit` (`tCO2e per INR crore` → {tCO2e:1, INR crore:-1}; spellings through the unit registry; %, ratio, count and per-person words are dimensionless), `unitOf` (+/− need the same unit, ×/÷ combine), `formatUnit`.
- `formulas/graph.ts` (pure): `formulaProblems` (syntax, unknown codes, result unit ≠ the KPI's canonical unit, cycles), `definitionProblems` (only problems a save brings: its own, a cycle through it, a formula that uses it losing its unit), `dependantsOf`, `evaluationOrder` (inputs first; cycles never evaluated). Used by `library/service.ts` `checkDefinition` for library and custom KPIs.
- `formulas/evaluate.ts` (pure): `evaluate(ast, resolve)` → `{value, reason: null | "missing_inputs" | "division_by_zero", missing, waiting_for, inputs}`; a missing input is never 0; 12 significant digits.
- `formulas/resolve.ts` (pure): a reference for a site (or the company) and period P: the input's submitted values inside P at the input's own company frequency, rolled up over periods by its aggregation; company target = company-level value, or site values rolled up over the sites that have one (`sum()` adds, `avg()` averages, weighted average → plain average); a site-level formula reads a company-level input's company value; gaps make it `partial`, nothing at all makes it missing; status approved only when every value used is.
- `formulas/recompute.ts`: `recomputeFormulas(company, {years, changedCodes?})` for selected formula KPIs (library and the company's own), every period of the year, per site or company; inputs are pending or approved values (drafts and rejected don't count). Writes through `values/system.ts` (`source:'formula'`, `entered_by` null, `status` approved when every input is, else pending with `comment` "Waiting for <names>."; `auto_snapshot` = `{kind:'formula', formula, unit, inputs:[{code, part, fn, value, unit, status, partial}], waiting_for, computed_at}`); no value → a stored one is removed (`formula_removed`); locked periods untouched. `recomputeForValues(company, valueIds)` runs after `POST /kpi/values/submit` (never fails it) and is the hook for KPI-8's approve/reject (TODO(KPI-8): call it after approve and reject).
- `values/system.ts` (KPI-4's system writer): `writeSystemValue` / `removeSystemValue`, each its own transaction with the KPI lease; skip locked periods and manual values with the same key; audit `auto_refresh` / `formula_recompute` / `auto_removed` / `formula_removed` (changed_by null); a write that only changes the read time keeps the row, but clears a held `checks` (KPI_AUTO_STALE).
- Formula values are read-only: `PUT /kpi/values` → `KPI_AUTO_READ_ONLY`; submit → `KPI_NOT_DRAFT`.
- Golden cases: `ci/golden/kpi/formulas.json` (GHG intensity per revenue, energy per tonne, water consumption, women in the workforce %, a missing input, division by zero), run by `ci/unit/kpi-formulas.test.cjs`; the FE preview runs the same file.
- No HTTP route of its own (01-contracts §3 has none).

