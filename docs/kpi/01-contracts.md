# 01 · KPI contracts

The single source for names, shapes and codes. Backend copy: `ESG-lite/src/kpi/contracts/` (TypeScript + zod). FE copy: `ESG-lite_FE/src/lib/kpi/contracts.ts`. Changed only by a KPI-0 follow-up PR, never inside a module PR.

## §1 Enums and labels

| Enum | Values | Notes |
|---|---|---|
| `FrameworkCode` | `GRI`, `BRSR`, `ESRS` | More later (ISSB, VSME) by adding rows, not code. |
| `RequirementLevel` | `required`, `if_material`, `voluntary`, `core` | `core` = BRSR Core (assurance subset). `if_material` = ESRS datapoints a client reports only when the topic is material. |
| `KpiTopic` | `climate`, `energy`, `water`, `waste`, `pollution`, `biodiversity`, `materials`, `workforce`, `health_safety`, `diversity`, `training`, `human_rights`, `community`, `customers`, `governance`, `ethics` | Groups KPIs in the UI and drives the per-user topic grant (§2 `kpi_topic_grant`). |
| `KpiPillar` | `environment`, `social`, `governance` | D19 (wave E). Labels Environment / Social / Governance, letters E / S / G. `TOPIC_PILLAR` gives each topic one: climate, energy, water, waste, pollution, biodiversity, materials → environment; workforce, health_safety, diversity, training, human_rights, community, customers → social; governance, ethics → governance. |
| `KpiValueType` | `number`, `percent`, `integer`, `currency`, `yes_no`, `choice`, `text` | `text` is for narrative disclosures. Most KPIs are numbers. |
| `KpiSource` | `manual`, `auto`, `formula` | `auto` = read from ESGLite data (KPI-5). `formula` = calculated from other KPIs (KPI-6). |
| `KpiAggregation` | `sum`, `average`, `weighted_average`, `max`, `latest`, `none` | How site values roll up to the company, and months to the year. |
| `KpiLevel` | `site`, `company` | Where a value is entered. Energy is per site; board diversity is per company. |
| `KpiFrequency` | `monthly`, `quarterly`, `annual` | The default per KPI; an Admin may change it per company. |
| `KpiValueStatus` | `draft`, `pending`, `approved`, `rejected` | Same words and colours as emissions (`StatusPill`). |
| `MappingFit` | `exact`, `partial`, `derived` | How well the KPI answers the disclosure; `partial` and `derived` carry a note shown in exports. |
| `AutoSourceKey` | `ghg_scope1`, `ghg_scope2_location`, `ghg_scope2_market`, `ghg_scope3_total`, `ghg_scope3_category_n`, `energy_total`, `energy_renewable`, `energy_non_renewable`, `production_output`, `waste_total` | Each key is one KPI-5 adapter. |

Plain-language labels for every value live in `src/lib/kpi/labels.ts`; pages never hard-code them.

## §2 Tables (new; each with an idempotent `migrate:kpi-*` script)

**Library (global; Superadmin; KPI-2)**
- `kpi_definition`
  - `id`, `code` (stable, e.g. `ENERGY_TOTAL`), `name`, `question` (plain language, as asked to the contributor), `help` (markdown), `topic`, `value_type`.
  - `unit_dimension` (`energy` | `mass` | `volume` | `count` | `currency` | `ratio` | `time` | `none`), `canonical_unit`, `allowed_units[]`.
  - `aggregation`, `level`, `default_frequency`, `source`, `auto_source` (null unless `auto`), `formula` (null unless `formula`).
  - `breakdowns jsonb` (e.g. `{ "by": ["source"], "values": ["groundwater","surface","third_party"] }`).
  - `decimals`, `company_id` (null = library; set = a company's custom KPI), `active`, `created_at`.
  - `pillar` (D19, wave E: `environment` | `social` | `governance`, not null; migrate:kpi-pillars backfills it from `TOPIC_PILLAR[topic]`; the seed and custom KPIs default it from the topic; only a Superadmin overrides it on a library KPI).
- `kpi_framework`: `id`, `code`, `version` (e.g. `GRI 2021+`, `BRSR 2023`, `ESRS 2023`), `name`, `source_url`, `active`, `default_for_new` (bool).
- `kpi_disclosure`
  - `id`, `framework_id`, `code` (e.g. `305-1`, `P6-E7`, `E1-6`), `title` (our own words), `section` (e.g. `GRI 305`, `Principle 6 · Essential`, `E1 Climate change`).
  - `requirement`, `esrs_topic` (`E1`…`G1`, null otherwise), `source_url`, `sort_key`.
- `kpi_disclosure_map`: `id`, `disclosure_id`, `kpi_definition_id`, `fit`, `breakdown_key` (null or the breakdown the disclosure needs), `display_unit` (the framework's unit, e.g. `GJ` for BRSR), `note`.

**Company setup (Admin; KPI-3)**
- `company.kpi_tracking_enabled boolean NOT NULL DEFAULT false` (KPI-1; Superadmin only).
- `company_kpi_settings`: `company_id` (pk), `year_type` (`CY` | `FY`, defaults to the company's reporting year type), `first_year`, `due_day` (default 15: values for a period are due on that day of the following month/quarter/year), `setup_completed_at`.
- `company_framework`: `company_id`, `framework_id`, `enabled_at`, `enabled_by`. Unique per (company, framework code).
- `company_material_topic`: `company_id`, `esrs_topic`, `material` (bool), `reason` (text, required when not material), `decided_by`, `decided_at`.
- `company_kpi`: `company_id`, `kpi_definition_id`, `selected` (bool), `frequency` (override), `reason_excluded`. Unique per (company, kpi).
- `kpi_assignment`: `company_id`, `kpi_definition_id`, `site_id` (null for company level), `owner_user_id`, `reviewer_user_id` (null = the site's managers). Unique per (kpi, site).
- `kpi_topic_grant`: `user_id`, `topic`, `converted_at`. **No longer read or written since D17** (kept; converted once into topic assignments).
- `kpi_topic_assignment` (D17): `id`, `company_id`, `site_id` (null = company level), `topic`, `owner_user_id`, `reviewer_user_id` (null = the site's Managers), `created_at`, `updated_at`, `updated_by`. Unique per (company, COALESCE(site, 0), topic). Who owns a KPI × site: the `kpi_assignment` override, else this row for the KPI's topic, else nobody.

**Values (KPI-4)**
- `kpi_value`
  - `id`, `company_id`, `site_id` (null for company level), `kpi_definition_id`.
  - Period: `period_start`, `period_end`, `frequency`, `year_type`.
  - Value: `value_numeric`, `value_text`, `unit` (as entered), `value_canonical` (in `canonical_unit`), `breakdown jsonb` (`{ "groundwater": 120, … }`).
  - Status: `source`, `status`, `is_estimate`, `comment`.
  - People: `entered_by`, `submitted_at`, `reviewed_by`, `reviewed_at`, `review_comment`.
  - `checks jsonb` (KPI-8), `auto_snapshot jsonb` (KPI-5: what it was read from), `created_at`, `updated_at`.
  - Unique per (company, site, kpi, period_start, frequency).
- `kpi_value_evidence`: `id`, `kpi_value_id`, `document_url`, `document_name`, `uploaded_by`, `uploaded_at`. Same storage as emission documents.
- `kpi_period_lock`: `company_id`, `site_id` (null = all), `year`, `period` (null = whole year), `locked_by`, `locked_at`, `reopened_*`. Same shape as `period_lock`.

**Targets (KPI-9)**
- `kpi_target`: `id`, `company_id`, `kpi_definition_id`, `site_id` (null = company), `baseline_year`, `baseline_value`, `target_year`, `target_value`, `direction` (`reduce` | `increase` | `maintain`), `note`, `created_by`.

Audit: `audit_log.entity_type` gains `kpi_value`, `kpi_setup`, `kpi_period_lock`, `kpi_target`, `kpi_library`.

## §3 HTTP API (all under `/kpi`, mounted once by KPI-0; every route behind `authenticate` + `requireKpiTracking` except `/kpi/library/*` for Superadmin)

| Method and path | Who | Module | Returns |
|---|---|---|---|
| `GET /kpi/status` | any role of the company | KPI-1 | `{ enabled, setup_completed }`. This one answers even when off, with `enabled:false`. |
| `GET/POST/PUT /kpi/library/definitions`, `/frameworks`, `/disclosures`, `/mappings` | Superadmin | KPI-2 | library CRUD; `?framework=` filters |
| `GET /kpi/catalogue` | any | KPI-2 | the library as the company sees it: frameworks, disclosures, KPIs, mappings (versions it enabled) |
| `GET/PUT /kpi/setup` | GET any, PUT Admin/Superadmin | KPI-3 | settings, frameworks, material topics, selected KPIs, assignments; D17 adds `topic_assignments [{id, site_id, topic, owner_user_id, reviewer_user_id}]`, `topics_in_use [{topic, kpi_count, site_kpi_count, company_kpi_count, selected_count}]` and (setup writers) `suggested_topic_assignments` (same shape, `id` null); PUT takes `topic_assignments` (the whole set; `owner_user_id: null` removes) |
| `GET /kpi/people/:user_id/topics` | Manager (their sites), Admin, Superadmin, the person | D17 | `{user_id, topics, by_site:[{site_id, site_name, topics}]}` (`site_id` null = "Company") |
| `PUT /kpi/people/:user_id/topics` | Manager (their sites), Admin, Superadmin | D17 | `{topics, site_ids?}` → `{user_id, topics, site_ids, moved:[{site_id, site_name, topic, topic_label, from_user_id, from_name}]}`; owner of those topics on those sites (default: all their sites), other topics there dropped; audited. `PATCH /company-admin/users/:id {kpi_topics}` (Admin) and `PATCH /admin/users/:id {kpi_topics, company_id?}` (Superadmin, D18) are aliases answering `kpi_topics`, `kpi_topic_site_ids`, `kpi_topic_moves` |
| `POST /kpi/setup/custom-kpis` | Admin | KPI-3 | a company KPI (`company_id` set) |
| `POST /kpi/setup/invite` | Admin, Superadmin | KPI-3 | `{notified}`: one `kpi_assigned` notification per owner of an assignment of a selected KPI ("Invite your team") |
| `GET /kpi/my?period=` | any | KPI-7 | what the caller owes (D17: the pairs they own through the resolver): KPIs × sites × periods, with status, last value and due date; items carry `topic`, `topic_label`, `assigned_via` (`kpi` \| `topic`), sorted in topic order |
| `GET /kpi/my/template?period=&site=` | any | KPI-7 | XLSX (`My KPIs`, `How to fill in`): one row per due or sent-back item the caller owns |
| `POST /kpi/my/template` | any | KPI-7 | plan: multipart `file`, `period`, `site` → `{dry_run: true, file_name, plan:{plan_id, rows:[{row, kpi_definition_id, kpi_code, name, site_id, site_name, period_start, period_label, value, unit, comment, status, issue:{code, message, details?}\|null}], counts:{total, ready, error, issues, skipped}}}`; commit: JSON `{plan_id, commit: true}` → `{dry_run: false, plan_id, saved, results:[{row, ok, value_id} \| {row, ok:false, code, message}]}` (ready rows saved as drafts) |
| `GET /kpi/values?kpi=&site=&from=&to=&status=` | any (scoped) | KPI-4 | values |
| `PUT /kpi/values` | owner, Manager+, Admin (company level) | KPI-4/7 | upsert drafts `{items:[…]}`, per-item result |
| `PUT /kpi/values` item `{id, …fields, reason}` | Manager (own sites), Superadmin | KPI-8 | a reviewer's edit of a pending value: stays pending, `reason` required (`KPI_REASON_REQUIRED`), audited `review_edit` |
| `GET /user/audit-logs?entity_type=kpi_value&entity_id=` | as `GET /kpi/values` | KPI-8 | a value's history (the existing endpoint; KPI tenant rules, `KPI_TRACKING_OFF` when off) |
| `POST /kpi/values/submit` | owner | KPI-7 | `{ids}` → `{submitted, refused:[{id, code}]}` |
| `POST /kpi/values/:id/evidence`, `DELETE …/evidence/:eid` | owner, reviewer | KPI-4 | evidence |
| `PUT /kpi/values/approve`, `/reject` | Manager, Superadmin | KPI-8 | `{ids, only_ready?, reason?}` |
| `GET/POST /kpi/periods/lock`, `POST /kpi/periods/unlock` | Manager (own sites), Admin, Superadmin | KPI-8 | completeness + lock, the same shape as `/periods/lock` |
| `POST /kpi/auto/refresh?year=` | Manager+, also run after approvals | KPI-5 | recomputed auto values |
| `GET/PUT/DELETE /kpi/targets` | GET any, write Admin | KPI-9 | targets with progress |
| `GET /kpi/dashboard?year=&framework=&site=&topic=` | Manager+, Admin | KPI-10 | coverage per framework, gaps, trends |
| `POST /kpi/dashboard/remind` | Manager+, Admin | KPI-10 | `{kpi, site}` → a `kpi_due` to the owner, at most once a day per item |
| `GET /kpi/overview` | any | KPI-10 (wave D fix 3) | `{period, year, readiness:[{framework, version, percent}], due:{due, sent_back, done}, setup_completed}`; readiness for Manager, Admin, Superadmin (`[]` for a User); before setup the empty shape with `setup_completed: false` |
| `GET /kpi/esg?year=&site=&pillar=&topic=` | Manager (own sites), Admin, Superadmin | D19 (wave E) | `{year, year_type, label, filters:{site, pillar, topic}, pillars:[{pillar, label, kpis, approved, pending, missing, not_due, coverage_pct, change:{approved_pct_vs_last_year}, topics:[{topic, label, kpis, approved, pending, missing, coverage_pct}]}], trends:[{pillar, topic, kpi_definition_id, code, name, unit, decimals, direction_good, series:[{period, period_start, label, value}], value, previous, change_pct, target:{progress_pct, status, label} \| null}], sites:[{site_id, name, pillars:{environment, social, governance}}], movers:[{kpi_definition_id, name, pillar, change_pct, direction_good, good}], pending_not_in:{count, link}}`; approved values only, D17 expected sites; `pillars` and `sites` always carry all three pillars (honour `site` and `topic`), `trends`, `movers` and `pending_not_in` honour `pillar` too; `site` drops company-level KPIs; headlines in `src/kpi/esg/headlines.ts` (≤ 4 per pillar; series: the year's months or quarters, annual KPIs the last 5 years); a User gets 403 `KPI_FORBIDDEN` |
| `GET /kpi/reports/:framework?year=&format=xlsx\|pdf\|json` | Manager+, Admin | KPI-11 | the framework export (approved only) |
| `POST /kpi/ai/suggest-values` | any (their own due KPIs) | KPI-12 | JSON `{document_id, site_id?, period?, kpis?}` or multipart `file` + the same fields → `{available: true, document_id, document_name, pages, period, suggestions:[{kpi_code, kpi_definition_id, kpi_name, site_id, site_ids, value, unit, breakdown_key, period_start, period_end, site_hint, source_page, quote, confidence, why, check_this, document_id, document_name, label}]}` or `{available: false, message, suggestions: []}` (AI down; a Superadmin until python accepts their uploads) |
| `POST /kpi/ai/suggest-mapping` | Admin, Superadmin | KPI-12 | `{name, question, unit?, topic}` → `{available, suggestions:[{disclosure_id, framework, version, code, title, section, why, confidence, check_this, fit}]}` from the company's enabled catalogue |

Error shape: `{ code, message, details? }`, as `src/imports/errors.ts`.

Bulk actions answer `{updated: [ids], refused: [{id, code}]}` (submit: `{submitted, refused}`); one id's refusal never stops the others. Lists and rows are wrapped by name (`{values}`, `{targets}`, `{target}`, `{report}`, `{lock, status}`).

Notification kinds (`src/kpi/contracts/enums.ts` `KPI_NOTIFICATION_KINDS`):

| Kind | Module | To | When |
|---|---|---|---|
| `kpi_enabled` | KPI-1 | the company's Admins | the switch went on |
| `kpi_assigned` | KPI-3 | each owner (D17: through the resolver, topic owners included) | `POST /kpi/setup/invite` ("Invite your team") |
| `kpi_submitted` | KPI-8 | each reviewer (the resolved owner row's, D17; else the site's Managers) | values submitted; one per reviewer per submit |
| `kpi_rejected` | KPI-8 | whoever entered the value | a value sent back, with the reason |
| `kpi_due` | KPI-8, KPI-10 | owners with values missing | 5 days before and on the due date (daily job; mute with `notification_preferences.kpi_due = false`), and a Manager's "Remind" |

## §4 Error codes (`src/kpi/contracts/errors.ts`)

| Code | HTTP | When |
|---|---|---|
| `KPI_TRACKING_OFF` | 403 | the company's switch is off |
| `KPI_SETUP_INCOMPLETE` | 409 | values or reports before setup is finished |
| `KPI_NOT_SELECTED` | 422 | a value for a KPI the company didn't select |
| `KPI_NOT_ASSIGNED` | 403 | a contributor entering a KPI or site not assigned to them |
| `KPI_UNIT_NOT_ALLOWED` | 422 | a unit outside `allowed_units`, or one that can't convert to `canonical_unit` |
| `KPI_VALUE_INVALID` | 422 | type, range or breakdown-sum check failed (e.g. a percent over 100, breakdown ≠ total) |
| `KPI_AUTO_READ_ONLY` | 409 | writing an `auto` or `formula` value |
| `KPI_PERIOD_LOCKED` | 409 | writing into a locked KPI period |
| `KPI_PERIOD_INCOMPLETE` | 422 | locking a KPI period while values are missing, draft, pending or rejected (`details.left`) |
| `KPI_NOT_DRAFT` | 409 | submitting a value that isn't a draft |
| `KPI_EVIDENCE_REQUIRED` | 422 | submitting a BRSR Core KPI without evidence (D15) |
| `KPI_FORMULA_INVALID` | 422 | library or custom formula: unknown code, a cycle, or a unit mismatch |
| `KPI_REASON_REQUIRED` | 400 | excluding a KPI, a non-material topic, or unlocking without a reason |

Plumbing codes every route may answer (not contract decisions; `errors.ts` second block): `KPI_VALIDATION` 400, `KPI_NOT_FOUND` 404, `KPI_FORBIDDEN` 403, `KPI_COMPANY_REQUIRED` 400, `KPI_CODE_TAKEN` 409, and the per-id review refusals `KPI_NOT_PENDING` 409 (not waiting for review), `KPI_NOT_READY` 409 (`only_ready` and a check holds it), `KPI_SELF_REVIEW` 403 (your own entry).

## §5 Review checks (KPI-8; ids in `src/kpi/contracts/checks.ts`)

| Id | Holds the value when |
|---|---|
| `KPI_EVIDENCE` | no evidence on a KPI that needs it (BRSR Core, or the company's setting) |
| `KPI_CHANGE_LIMIT` | it changes from the same period last year by more than the company's change limit (existing `Threshold`) |
| `KPI_BREAKDOWN_SUM` | the breakdown parts don't add up to the total (±0.5 %) |
| `KPI_UNIT_CONVERTED` | entered in a unit other than the canonical one (informational) |
| `KPI_ESTIMATE` | marked as an estimate |
| `KPI_AUTO_STALE` | an auto value whose source rows changed since it was read |

## §6 FE routes (`src/features/kpi/routes.tsx`, `routeMap.ts`; all hidden unless the switch is on)

| Route id | Path | Roles | Module |
|---|---|---|---|
| `kpi-setup` | `/kpi/setup` | Admin, Superadmin (client context) | KPI-3 |
| `kpi-my` | `/kpi` | User, Manager, Admin | KPI-7 |
| `kpi-review` | `/data/approvals?view=kpi` (a tab of Approvals) | Manager, Superadmin | KPI-8 |
| `kpi-targets` | `/kpi/targets` | Manager, Admin | KPI-9 |
| `kpi-dashboard` | `/kpi/dashboard` | Manager, Admin, Superadmin | KPI-10 |
| `kpi-esg` | `/kpi/esg` ("ESG dashboard") | Manager, Admin, Superadmin | D19 (wave E) |
| `kpi-reports` | `/reports/kpi/:framework` | Manager, Admin, Superadmin | KPI-11 |
| `kpi-library` | `/setup/kpi-library` | Superadmin | KPI-2 |

Nav (switch-aware, KPI-1):
- **User:** "My KPIs" next to "My month".
- **Manager:** "KPIs" in the Data group, plus "Framework reports" in Reports.
- **Admin:** "KPI setup" in Settings, plus "KPIs".
- **Superadmin:** "KPI library" under Setup, plus the client switch.

## §7 Seed library (KPI-2; v1 scope)

The v1 library covers the KPIs most clients report under all three frameworks. KPI-2 verifies every code against the official document, and records the source URL and the version.

| KPI code | Question (short) | Source | GRI | BRSR | ESRS |
|---|---|---|---|---|---|
| `GHG_SCOPE1` | Scope 1 emissions | auto | 305-1 | P6 Essential (Scope 1 & 2 emissions) · Core | E1-6 |
| `GHG_SCOPE2_LB` / `GHG_SCOPE2_MB` | Scope 2 (location / market based) | auto | 305-2 | P6 Essential · Core | E1-6 |
| `GHG_SCOPE3` (+ per category) | Scope 3 emissions | auto | 305-3 | P6 Leadership | E1-6 |
| `GHG_INTENSITY_REVENUE` | GHG per revenue | formula | 305-4 | P6 Essential (intensity) · Core | E1-6 |
| `ENERGY_TOTAL` (+ renewable / non-renewable) | Energy consumed | auto | 302-1 | P6 Essential (energy) · Core | E1-5 |
| `ENERGY_INTENSITY_REVENUE` | Energy per revenue | formula | 302-3 | P6 Essential (intensity) · Core | E1-5 |
| `WATER_WITHDRAWAL` (by source) | Water withdrawn | manual | 303-3 | P6 Essential (water) · Core | E3-4 |
| `WATER_DISCHARGE` | Water discharged | manual | 303-4 | P6 Essential | E3-4 (partial) |
| `WATER_CONSUMPTION` | Water consumed | formula (withdrawal − discharge) or manual | 303-5 | P6 Essential · Core | E3-4 |
| `WASTE_GENERATED` (by type) | Waste generated | manual or auto | 306-3 | P6 Essential (waste) · Core | E5-5 |
| `WASTE_DIVERTED` / `WASTE_DISPOSED` | Waste recovered / disposed | manual | 306-4 / 306-5 | P6 Essential · Core | E5-5 |
| `AIR_NOX` / `AIR_SOX` / `AIR_PM` | Air emissions | manual | 305-7 | P6 Essential (air) | E2-4 |
| `REVENUE` | Revenue (for intensities) | manual (company level) | — (denominator) | denominator | denominator |
| `EMPLOYEES_TOTAL` (by gender, contract) | Employees | manual (company) | 2-7 | Section A / P3 | S1-6 |
| `HIRES_TURNOVER` | New hires and turnover | manual | 401-1 | P3 Essential | S1-6 |
| `LTIFR` / `FATALITIES` / `RECORDABLE_INJURIES` | Safety | manual (site) | 403-9 | P3 Essential (safety) · Core | S1-14 |
| `TRAINING_HOURS_AVG` | Training hours per employee | manual | 404-1 | P3 Essential (training) | S1-13 |
| `WOMEN_IN_WORKFORCE` / `WOMEN_ON_BOARD` | Gender diversity | manual (company) | 405-1 | P5 / Core (gender diversity) | S1-9 / G1 |
| `GENDER_PAY_GAP` | Pay ratio women to men | manual | 405-2 | P5 Essential (wages) | S1-16 |
| `COMPLAINTS_*` | Complaints received / resolved | manual | 2-25 / 2-26 | P1, P8, P9 | S1-17 / G1 |

BRSR codes are written `P<principle>-E<n>` (essential) or `P<principle>-L<n>` (leadership), after the indicator numbers in SEBI's BRSR format as KPI-2 verifies them.
