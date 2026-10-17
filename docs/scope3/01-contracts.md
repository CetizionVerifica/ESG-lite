# 01 · Contracts

S3-0 copies this file into code at `ESG-lite/src/scope3/contracts/` (zod schemas plus inferred types) and into FE `src/lib/scope3/contracts.ts` (types and labels only). Change a contract only with an S3-0 follow-up PR merged first.

## 1. GHG Protocol categories (`ghgCategory.ts`)

| n | key | Name (exact) | Direction | Plain-language methods offered (key → label) |
|---|---|---|---|---|
| 1 | purchased_goods | Purchased goods and services | upstream | supplier_specific "Supplier's own figure", hybrid "Supplier's energy and materials", average_data "Average for the material", spend_based "From the amount spent" |
| 2 | capital_goods | Capital goods | upstream | same as 1 |
| 3 | fuel_energy | Fuel- and energy-related activities | upstream | supplier_specific, average_data (sub-activities 3a, 3b, 3c, 3d) |
| 4 | upstream_transport | Upstream transportation and distribution | upstream | fuel_based "From fuel used", distance_based "Weight × distance", spend_based, site_specific "Warehouse energy", average_data |
| 5 | waste | Waste generated in operations | upstream | supplier_specific, waste_type_specific "By waste type and treatment", average_data |
| 6 | business_travel | Business travel | upstream | fuel_based, distance_based "Distance travelled", spend_based |
| 7 | employee_commuting | Employee commuting | upstream | fuel_based, distance_based, average_data "Headcount × national average" |
| 8 | upstream_leased | Upstream leased assets | upstream | asset_specific, lessor_specific, average_data |
| 9 | downstream_transport | Downstream transportation and distribution | downstream | as 4 |
| 10 | processing | Processing of sold products | downstream | site_specific, average_data |
| 11 | use_of_sold | Use of sold products | downstream | direct_use "Direct use (energy, fuel, gases)" (11.1–11.3), indirect_use (optional) |
| 12 | end_of_life | End-of-life treatment of sold products | downstream | waste_type_specific, average_data |
| 13 | downstream_leased | Downstream leased assets | downstream | asset_specific, lessee_specific, average_data |
| 14 | franchises | Franchises | downstream | franchise_specific, average_data |
| 15 | investments | Investments | downstream | investment_specific, average_data, project_specific |

`Method` enum = union of the keys above + `unknown` (legacy rows). Methods are ranked by specificity per category in this order (index 0 = most specific). S3-12 screening and the DQ default use that rank.

`Scope` enum: `'Scope 1' | 'Scope 2' | 'Scope 3' | null` (null = saving, such as renewables). Stored as today, but validated (S3-4).

`Scope3Sub` (Cat 3 only): `3a_upstream_fuels | 3b_upstream_electricity | 3c_td_losses | 3d_resold_energy`.

## 2. Factor metadata (`factor.ts`)

`FactorType`: `combustion | wtt | td_loss | life_cycle | cradle_to_gate | eeio_spend | supplier | process | other`.
`GwpSet`: `AR4 | AR5 | AR6` (D7 default `AR6`). `Gas`: `CO2 | CH4 | N2O | HFCs | PFCs | SF6 | NF3`.
Each factor row gets: `factor_type`, `gwp_set`, `geography` (ISO-3166 alpha-2 or `GLO` or a region code), `dataset` (e.g. `DEFRA`, `IEA`, `USEEIO`, `ecoinvent`, `supplier`), `dataset_version`, optional gas parts `co2_kg`, `ch4_kg`, `n2o_kg`, `other_kgco2e`, optional `biogenic_co2_kg`, `includes_wtt boolean default false` (a life-cycle transport factor that already bundles WTT, S3-7), `price_base_year` and `price_currency` (eeio_spend only), and a widened `factor_value numeric(18,8)`.

Allowed factor types per category (checked at save, warning code `FACTOR_TYPE_MISMATCH`, never blocking):
- Cat 1/2: `cradle_to_gate`, `eeio_spend`, `supplier`.
- Cat 3: `wtt`, `td_loss`.
- Cat 4/9: `life_cycle`, `combustion`, `eeio_spend`, `other` (refrigerant GWP rows, 4.1).
- Cat 6/7: `life_cycle`, `combustion`, `eeio_spend`.
- Cat 5/12: `process`, `life_cycle`.
- Cat 11: `combustion`, `other`.
- Cat 8/13: `life_cycle`, `combustion`, `other` (refrigerant GWP, reported partner emissions).
- Cat 10: `process`, `combustion`, `life_cycle`.
- Cat 14: `life_cycle`, `combustion`, `other`.
- Cat 15: `eeio_spend`, `other`.
(Cats 8, 10, 13, 14 and 15 were added by S3-0 in ESG-lite #144 from what the S3-10 and S3-11 forms use; `other` covers reported partner emissions, below.)

**Reported partner emissions** (Cat 8 lessor, 13, 14, 15; examples 8.3, 13.1, 14.1, 15.1): the partner's Scope 1+2 figure is entered as activity data with evidence and calculated by the engine with an identity factor "Reported emissions" = 1 kgCO₂e per `kgco2e` (1,000 per `tco2e`), `factor_type other`, `dataset reported`, and the row is `data_type primary`. This is a figure the partner reported, not a total ESGLite is asked to trust from a client app, so the one-engine rule holds (D13, confirmed by Shyam 2026-10-16).

## 3. Data quality (`dq.ts`)

`DqScore` = 1 (good) | 2 (fair) | 3 (poor). This is the same 1–3 scale as PCF DQR, so the two can be compared (D2).
`Dq` = `{ technology, geography, time, completeness, reliability }`, each a DqScore, plus `overall` (the rounded mean) and `source: 'auto' | 'manual'`.
`DataType` = `primary | secondary`. `is_estimate` = boolean (for example, a distance from the route helper).

**Auto default (S3-3, `dq/defaults.ts`):**
- The method rank sets reliability: supplier/site/asset-specific = 1, hybrid = 2, average/distance/fuel = 2, spend = 3.
- Factor `geography` equal to the site country gives geography 1. A region gives 2. `GLO` or missing gives 3.
- Time: factor year = reporting year or year − 1 gives 1, within 3 years gives 2, older gives 3.
- Completeness = 1 unless the row is a proxy or extrapolated (S3-12), which gives 3.
- A row with no evidence document can't score above 2 on reliability.
- `data_type = primary` when the method is supplier/site/asset/lessor/lessee/franchise/investment-specific, or the activity is a meter, bill or supplier figure (evidence present). Otherwise `secondary`.

## 4. Tables and columns (all via `migrate:scope3-*`)

| Table / column | Type | Module |
|---|---|---|
| `category.ghg_category` | smallint null, check 1–15, only when scope = 'Scope 3' | S3-1 |
| `company.consolidation_approach` | varchar default `operational_control` (`equity_share`, `financial_control`) | S3-1 |
| `company_scope3_category` | id, company_id, ghg_category, status (`included`, `excluded`, `not_relevant`, `screening`), reason text (required unless included), method_note text, relevance jsonb (Table II criteria ticks, keys `RELEVANCE_KEYS`: `size`, `influence`, `risk`, `stakeholders`, `outsourcing`, `sector_guidance`, `spend_analysis`, `other`), updated_by, updated_at; unique (company_id, ghg_category) | S3-1 |
| `category_ghg_map_proposal` | category_id, company_id, proposed ghg_category, confidence, confirmed_by/at | S3-1 backfill |
| `emission_factors.*` | §2 fields | S3-2 |
| `emission.method` | varchar null (`Method`) | S3-3 |
| `emission.dq` | jsonb null (`Dq`) | S3-3 |
| `emission.data_type` | varchar null | S3-3 |
| `emission.is_estimate` | boolean default false | S3-3 |
| `emission.total_kgco2e` | numeric(18,4) null (written beside `total_emission`) | S3-4 |
| `emission.fx` | jsonb null `{currency, to, rate, as_of, source, spend_date?, fallback?}`: 1 `currency` = `rate` `to` on `as_of`; `spend_date` is the purchase date it was looked up for; `fallback: true` marks a stand-in rate (FX_RATE_FALLBACK: latest stored or live), which a recalculation quotes again once the purchase day is stored | S3-5 |
| `fx_rate` | currency, date, rate_to_usd, source; unique (currency, date) | S3-5 |
| `price_deflator` | country, year, index (any base, e.g. CPI-U 1982-84 = 100; only ratios index[base year] ÷ index[spend year] are used), source | S3-5 |
| `supplier` | supplier_id, company_id, name, country, email null, created_by; unique (company_id, lower(name)) | S3-6 |
| `emission.supplier_id` | int null FK supplier | S3-6 |
| `supplier_factor` | id, company_id, supplier_id, item, unit, kgco2e_per_unit, boundary (`cradle_to_gate`), reference_year, gwp_set, evidence_document_id, source (`supplier_request`, `manual`), material_factor_id null | S3-6 |
| `supplier_facility_data` (hybrid) | id, company_id, supplier_id, year, scope12_tco2e, output_qty, output_unit, allocation_key | S3-6 |
| `emission.scope3_sub` | varchar null (`Scope3Sub`) | S3-7 |
| `emission.gas_kg` | jsonb null, kg per `Gas`, from the factor's gas parts | S3-4 writes (engine); S3-13 reads |
| `emission.biogenic_kg` | numeric null, from the factor's `biogenic_co2_kg` | S3-4 writes (engine); S3-13 reads |
| `site.lease_role` | varchar null (`lessee`, `lessor`, `franchisee`, `franchisor`) + `floor_area_m2` | S3-11 |
| `site.lease_type` | varchar null (`finance`, `operating`), for the lease boundary rule | S3-11 |
| `company.home_site_id` | int null FK site: company-level rows (Cat 15, franchises) go on the head-office site | S3-11 |
| `investment` | id, company_id, investee, type (`equity`, `debt`, `project`), share_pct, investee_scope12_tco2e, year, source, revenue, currency, eeio_sector, sector_split jsonb null (`{sector: share}` summing to 1) | S3-11 |
| `product_sale` | id, company_id, product_id, period (date, first day of the month, like `emission.date`), quantity, unit, region | S3-10 |
| `product.lifetime_uses`, `product.eol_mix` jsonb | null; `eol_mix` = `[{treatment, share}]`, shares summing to 1. `Product` gains columns although §4 of the plan lists it as read-only (allowed deviation) | S3-10 |
| `emission.proxy` | jsonb null `{basis, coverage_pct, from}`: `basis` `coverage` \| `intensity` \| `sample`; `coverage_pct` 1–99, required only for `coverage` (optional share for the others, up to 100); `from` = the source emission row ids (empty for a survey). Plain label per basis: `PROXY_BASIS_LABELS`. Survey scaling is a proxy too: `{basis: "sample", coverage_pct, from: []}`; S3-9 keeps it in `extra_data.survey` until S3-12 merges and backfills | S3-12 |
| `scope3_screening_input` | company_id, year, year_type (`CY`, `FY`, default `CY`), ghg_category, basis (`spend`, `headcount`, `revenue`, `mass_sold`, `other`), amount, currency, eeio_sector, note, updated_by/at; unique (company_id, year, year_type, ghg_category, basis) | S3-12 |
| `company_base_year` | company_id, base_year, scope, significance_pct default 5, policy_note, rationale text, year_type (`CY`, `FY`), snapshot jsonb (frozen base-year tCO₂e per category, with version and `frozen_at`) | S3-14 |
| `recalculation_event` | id, company_id, reason (`methodology`, `data_quality`, `structural`, `error`), affected_years, delta_tco2e, approved_by, created_at, status (`proposed`, `approved`, `dismissed`), note, before/after jsonb | S3-14 |
| `emission.status` | adds `draft`. It is a Postgres enum (`Emission.ts:15-19,42-47`), so the migration runs `ALTER TYPE … ADD VALUE 'draft'` outside a transaction | S3-15 |
| `emission.checks` | jsonb null `{ready: bool, held: CheckId[]}` | S3-15 |
| `period_lock` | company_id, site_id null, year, month null, locked_by, locked_at, reopened_by/at/reason | S3-15 |
| `company.review_workflow_v2` | boolean default false | S3-15 |
| `nothing_this_month` | site_id, category_id, period (date, first of the month), user_id, created_at | S3-15 |
| `audit_log.entity_type` | gains `scope3_*` values (`scope3_boundary`, `scope3_base_year`, `scope3_recalculation`, `scope3_period_lock`, `scope3_supplier_factor`); the type is widened by S3-0, each module writes its own; the read endpoint learns them with the first module that writes one (S3-1) | S3-0 |

## 5. HTTP API (all under the existing auth, company-scoped)

| Method and path | Module | Notes |
|---|---|---|
| `GET /scope3/categories` | S3-1 | the 15 rows plus the caller company's status and mapped categories |
| `PUT /scope3/categories/:n` | S3-1 | Admin and Superadmin: status, reason, method_note, relevance |
| `GET/POST /scope3/category-map` | S3-1 | proposals, confirm |
| `PUT /company/:id/consolidation-approach` | S3-1 | Superadmin and Admin |
| `GET/POST/PUT /suppliers`, `GET /suppliers/:id/factors` | S3-6 | Manager+ on own company |
| `POST /suppliers/:id/factors` | S3-6 | manual entry; supplier-request accept also writes here |
| `GET /fx-rates?currency&date` | S3-5 | read only; filled by a daily job |
| `GET /scope3/screening?year=&year_type=` | S3-12 | estimate per category and suggested status (year_type defaults to CY) |
| `PUT /scope3/screening/inputs` | S3-12 | `{year, year_type?, inputs}` (year_type defaults to CY): the `scope3_screening_input` rows; relevance ticks and "Apply suggestion" go through `PUT /scope3/categories/:n` |
| `POST /scope3/screening/sector-suggestions` | S3-12 | Admin and Superadmin: `{description, supplier?, amount, currency}` → `{available, suggestions: [{code, name, confidence, needs_confirmation}] (≤ 3), confirm_below: 80}` via the AI route below; `available: false` when the AI service can't answer |
| `POST /scope3/extrapolate` | S3-12 | body `{ghg_category, site_id, year, year_type, basis: "coverage" \| "intensity", coverage_pct?, source_filter?, output_site_ids?}`; creates proxy rows, Pending; `EXTRAPOLATION_BASIS_INVALID` for coverage outside 1–99, no source rows or no production |
| `POST /v1/scope3/eeio-sector` (python_AI_service) | S3-12 | `{lines: [{description, supplier, amount, currency}], sectors: [{code, name}]}` → up to 3 `{code, confidence 0–100}` per line |
| `POST /scope3/commuting/surveys` | S3-9 | `{site_id, year, year_type, total_employees, responses: [{ref, mode, one_way_km, days_per_week, weeks_per_year}]}` (≤ 20,000 responses) → an import plan |
| `GET/POST/PUT /scope3/product-sales`, `PUT /scope3/products/:id/use-profile` | S3-10 | sales (CSV ≤ 5,000 rows); lifetime uses and EOL mix |
| `POST /scope3/sold-products/plan` | S3-10 | `{site_id, year, year_type, ghg_category}` → an import plan |
| `GET/POST/PUT /scope3/investments`, `POST /scope3/investments/plan` | S3-11 | Admin and Superadmin (Manager read); plan body `{site_id, year, year_type}` |
| `GET /reports/ghg/scope3?…` | S3-13 | same filters as the GHG report; one row per category plus "Unmapped": `{n, name, direction, status, reason, method_note, tco2e, share_pct, methods: {key: pct}, primary_pct, value_chain_pct, proxy_pct, dq: {overall, good_pct, fair_pct, poor_pct}, datasets: [{dataset, version, factor_type}], gwp_sets, biogenic_tco2e \| null, mapped_categories}` |
| `GET/PUT /scope3/base-year`, `GET/POST /scope3/recalculations` | S3-14 | |
| `POST /user/emissions/submit` `{ids}` | S3-15 | draft → pending, runs the checks |
| `GET/POST /periods/lock`, `POST /periods/unlock` `{reason}` | S3-15 | Manager+ for own sites; lock refused while items are left (`PERIOD_INCOMPLETE`) |
| `GET /user/emissions?ready=1\|0`, `PUT /user/emissions/bulk-approve` `{ids, only_ready: true}` | S3-15 | ready filter; bulk approve skips rows that aren't ready and returns them |
| `POST /user/emissions/check` | S3-15 | dry run of the checks for the live panel; saves nothing |
| `GET /user/emissions/:id/history?months=6` | S3-15 | a row's last 6 months |
| `POST/DELETE /user/my-month/nothing` `{site_id, category_id, month}` | S3-15 | "Nothing this month"; notification kind `draft_submitted` for submitted drafts |

**As built by S3-15 part 2 (ESG-lite `[S3-15 3/4]`), response shapes.** Errors are `{code, message, details?}`; access and validation use the S3-1 codes `SCOPE3_VALIDATION` (400), `SCOPE3_COMPANY_REQUIRED` (400), `SCOPE3_FORBIDDEN` (403), `SCOPE3_NOT_FOUND` (404, also another company's ids).
- **A Draft belongs to its author.** For anyone else (Manager, Admin and Superadmin included) it doesn't exist: single-row routes (edit, manager edit, delete, approve, reject, history, factor, audit trail, evidence add/move/remove) answer their usual 404, id lists (bulk approve/reject/delete) drop it like an unknown id (404 when nothing is left), batch approve/reject/delete skip it (404 for a batch of only such rows), a typed entry with `replace=true` never matches it. FERA twins follow the parent.
- `POST /user/emissions/submit {ids}` (1–1,000) → 200 `{submitted: number[], refused: [{id, code: "NOT_DRAFT" | "PERIOD_LOCKED"}]}`. Own drafts only (a non-draft is `NOT_DRAFT`); FERA twins move with their parent; any id outside the caller's sites, or someone else's draft → 404.
- `POST /user/emissions/check`, saves nothing, two body forms:
  - `{ids: number[]}` (1–200) → 200 `{results: [{id, status, checks: {ready, held: CheckId[]}}]}`; saved rows of any status checked as if submitted now.
  - `{rows: [{ref: string (1–100), id?: number, site_id, category_id, activity_data: object, activity_data_unit?: string | null, date_of_reporting: "YYYY-MM-DD", reporting_period?: "monthly" | "yearly" (default monthly), year_type?: "CY" | "FY" | null, method?: string | null, has_evidence?: boolean}]}` (1–50) → 200 `{results: [{ref, checks: {ready, held: CheckId[]}, issue?: {code, message, field?}}]}`, in request order. Each row runs `prepareEntry` (as a save) and the §8 checks with a saved row's context: duplicates and month totals from pending and approved rows, the company change limit, evidence = `has_evidence` (default false; for an edit, the saved row's evidence), `IMPORT_MATCH_SURE` passes (no import). `issue` is the engine's refusal (e.g. `NO_FACTOR_FOR_YEAR`, `UNIT_NOT_CONVERTIBLE`, `METHOD_NOT_ALLOWED`, `FIELD_REQUIRED`, `PERIOD_INVALID`, `CATEGORY_NOT_ASSIGNED`); checks still come back (`FACTOR_FOUND` held without a factor). With `id` the row is an edit of that saved row: it and its FERA family are left out of its own duplicate and month-total comparison. Access as `POST /user/emissions`: another company's site, or an `id` that is someone else's draft or not on the caller's sites → 404; a site of the caller's company that isn't theirs → 403 (`SCOPE3_FORBIDDEN`); a User's category not granted → 403. Invalid body (neither form, 0 or 51+ rows, bad date) → 400 `SCOPE3_VALIDATION`.
- `GET /user/emissions/:id/history?months=6` (1–24) → 200 `{id, site_id, category_id, emission_category, unit: "tCO2e", months: [{month: "YYYY-MM", total_tco2e, rows}]}`, oldest first, ending with the row's month; pending and approved rows of the same site, category and `emission_category`.
- `POST /user/my-month/nothing` and `DELETE` (body or query) `{site_id, category_id, month: "YYYY-MM-DD" | "YYYY-MM"}` → 200 `{site_id, category_id, month: "YYYY-MM-01", nothing: boolean}`; 403 `REVIEW_WORKFLOW_OFF` with the switch off, 409 `PERIOD_LOCKED` in a closed month.
- `GET /periods/lock?year&month[&site_id][&company_id]` → 200 `PeriodStatus`: `{company_id, year, month, period: "YYYY-MM", review_workflow_v2, can_lock, locked, left: [{site_id, site_name, category_id, category_name, reason: "missing" | "draft" | "pending" | "rejected"}], sites: [{site_id, name, locked, lock: {site_id (null: the company-wide lock this site sits under), locked_at, locked_by, locked_by_name} | null, reopened: {reopened_at, reopened_by, reopened_by_name, reason} | null, left: number, categories: [{category_id, category_name, scope, ghg_category, state: "missing" | "draft" | "pending" | "rejected" | "approved" | "nothing" | "covered", counts: {draft, pending, approved, rejected}, nothing}], scope3: [{n: 1–15, status: boundary status (default "screening"), data: boolean}]}]}`.
- `POST /periods/lock {site_id?: number | null, year, month, company_id?}` → 200 `PeriodStatus`; 422 `PERIOD_INCOMPLETE` `{details: {left}}`; 403 `REVIEW_WORKFLOW_OFF`. `POST /periods/unlock {site_id?, year, month, reason, company_id?}` → 200 `PeriodStatus`; 400 `UNLOCK_REASON_REQUIRED` `{details: {min_length: 5}}`. A Manager names one of their sites; `site_id` null is every site (Admin, Superadmin).
- Evidence on a closed month is allowed and logged: attaching (upload, multiple upload, invoice link, relink) or removing (delete, bulk delete, relink away) a document on a row whose site-month is closed writes `audit_log` `{entity_type: "scope3_period_lock", entity_id: <period_lock id>, action: "evidence_added" | "evidence_removed", changed_fields: {document_id: {old, new}, emission_id: {old, new}}}` (ids only).
- `GET /user/my-month` with the switch on adds `review_workflow_v2: true`, per site `locked`, per category `entries.draft` and `nothing`, statuses `draft` and `nothing`, and `summary.draft`; with it off the response is unchanged.

Existing endpoints that gain fields: `GET /user/emissions` (method, dq, data_type, supplier, checks); `GET /admin/emission-factors` (§2 fields); `GET /user/my-month` (draft count, nothing-this-month flag); the GHG report endpoints (ghg_category per row).

## 6. Engine interface (`emissionWrite`)

S3-0 refactors (no behaviour change, golden identical):
```
src/services/emissionWrite/
  compute.ts            dispatch: computeRow(ctx, row) → ComputedRow
  methods/activity.ts   today's activity × factor (default)        S3-0
  methods/spec.ts       per_method / per_unit                       S3-0
  methods/spend.ts      stub → S3-5
  methods/supplier.ts   stub → S3-6
  methods/hybrid.ts     stub → S3-6
  methods/fera.ts       today's FERA twin → S3-7 owns
  methods/proxy.ts      stub → S3-12
```
`ComputedRow = { total_tco2e: number (2 dp, as today), total_kgco2e: string, factor_snapshot: FactorSnapshot, method: Method, dq: Dq, data_type, warnings: Warning[] }`.
`FactorSnapshot` gains `factor_type, gwp_set, geography, dataset, dataset_version, gases?`.
The row's method is set by the form, not by the contributor (simple data entry, ESG-lite_FE `docs/simple-entry/00-plan.md` §5.2), first that applies:
1. an import by an Admin or Superadmin, a Manager's smart Excel import, or an MCP row may send `method` (it must be in the form's `method_options`, else `METHOD_NOT_ALLOWED`); a User's manual bulk upload does not;
2. the form's `method_by_choice` (SE-2): the answer to a client-worded select field picks the method;
3. the form's `method_options[0]`;
4. `spend_based` when the matched factor is `eeio_spend` (S3-5);
5. `activity`.
A User's typed entry never sends a method; any `method` / `@method` it carries is ignored when the form fixes one.
Dispatch order (`methodFileFor` in `compute.ts`), first match wins:
1. a row with `proxy` → `methods/proxy.ts`;
2. method `spend_based` → `methods/spend.ts`, `supplier_specific` → `methods/supplier.ts`, `hybrid` → `methods/hybrid.ts`, on any category, spec or not (so Cat 4/9 spend rows under S3-8 and Cat 6 spend rows under S3-9 get S3-5's FX and deflator maths);
3. any other method on a category with a calculation spec → `methods/spec.ts`, so `fuel_based`, `distance_based`, `site_specific` and `average_data` forms (S3-8 to S3-11) need no method file of their own;
4. everything else → `methods/activity.ts`.

S3-5 put `methodFileFor` in this order. A row carrying a spend quote (asked for with `@method` until S3-3, or on an `eeio_spend` factor) goes to `methods/spend.ts` after step 2 and before step 3. No row carries a method yet, so the order moved no numbers (golden re-run confirms it).

**Shared spec additions** (built by S3-9; contract owned by S3-0 here in §6; used by S3-8, S3-10 and S3-11):
- `MethodCalculation.divide?: string[]`: fields to divide by, each > 0 (0 or empty → `FIELD_REQUIRED`); a field also listed in `percent` divides by value / 100.
- `method_column: "@method"`: the row's `method` (S3-3) picks the field set instead of a select column.
- `ColumnConfig.method_options` (S3-3 column) carries the units each method offers: `[{method, units: string[]}]`, most specific first, typed by `MethodOptionsSchema` in `src/scope3/contracts/schemas.ts`. The method a user picks decides which units the form shows.

**As built by S3-0:** `computeRow(ctx, row)` with `row = {factor, activity_data, activity_unit, method?, proxy?}` returns `{ok, computed}` or `{ok: false, issue}`; `computeTotal` keeps its old signature. `Computed` has the optional `total_kgco2e`, `method`, `dq`, `data_type` (unset until S3-3/S3-4 fill them).

## 7. Error and warning codes (add to `src/imports/errors.ts` style)

Errors: `SCOPE_INVALID`, `GHG_CATEGORY_INVALID`, `GHG_CATEGORY_REQUIRED` (Scope 3 category with no number, after the backfill is confirmed), `EXCLUSION_REASON_REQUIRED`, `UNIT_REQUIRED` (a factor with no unit), `METHOD_NOT_ALLOWED`, `CURRENCY_NOT_SUPPORTED`, `SUPPLIER_FACTOR_BOUNDARY`, `PERIOD_LOCKED`, `UNLOCK_REASON_REQUIRED`, `NOT_DRAFT`, `EXTRAPOLATION_BASIS_INVALID`, `PERIOD_INCOMPLETE`, `BASE_YEAR_NO_DATA`, `RECALCULATION_REASON_REQUIRED`, `REVIEW_WORKFLOW_OFF` (S3-15 part 2: lock or "Nothing this month" for a client without review workflow v2).
Warnings (never block): `FACTOR_FALLBACK_YEAR` (now on typed entries too), `FACTOR_TYPE_MISMATCH`, `FERA_FACTOR_MISSING`, `WTT_ALREADY_IN_FACTOR`, `FX_RATE_FALLBACK`, `NO_DEFLATOR`, `DEFLATOR_FALLBACK_YEAR` (spend year with no index yet: the latest earlier index was used), `ESTIMATED_DISTANCE`, `TRANSPORT_PAID_BY_MISMATCH`.

## 8. Review check ids (S3-15, `review/checks.ts`)

`FACTOR_FOUND`, `UNIT_OK`, `EVIDENCE_ATTACHED`, `WITHIN_THRESHOLD` (company `emission_threshold`, vs previous month same site/category/activity), `NO_DUPLICATE`, `IMPORT_MATCH_SURE` (smart import ≥ 80 %), `METHOD_GIVEN` (Scope 3 only; the method set by the form or the import, never asked of a User), `DQ_ACCEPTABLE` (overall ≤ 2 or a note). Ready = all pass. The UI shows a fixed label per id (`src/lib/scope3/checks.ts`).

## 9. Golden cases (`ci/golden/scope3/cases.json`, S3-0)

Each case: `{id, guidance_ref, category, method, inputs, factors, expected_kgco2e}`. These are the worked examples of the guidance that ESGLite will support, at least: Example 1.1 (supplier-specific), 1.2/1.3 (hybrid), 1.4 (average-data), 1.5 (spend), 3.x (upstream fuels, T&D losses), 4.2 (distance), 4.4 (spend transport), 4.6 (average distribution), 5.1/5.2 (waste), 6.1 (travel distance), 7.x (commuting), 11.x (use phase), 12.x (end of life), 15.x (equity investment), plus 4.1, 4.5, 8.1, 9.1, 10.1, 10.2, 13.1, 14.1, 14.2, one constructed proxy case and one report-level case. Two printed results are off: Example 8.1 prints 1,325 kg but the exact maths gives 1,320 kg (the guidance rounded the refrigerant), so store 1,320 with a note; Example 15.2 says "tonnes" but its factors are kg/$, so the result is kg. S3-0 transcribes them from the guidance PDF text, with page refs. Each method module turns its own cases from `skip` to `run`.

**As built by S3-0:** the cases come from this section and the module specs' "Golden cases" sections (their line refs). Every case has figures: S3-0 (ESG-lite #144) transcribed 1.1–1.5, 5.1 and 5.2 from `reference/scope3-calculation-guidance.txt` (S3-7 had already filled the three Cat 3 cases). Notes on the transcription:
- The guidance has no Example 1.5; formula 1.5 is worked inside Example 1.4, which mixes methods (54,100 kg). `ex-1.4` is its average-data part (42,400 kg), `ex-1.5` its spend part (11,700 kg).
- Example 1.2 prints 20,500 kg for transport and 72,800 kg in total, but its own transport line sums to 205,000, so `ex-1.2` stores the exact 257,300 kg with a note (same rule as 8.1 and 15.2).
- Example 1.3's working line says 50,000 t-shirts; its table and its result use 12,000, so `ex-1.3` uses 12,000 and matches the printed 70,250 kg.
- Example 15.2 stores the exact 2,332,500 kg (the guidance prints 2,242,500 because it writes the investee 4 term as 900,000; Shyam confirmed 2,332,500 on 2026-10-16). Two constructed proxy cases (S3-12) and a report-level case (S3-13, which moves it to `ci/golden/scope3/report.json`). `ci/golden/scope3/run.cjs` fails on more than 0.5 kg or 0.1 % and refuses a `run` case without figures, rows or with an open question.

## 10. Contract additions S3-0 lands before wave 2 (found while writing S3-8 to S3-16)

S3-0 adds these to the sections above in its first PR, so no method module invents them.

**Status (S3-0, ESG-lite #134 and #144):** folded into §2, §4, §5, §6 and §9 above, together with the "S3-0 follow-up" notes in the module specs. Decided by Shyam on 2026-10-16: factor-type lists for Cats 8, 10, 13, 14 and 15 are set in §2 (S3-0's draft from the forms that use them); D13 is confirmed (partner-reported Scope 1+2 is activity × identity factor, calculated by the engine); S3-4 writes `emission.gas_kg` and `biogenic_kg` (§4); ex-15.2 is 2,332,500 kg. Shyam shared the Scope 3 Standard on 2026-10-16 (project files, `scope3/reference/scope3-standard.txt`); S3-13's checklist and S3-11's lease rule are checked against it in review. The bullets below are kept as the record.

- **Engine:** `MethodCalculation` gets `divide` and `method_column: "@method"` (shared by S3-8 to S3-11, not owned by S3-9). `ColumnConfig.method_options` carries a unit list per method.
- **Gases:** `emission.gas_kg` (json, per gas) and `emission.biogenic_kg` (numeric null), filled from the factor's gas parts. Without them the report shows biogenic CO₂ and per-gas totals as "Not tracked".
- **Factor types:** Cat 4/9 also allow `other` (refrigerant GWP). Add allowed-type lists for Cats 8, 10, 13, 14, 15. Partner-reported Scope 1+2 (Cat 8 lessor, 13, 14, 15) is entered as the partner's activity figure with an identity factor (unit `kgco2e`), calculated by the engine and flagged `data_type primary`. This is a figure the partner reported, not a total ESGLite is asked to trust from a client app, so the one-engine rule still holds (D13, confirm).
- **Tables and columns:** `scope3_screening_input`; `nothing_this_month` (site, category, period, user); `site.lease_type` (`finance`, `operating`); `investment` gets revenue, currency, EEIO sector and sector split; `product_sale.period` is a monthly date like `emission.date`; `product.eol_mix` is `[{treatment, share}]` summing to 1; `company_base_year` gets rationale, year type and a snapshot; `recalculation_event` gets status, note, before and after. Company-level rows (Cat 15, franchises) go on the company's head-office site (`company.home_site_id`).
- **Ownership:** `emission.proxy` stays with S3-12; S3-9 stores survey scaling in `extra_data.survey` until then and S3-12 backfills it. `AuditLog.entity_type` (`AuditLog.ts:17`) gains the `scope3_*` values, by S3-0. The Overview "Net emissions" wording goes to S3-13. S3-16's runner is a separate live-stack runner; `ci/golden/scope3/run.cjs` stays S3-0's.
- **Endpoints (§5):** `POST /scope3/commuting/surveys`; `/scope3/product-sales`, `/scope3/products/:id/use-profile`, `/scope3/sold-products/plan`; `/scope3/investments`, `/scope3/investments/plan`; `PUT /scope3/screening/inputs` and a fixed body for `POST /scope3/extrapolate`; AI `/v1/scope3/eeio-sector`; a response shape for `GET /reports/ghg/scope3`. For S3-15: `ready=` filter and `only_ready` on bulk approve, dry-run `POST /user/emissions/check`, `GET /user/emissions/:id/history`, "Nothing this month" write endpoints, and a `draft_submitted` notification kind.
- **Allowed deviations:** S3-8, S3-9 and S3-15 also edit `add-data`; S3-10 adds columns to `Product`. Each lists it under Deviations in its PR.
- **Reference:** the Scope 3 Standard ch. 11 and Appendix A text is not in the reference file. S3-13's checklist and S3-11's lease rule transcribe it; S3-0 checks that against the Standard.
- **Wording:** "registered in `scripts/migrate-all.cjs`" means a `migrate:*` entry in `package.json`, which `migrate-all.cjs` runs.
