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
- Cat 4/6/7/9: `life_cycle`, `combustion`, `eeio_spend`.
- Cat 5/12: `process`, `life_cycle`.
- Cat 11: `combustion`, `other`.

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
| `company_scope3_category` | id, company_id, ghg_category, status (`included`, `excluded`, `not_relevant`, `screening`), reason text (required unless included), method_note text, relevance jsonb (Table II criteria ticks), updated_by, updated_at; unique (company_id, ghg_category) | S3-1 |
| `category_ghg_map_proposal` | category_id, company_id, proposed ghg_category, confidence, confirmed_by/at | S3-1 backfill |
| `emission_factors.*` | §2 fields | S3-2 |
| `emission.method` | varchar null (`Method`) | S3-3 |
| `emission.dq` | jsonb null (`Dq`) | S3-3 |
| `emission.data_type` | varchar null | S3-3 |
| `emission.is_estimate` | boolean default false | S3-3 |
| `emission.total_kgco2e` | numeric(18,4) null (written beside `total_emission`) | S3-4 |
| `emission.fx` | jsonb null `{currency, rate, as_of, source}` | S3-5 |
| `fx_rate` | currency, date, rate_to_usd, source; unique (currency, date) | S3-5 |
| `price_deflator` | country, year, index (base 100 = dataset base year), source | S3-5 |
| `supplier` | supplier_id, company_id, name, country, email null, created_by; unique (company_id, lower(name)) | S3-6 |
| `emission.supplier_id` | int null FK supplier | S3-6 |
| `supplier_factor` | id, company_id, supplier_id, item, unit, kgco2e_per_unit, boundary (`cradle_to_gate`), reference_year, gwp_set, evidence_document_id, source (`supplier_request`, `manual`), material_factor_id null | S3-6 |
| `supplier_facility_data` (hybrid) | id, company_id, supplier_id, year, scope12_tco2e, output_qty, output_unit, allocation_key | S3-6 |
| `emission.scope3_sub` | varchar null (`Scope3Sub`) | S3-7 |
| `site.lease_role` | varchar null (`lessee`, `lessor`, `franchisee`, `franchisor`) + `floor_area_m2` | S3-11 |
| `investment` | id, company_id, investee, type (`equity`, `debt`, `project`), share_pct, investee_scope12_tco2e, year, source | S3-11 |
| `product_sale` | id, company_id, product_id, period, quantity, unit, region | S3-10 |
| `product.lifetime_uses`, `product.eol_mix` jsonb | null | S3-10 |
| `emission.proxy` | jsonb null `{basis, coverage_pct, from}` | S3-12 |
| `company_base_year` | company_id, base_year, scope, significance_pct default 5, policy_note | S3-14 |
| `recalculation_event` | id, company_id, reason (`methodology`, `data_quality`, `structural`, `error`), affected_years, delta_tco2e, approved_by, created_at | S3-14 |
| `emission.status` | adds `draft`. It is a Postgres enum (`Emission.ts:15-19,42-47`), so the migration runs `ALTER TYPE … ADD VALUE 'draft'` outside a transaction | S3-15 |
| `emission.checks` | jsonb null `{ready: bool, held: CheckId[]}` | S3-15 |
| `period_lock` | company_id, site_id null, year, month null, locked_by, locked_at, reopened_by/at/reason | S3-15 |
| `company.review_workflow_v2` | boolean default false | S3-15 |

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
| `GET /scope3/screening?year=` | S3-12 | estimate per category and suggested status |
| `POST /scope3/extrapolate` | S3-12 | creates proxy rows, Pending |
| `GET /reports/ghg/scope3?…` | S3-13 | same filters as the GHG report |
| `GET/PUT /scope3/base-year`, `GET/POST /scope3/recalculations` | S3-14 | |
| `POST /user/emissions/submit` `{ids}` | S3-15 | draft → pending, runs the checks |
| `GET/POST /periods/lock`, `POST /periods/unlock` `{reason}` | S3-15 | Manager+ for own sites |

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
The method is chosen by the row's `method` field. When it's missing, by the form's `method_options[0]`. Otherwise `activity`.

## 7. Error and warning codes (add to `src/imports/errors.ts` style)

Errors: `SCOPE_INVALID`, `GHG_CATEGORY_INVALID`, `GHG_CATEGORY_REQUIRED` (Scope 3 category with no number, after the backfill is confirmed), `EXCLUSION_REASON_REQUIRED`, `UNIT_REQUIRED` (a factor with no unit), `METHOD_NOT_ALLOWED`, `CURRENCY_NOT_SUPPORTED`, `SUPPLIER_FACTOR_BOUNDARY`, `PERIOD_LOCKED`, `UNLOCK_REASON_REQUIRED`, `NOT_DRAFT`, `EXTRAPOLATION_BASIS_INVALID`, `PERIOD_INCOMPLETE`, `BASE_YEAR_NO_DATA`, `RECALCULATION_REASON_REQUIRED`.
Warnings (never block): `FACTOR_FALLBACK_YEAR` (now on typed entries too), `FACTOR_TYPE_MISMATCH`, `FERA_FACTOR_MISSING`, `WTT_ALREADY_IN_FACTOR`, `FX_RATE_FALLBACK`, `NO_DEFLATOR`, `ESTIMATED_DISTANCE`, `TRANSPORT_PAID_BY_MISMATCH`.

## 8. Review check ids (S3-15, `review/checks.ts`)

`FACTOR_FOUND`, `UNIT_OK`, `EVIDENCE_ATTACHED`, `WITHIN_THRESHOLD` (company `emission_threshold`, vs previous month same site/category/activity), `NO_DUPLICATE`, `IMPORT_MATCH_SURE` (smart import ≥ 80 %), `METHOD_GIVEN` (Scope 3 only), `DQ_ACCEPTABLE` (overall ≤ 2 or a note). Ready = all pass. The UI shows a fixed label per id (`src/lib/scope3/checks.ts`).

## 9. Golden cases (`ci/golden/scope3/cases.json`, S3-0)

Each case: `{id, guidance_ref, category, method, inputs, factors, expected_kgco2e}`. These are the worked examples of the guidance that ESGLite will support, at least: Example 1.1 (supplier-specific), 1.2/1.3 (hybrid), 1.4 (average-data), 1.5 (spend), 3.x (upstream fuels, T&D losses), 4.2 (distance), 4.4 (spend transport), 4.6 (average distribution), 5.1/5.2 (waste), 6.1 (travel distance), 7.x (commuting), 11.x (use phase), 12.x (end of life), 15.x (equity investment), plus 4.1, 4.5, 8.1, 9.1, 10.1, 10.2, 13.1, 14.1, 14.2, one constructed proxy case and one report-level case. Two printed results are off: Example 8.1 prints 1,325 kg but the exact maths gives 1,320 kg (the guidance rounded the refrigerant), so store 1,320 with a note; Example 15.2 says "tonnes" but its factors are kg/$, so the result is kg. S3-0 transcribes them from the guidance PDF text, with page refs. Each method module turns its own cases from `skip` to `run`.

## 10. Contract additions S3-0 lands before wave 2 (found while writing S3-8 to S3-16)

S3-0 adds these to the sections above in its first PR, so no method module invents them.

- **Engine:** `MethodCalculation` gets `divide` and `method_column: "@method"` (shared by S3-8 to S3-11, not owned by S3-9). `ColumnConfig.method_options` carries a unit list per method.
- **Gases:** `emission.gas_kg` (json, per gas) and `emission.biogenic_kg` (numeric null), filled from the factor's gas parts. Without them the report shows biogenic CO₂ and per-gas totals as "Not tracked".
- **Factor types:** Cat 4/9 also allow `other` (refrigerant GWP). Add allowed-type lists for Cats 8, 10, 13, 14, 15. Partner-reported Scope 1+2 (Cat 8 lessor, 13, 14, 15) is entered as the partner's activity figure with an identity factor (unit `kgco2e`), calculated by the engine and flagged `data_type primary`. This is a figure the partner reported, not a total ESGLite is asked to trust from a client app, so the one-engine rule still holds (D13, confirm).
- **Tables and columns:** `scope3_screening_input`; `nothing_this_month` (site, category, period, user); `site.lease_type` (`finance`, `operating`); `investment` gets revenue, currency, EEIO sector and sector split; `product_sale.period` is a monthly date like `emission.date`; `product.eol_mix` is `[{treatment, share}]` summing to 1; `company_base_year` gets rationale, year type and a snapshot; `recalculation_event` gets status, note, before and after. Company-level rows (Cat 15, franchises) go on the company's head-office site (`company.home_site_id`).
- **Ownership:** `emission.proxy` stays with S3-12; S3-9 stores survey scaling in `extra_data.survey` until then and S3-12 backfills it. `AuditLog.entity_type` (`AuditLog.ts:17`) gains the `scope3_*` values, by S3-0. The Overview "Net emissions" wording goes to S3-13. S3-16's runner is a separate live-stack runner; `ci/golden/scope3/run.cjs` stays S3-0's.
- **Endpoints (§5):** `POST /scope3/commuting/surveys`; `/scope3/product-sales`, `/scope3/products/:id/use-profile`, `/scope3/sold-products/plan`; `/scope3/investments`, `/scope3/investments/plan`; `PUT /scope3/screening/inputs` and a fixed body for `POST /scope3/extrapolate`; AI `/v1/scope3/eeio-sector`; a response shape for `GET /reports/ghg/scope3`. For S3-15: `ready=` filter and `only_ready` on bulk approve, dry-run `POST /user/emissions/check`, `GET /user/emissions/:id/history`, "Nothing this month" write endpoints, and a `draft_submitted` notification kind.
- **Allowed deviations:** S3-8, S3-9 and S3-15 also edit `add-data`; S3-10 adds columns to `Product`. Each lists it under Deviations in its PR.
- **Reference:** the Scope 3 Standard ch. 11 and Appendix A text is not in the reference file. S3-13's checklist and S3-11's lease rule transcribe it; S3-0 checks that against the Standard.
- **Wording:** "registered in `scripts/migrate-all.cjs`" means a `migrate:*` entry in `package.json`, which `migrate-all.cjs` runs.
