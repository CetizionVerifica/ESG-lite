# S3-12 · Screening, relevance, proxy and extrapolation

> Module spec. Lane L3. Copy to `ESG-lite/src/scope3/screening/CLAUDE.md`, `ESG-lite_FE/src/features/scope3/screening/CLAUDE.md` and `python_AI_service/app/scope3/CLAUDE.md` (append a "S3-12" section) as the first commit. PR titles `[S3-12 k/m] …` (1/3 ESG-lite, 2/3 python_AI_service, 3/3 ESG-lite_FE).
> Depends on (merged): S3-1, S3-5 · Owns: `src/scope3/screening/*`, FE `features/scope3/screening/*`, `Emission.proxy` · Touches: `company_scope3_category.status` (write via S3-1 service)

## Job to be done
An Admin sees a rough size for all 15 categories in one screen (from what is recorded plus cheap spend or headcount estimates), ticks why each matters, accepts or overrides a suggested Included / Excluded / Not relevant status, and fills known gaps with clearly labelled extrapolated rows.

## Guidance (what the GHG Protocol expects)
- Screen all 15 categories first with less specific data, then refine the largest and most relevant (L1122-1150). Rank with Table II: size, influence, risk, stakeholders, outsourcing, sector guidance, spending or revenue analysis, other (L1149-1173).
- Choose methods per activity by size, business goals, data availability, quality and cost; methods can be mixed within a category (L1100-1120, L1176-1188).
- EEIO (spend-based) data is suited to screening; it is sector-average and uncertain (L1340-1360). Investments should be screened with average data first (L6161-6168).
- Proxy data may fill gaps, extrapolated or scaled up, e.g. 80 of 100 facilities via an intensity per unit of output (L1384-1395); sampling per Appendix A (L1396-1399, L6684-6760). Coffee example: data for suppliers covering 85 % of volume extrapolated to 100 % (L1189-1196).
- Proxy and extrapolated data are secondary data (L1289-1291) and must be described in the report (L1382-1383).

## Today (evidence)
- No screening view, relevance criteria or estimate exists (gap report §4.2).
- Sites without data are excluded, not estimated (`ESG-lite/src/reporting/ghg.ts:447`).
- `company_scope3_category.relevance` (jsonb) and `status` arrive with S3-1; spend FX, deflator and USEEIO lookups arrive with S3-5 (`src/scope3/spend/*`).
- No proxy method exists; `compute.ts` has one formula (`ESG-lite/src/services/emissionWrite/compute.ts:44-45`). After S3-0, `methods/proxy.ts` is a stub that falls back to `activity`.

## Build
### Backend (ESG-lite)
1. `migrate:scope3-screening`: `emission.proxy jsonb null` (`{basis, coverage_pct, from}`, §4). S3-0 follow-up: table `scope3_screening_input` (company_id, year, ghg_category, basis `spend|headcount|revenue|mass_sold|other`, amount, currency, eeio_sector, note, updated_by/at; unique per company, year, category, basis), so categories with no rows can still be estimated.
2. `screening/service.ts` → `GET /scope3/screening?year=&year_type=`: 15 rows `{n, status, reason, recorded_tco2e, estimate_tco2e, basis, share_pct, relevance, suggestion: {status, reason}}`.
   - `recorded_tco2e`: Σ `total_kgco2e` / 1000 of approved and pending rows in the year (pending shown separately).
   - `estimate_tco2e`: screening inputs × S3-5 lookups (FX at mid-year, deflator, USEEIO sector factor), or headcount × the Cat 7 average form defaults. Estimates are computed here and never saved as emission rows (layer rule 1 exception).
   - Suggestion rules (`screening/rules.ts`, constants, unit tested; the guidance sets no numeric threshold, so the UI calls them suggestions): categories that make up the top 95 % of the estimated total, or have any Table II tick, → `included`; estimate < 1 % with no tick → `excluded`, reason "Estimated below 1 % of Scope 3 (≈ x tCO₂e by spend screening, 2026)"; no input, no rows, no tick → `not_relevant`, reason "No activity in this category in 2026".
3. `PUT /scope3/screening/inputs` (S3-0 follow-up: add to §5) for the inputs; relevance ticks and "Apply suggestion" go through the S3-1 boundary service (`PUT /scope3/categories/:n`), Admin and Superadmin only (D12), with the suggestion's reason prefilled and editable.
4. `methods/proxy.ts` (owned here) and `POST /scope3/extrapolate`: body `{ghg_category, site_id, year, year_type, basis: "coverage" | "intensity", coverage_pct?, source_filter?, output_site_ids?}` (S3-0 follow-up: fix the body shape in §5).
   - coverage: proxy total = Σ source kg × (100 − coverage_pct) / coverage_pct.
   - intensity: (Σ source kg ÷ Σ approved production at source sites) × production at the sites without data (`ProductionData`).
   - Sources are approved rows of that category and year; proxy rows are never sources. The row is Pending, `method` = most common source method, `data_type secondary`, `is_estimate true`, `proxy = {basis, coverage_pct, from: [ids]}`; S3-3 then scores completeness 3.
   - A second pending proxy for the same category, site, year and basis → row issue `DUPLICATE_EXISTING` with the existing id. S3-0 follow-up: add error `EXTRAPOLATION_BASIS_INVALID` (coverage outside 1-99, no source rows, no production).
5. Backfill S3-9's `extra_data.survey` into `emission.proxy` with basis `sample` (S3-9 step 5). Roles: Manager+ may extrapolate for own sites; read for any role with site access. Audit rows (`scope3_proxy`).

### Frontend (ESG-lite_FE)
1. `src/features/scope3/screening/` (route `/settings/scope3/screening`, Admin and Superadmin edit, Manager read-only; `?year=` in the URL): `PageHeader` "Scope 3 screening", `KpiStrip` (recorded tCO₂e, estimated tCO₂e, included categories n/15, categories with a reason n/15), then a `DataTable` of 15 rows: `Scope3CategoryChip`, recorded, estimate with basis ("Estimate, not saved"), share bar with the number, 8 relevance checkboxes (Table II wording in tooltips), suggestion, current `StatusPill`, "Apply". Row drawer: inputs (basis, amount, currency, sector with "Suggest sector"), and "Extrapolate…" dialog (coverage % or intensity; shows the formula and the sources before creating a Pending row).
2. Proxy rows show an "Extrapolated" badge plus basis in the approvals and my-entries drawers via the shared `src/ui/DataQualityBadge` tooltip (S3-3 owns the badge; data-only change).
3. Loading, empty ("Add a spend figure to estimate this category"), error states; keyboard reachable ticks; 390 px shows a stacked card per category.

### AI service
1. `app/scope3/eeio.py` and `POST /v1/scope3/eeio-sector` (S3-0 follow-up: name the route): input `{lines: [{description, supplier, amount, currency}], sectors: [{code, name}]}` from ESG-lite; output up to 3 `{code, confidence 0-100}` per line. Only the line's own text goes to the model (`OPENROUTER_MAPPING_MODEL`); never a currency guess; logs ids and counts only. ESG-lite asks for confirmation below 80.
2. `category_matcher.py` `ghg_category` hint, if S3-1 did not add it.

## Golden cases
No guidance example has numbers for screening. Unit cases (S3-0 follow-up: add as `intro-proxy`, constructed from L1189-1196): known 850,000 kg at 85 % coverage → proxy **150,000** kg; intensity: 2 sites 1,000 t CO₂e for 500 t output, missing site 250 t output → proxy **500,000** kg.

## Tests
- API (`ci/api/tests/s3-12-screening.test.cjs`): company 2 token on company 1 screening, inputs and extrapolate → 404; Manager apply-suggestion → 403; proxy row never used as a source; duplicate proxy → `DUPLICATE_EXISTING`; estimate never creates an emission row (count before and after).
- Unit: `rules.ts`, coverage and intensity maths in `proxy.ts`; AI: `test_eeio.py` (prompt holds only the line text; low confidence returned as is).
- Playwright (`e2e/scope3-screening.spec.ts`): enter Cat 6 spend, see the estimate, tick "Stakeholders", apply "Included".

## Out of scope
Uncertainty ranges (Appendix B). Choosing a sample. Any automatic status change without an Admin click.

## Done when
- All 15 categories show recorded and estimated sizes for a year, with relevance ticks stored.
- Suggestions can be applied with an editable reason through the boundary service.
- Extrapolated rows are Pending, secondary, estimated, and carry their basis.
- `ci/golden` unchanged.

## As built (S3-12 1/3, 2026-10-16)
Stacked on S3-5 (#154, merged into this branch) for its FX, deflator and USEEIO lookups and the §6 dispatch order. Started by Pavithra (#155: spec copy, `emission.proxy`, `scope3_screening_input`, `migrate:scope3-screening`).
- **Contracts (`[S3-0 follow-up]` commit):** `ProxySchema` = `{basis: coverage | intensity | sample, coverage_pct?, from: number[]}`; `coverage_pct` 1–99 is required for coverage only (optional (0, 100] for the others, so a survey that reached everyone is valid). `PROXY_BASIS_LABELS` gives the plain label per basis; `ghg-scope3.ts` prints it instead of the key.
- **`emissionWrite/methods/proxy.ts`:** coverage = quantity (Σ source kg, factor 1 kgCO₂e per kgCO₂e) × (100 − c) ÷ c; intensity = output at the sites without data × (Σ source kg ÷ Σ output at the sites with data), a synthetic factor in the output unit; sample = the category's own method (the survey form scales it). Rounded at the end only; `data_type: "secondary"`. An invalid proxy is `FIELD_INVALID` on `proxy`. Golden `intro-proxy-coverage` (150,000 kg) and `intro-proxy-intensity` (500,000 kg) run; the coverage case's row is now the known 850,000 kg (the engine scales it), not a pre-scaled share.
- **`screening/rules.ts`:** `TOP_SHARE_PCT` 95, `BELOW_SHARE_PCT` 1. Order: a Table II tick → included ("Relevant: …"); no input, no rows → not_relevant ("No activity in this category in <year>"); an input with no estimate and no rows → screening; inside the top 95 % → included; below 1 % → excluded ("Estimated below 1 % of Scope 3 (≈ x tCO₂e by spend screening, <year>)"); otherwise included. A category is sized by the larger of its recorded and estimated tCO₂e.
- **`screening/estimate.ts`:** spend and revenue: amount × the USEEIO library sector (`eeio_sector` = NAICS code or full library name) through S3-5's `SpendRateSource.quote` (rate at mid-year: 1 July, or 1 October for an April FY) and `methods/spend.compute`, so the maths is the spend method's. Headcount (Category 7 only): employees × 15 km each way × 2 trips × 230 days by average car (DEFRA 2025 0.16725 kgCO₂e per vehicle.km, S3-9's seeded factor). S3-9's average-data form has no defaults, so these constants are S3-12's and the response says what was assumed. mass_sold and other give no estimate. Nothing is saved as a row.
- **`GET /scope3/screening?year=&year_type=`** (any role with access to the company): `sites` (the caller's sites of the company with the GHG numbers each carries, for the Extrapolate dialog) and 15 rows `{n, key, name, direction, status, reason, relevance, recorded_tco2e, pending_tco2e, proxy_tco2e, estimate_tco2e, basis, size_tco2e, size_basis, share_pct, suggestion, inputs[], mapped_categories}` plus `totals` (recorded, pending, estimate, screened, included n/15, with a reason n/15), `can_edit`, `can_extrapolate`. Recorded = approved + pending rows of the company's sites in the year (rejected never).
- **`PUT /scope3/screening/inputs`** (Admin, Superadmin): `{year, year_type?, inputs}`, upserts per (company, year, year_type, category, basis), so CY 2026 and FY 2026 keep separate figures (year_type defaults to CY, as `GET` does); 0 clears a figure without deleting it; a spend or revenue amount needs its currency; at most 75 rows; one `scope3_screening_input` audit row per change with old and new values.
- **`POST /scope3/screening/sector-suggestions`** (Admin, Superadmin; `SectorSuggestionsBodySchema` / `SectorSuggestionsResponseSchema` and `SECTOR_CONFIRM_BELOW` in the contracts, §5 — S3-0 follow-up carried in #169): `{description, supplier?, amount, currency}` → python_AI_service `/v1/scope3/eeio-sector` with the library's `{code, name}` list → up to 3 `{code, name, confidence, needs_confirmation (< 80)}`; `available: false` when the AI service can't answer (never an error).
- **`POST /scope3/extrapolate`** (Manager and above, sites they can access; `?dry_run=1` previews the formula, sources and total without saving): the row is filed under the target site's own category with that GHG number, yearly (CY Dec 31 / FY Mar 31), Pending, `method` (and `@method`) = the most common source method (`emission.method`, else the source's `@method`; ties to the more specific), the S3-3 columns `data_type = "secondary"` (the proxy method file's word wins over the method's default in `computeRow`), `is_estimate = true` and an auto DQ with completeness 3 for the reporting year, `extra_data.extrapolation` (sources, output, formula), `proxy` with the source ids. Sources: approved rows of the GHG category and year with no `proxy` and no `extra_data.survey`; coverage defaults to the target site, intensity to every other site the caller can access (`source_filter.site_ids`, `source_filter.category_ids` narrow them). Intensity needs approved production (`production_data.start_date` in the year) at both sides in one unit, and refuses a site without data that has data. `EXTRAPOLATION_BASIS_INVALID` details carry `reason`: `coverage_pct`, `no_source_rows`, `category_not_on_site`, `output_site_is_source`, `output_site_has_data`, `no_production`, `production_units_differ`. A pending proxy of the same category, site, year and basis → 409 `DUPLICATE_EXISTING` with `details.existing_id` (checked again inside the transaction). Audit: an `emission` row (create) and a `scope3_proxy` row (extrapolate). Period locks are **not checked yet**: `TODO(S3-15·2)` in `extrapolate.ts` refuses a locked site and year with `PERIOD_LOCKED` once S3-15 part 2 brings `period_lock` (decided 2026-10-16: wait for S3-15·2). Mode lock is not applied: a proxy row is yearly by design.
- **Survey rows:** `insertRows` writes `proxy = {basis: "sample", coverage_pct, from: []}` beside `extra_data.survey` from now on; `migrate:scope3-screening` backfills older rows in batches of 1,000 where `proxy` is null (re-runnable).
- **Year type (#169):** `scope3_screening_input.year_type` (`CY` | `FY`, default `CY`) is part of the unique key. `migrate:scope3-screening` adds it nullable, fills older rows in batches with the year type of the company's frozen Scope 3 base year (S3-14) or else `CY` (what the endpoints assume when no year type is named), then sets the default, NOT NULL and the check, creates the new unique index and drops the year-only one (an index, no data). Re-runnable.
- **Boundary:** `RELEVANCE_KEYS` (now in `contracts/schemas.ts`, re-exported by `boundary/service.ts`) gains `spend_analysis` (Table II "spending or revenue analysis"), so the 8 ticks of the spec can be stored through `PUT /scope3/categories/:n`.
- Tests: `ci/unit/scope3-screening-rules.test.cjs`, `ci/unit/scope3-proxy.test.cjs`, `ci/unit/scope3-screening-schema.test.cjs` (Pavithra), `ci/api/tests/s3-12-screening.test.cjs`.
