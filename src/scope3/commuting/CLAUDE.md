# S3-9 · Business travel and employee commuting (Cat 6, 7)

> Module spec. Lane L4. Copy to `ESG-lite/src/scope3/commuting/CLAUDE.md` as the first commit. PR titles `[S3-9 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on (merged): S3-3 · Owns: travel and commuting configs, `src/scope3/commuting/*` (survey import, extrapolation) · Touches: `calculationSpec.ts`

## Job to be done
A contributor records trips (air, rail, car, hotel nights) by distance, fuel or spend, and a manager loads one commuting survey a year that ESGLite scales to all staff, or uses headcount × national averages when there is no survey.

## Guidance (what the GHG Protocol expects)
- Cat 6 is travel in vehicles not owned or operated by the company; company cars are Scope 1/2, leased cars Cat 8, commuting Cat 7. Hotel stays optional (L4116-4133).
- Formula 6.1: Σ distance by vehicle type (vehicle-km or passenger-km) × factor + optional Σ hotel nights × hotel factor (L4246-4254). Spend-based as Cat 4 (L4323-4327). Fuel-based as Cat 4 (L4176-4195).
- Air factors: any radiative-forcing multiplier must be disclosed (L4218, L4408).
- Travel and commuting data may be extrapolated from a representative sample of employees (L4231-4236, L4421-4425, Appendix A L6695).
- Cat 7 methods: fuel-based, distance-based (survey), average-data (L4346-4355). Formula 7.1: one-way km × 2 × commuting days, summed by mode, × factor; teleworking energy optional (L4426-4440, L4449-4452). Formula 7.2: employees × % by mode × one-way km × 2 × working days × factor (L4532-4538).

## Today (evidence)
- Business travel (id 15) and Employee commuting (id 16) are plain one-value forms; extra fields are vehicle, passengers, points, employees, vehicles (`ESG-lite/src/utils/defaultExtraFields.ts:72-88`).
- The FE builds "passenger.km" as count × distance into one column before save (`ESG-lite_FE/src/features/add-data/logic/distance.ts:15-48`); the server picks one value heuristically (`src/services/emissionWrite/compute.ts:77-79`).
- No hotel, cabin class, radiative-forcing choice, survey, headcount model or extrapolation exists (`grep -ri hotel src` has no hits).
- `MethodCalculation` can only multiply and take percentages (`src/entities/ColumnConfig.ts:42-46`, `src/services/calculationSpec.ts:117-161`).

## Build
### Backend (ESG-lite)
1. `calculationSpec.ts` + `ColumnConfig.ts` (`MethodCalculation`): add `divide?: string[]` (each > 0; a field also listed in `percent` divides by value/100) and `method_column: "@method"` meaning "the row's `method` (S3-3) picks the field set". Unit tests for both. S3-0 follow-up: `divide` is wanted by S3-8, S3-10 and S3-11 as well; record it in `01-contracts.md` §6.
2. Business travel config (`src/scope3/commuting/configs.ts`, applied to every site with `ghg_category = 6`): `per_unit` spec
   - `passenger.km` → [Travellers, Distance (km)]; `vehicle.km` → [Travellers, Distance (km)] ÷ [Travellers per vehicle] (6.1 road);
   - `night` → [Rooms, Nights] (hotel); `litre` → [Fuel used (litres)] (fuel_based); spend via S3-5.
   - `legacy_field` = the site's current numeric column, so old rows keep their stored product.
   - Selects: Mode (Air, Rail, Bus, Taxi, Rental or own car, Hotel) → class (Air: Domestic / Short haul / Long haul × Economy / Premium economy / Business / First) → "Radiative forcing" (With RF / Without RF, default With RF) mapping to the dataset's with-RF and without-RF factor names. `method_options`: distance_based, fuel_based, spend_based.
3. Commuting config (`ghg_category = 7`): `per_method`, `method_column: "@method"`
   - distance_based → [Total distance (km)] × [Total employees] ÷ [Employees surveyed];
   - average_data → [Total employees, Share using this mode (%), One-way distance (km), Trips per day, Working days per year];
   - fuel_based → [Fuel used (litres)]. `method_options`: distance_based, average_data, fuel_based.
   Rows that are scaled (surveyed < total) are saved with `is_estimate = true`.
4. `src/scope3/commuting/survey.ts` + route `POST /scope3/commuting/surveys` (S3-0 follow-up: add to §5): body `{site_id, year, year_type, total_employees, responses: [{ref, mode, one_way_km, days_per_week, weeks_per_year}]}` (≤ 20,000 responses; `ref` is the client's own code, never a name). It sums `one_way_km × 2 × days_per_week × weeks_per_year` per mode and creates an import plan through `src/imports` (one yearly row per mode, channel Bulk upload, fields from step 3) for the normal plan → commit review. Nothing calculates here; the engine does. Responses are not stored; the plan row keeps `{respondents, total_employees}` in `extra_data.survey`. Roles: Manager+ on own sites; Superadmin passes `company_id`.
5. S3-0 follow-up: survey scaling is an extrapolation; `emission.proxy` (S3-12) should record `{basis: "sample", coverage_pct}`. Until S3-12 merges, store the same object in `extra_data.survey` and let S3-12 backfill.
6. Seed (`migrate:scope3-travel` in `package.json`): configs, units (`passenger.km`, `vehicle.km`, `night`, `litre`), factor rows only where missing, read from `src/scope3/commuting/factors.json` (DEFRA 2025 business travel, hotel stay and commuting modes, with RF and without RF, `factor_type life_cycle`, `gwp_set` per S3-2). Idempotent; like S3-8 it never overwrites a config a Superadmin has customised (version marker in `calculation`).

### Frontend (ESG-lite_FE)
1. `src/lib/emissions/emissionCalc.ts`: mirror `divide` and `@method` so previews match; unit tests.
2. `src/features/add-data`: Cat 6 copy under the mode select: "Company-owned cars go in Scope 1 (fuel); leased cars in Category 8." A "Trip calculator" for commuting distance_based writes Total distance from one-way km × 2 × days × people (activity prep only, like the distance drawer). Listed under "Deviations" (add-data is not in §4 for S3-9).
3. `src/features/scope3/commuting/` (route `/settings/scope3/commuting`, Manager+): upload a CSV/XLSX survey with the template download (columns ref, mode, one-way km, days per week, weeks per year), site and year pickers, total employees, then a preview table by mode (respondents, total km, "scaled × 4.0 to 4,000 employees") and "Create import plan", which hands off to the existing plan review. Loading, empty, error states; 390 px layout stacks the preview.
4. Capture setup `CalcTab.tsx`: "Divide by" chips next to multiply, and a "Row's method" choice for `method_column`.

### AI service
None.

## Golden cases
Turn to `run` (owner S3-9):
- ex-6.1 distance: road 10/2 × 50 × 1 + 20/2 × 200 × 2 + 100/3 × 100 × 4 (vehicle-km), air 10 × 10,000 × 5 + 20 × 15,000 × 6 + 100 × 12,000 × 5 (passenger-km) → **8,317,583.33** (L4258-4321).
- ex-7.1 survey: A rail 5×/wk 10 km; B rail 4×/wk 10 km, car 1×/wk 15 km; C car 5×/wk 20 km; 48 weeks; rail 0.1, car 0.2 → rail 8,640 km, car 11,040 km → **3,072** (L4454-4495). Run it through the survey path, not just the form.
- ex-7.2 average: 10,000 employees × (50 % rail 10 km × 0.1, 30 % car 15 km × 0.2, 5 % bus 5 km × 0.1) × 2 × 235 days → **6,697,500** (L4542-4581; the foot row has factor 0 and is skipped).

## Tests
- API (`ci/api/tests/s3-9-travel-commuting.test.cjs`): survey endpoint as Manager (own site), User (403), company 2 token on company 1 site (404); > 20,000 responses → 400; a response with a name-like `ref` is still never logged; `divide` by 0 → `FIELD_REQUIRED`; legacy Cat 6 rows recompute to the same total.
- `ci/golden` unchanged; unit tests for `divide`, `@method`, survey aggregation.
- Playwright (`e2e/scope3-commuting.spec.ts`): upload the 3-person sample from 7.1, preview shows rail 8,640 km and car 11,040 km, plan created.

## Out of scope
Teleworking energy (optional in the guidance; later follow-up). Spend maths (S3-5). Expense-system integrations. Storing individual survey answers.

## Done when
- Cat 6 records air with class and RF choice, rail, car by vehicle-km with occupancy, and hotel nights.
- A commuting survey becomes one reviewed import plan per site and year, scaled to headcount and marked estimated.
- The three golden cases run green and existing totals are unchanged.

## As built (S3-9 1/2, ESG-lite, 2026-10-15)
- **Engine (`src/services/calculationSpec.ts`).** `divide` was already in place (S3-11 built it ahead of this module); S3-9 owns it now: comments and unit tests here, nothing changed in its maths. New: `ROW_METHOD_COLUMN = "@method"`. With `method_column: "@method"` the row's method picks the field set: `resolveSpecMethod` / `computeSpecActivityValue` take an optional `rowMethod` (passed by `methods/spec.ts` from `EngineRow.method`); until S3-3 gives rows a `method`, the method travels in `activity_data["@method"]` (the add-data form and the survey plan write it). Errors: "Please choose a calculation method." / "The method "x" is not configured for this category (expected one of: …)" → `FIELD_INVALID`; divide by 0 → `FIELD_REQUIRED`.
- **Forms (`configs.ts`, `forms.ts`).** Category 6 "Scope 3 travel - Standard - Business travel": selects Trip mode → Trip class → Radiative forcing (dependent options only on air classes; With RF first), text Trip ref (duplicate identity), numbers Travellers, Distance (km), Travellers per vehicle, Rooms, Nights, Fuel used (litres); per_unit `passenger.km`, `vehicle.km` (÷ Travellers per vehicle), `night`, `litre`; `legacy_field` Distance (km). Category 7 "… - Employee commuting": select Commuting mode; per_method `@method`: distance_based, average_data (share as percent), fuel_based. Air classes follow what DEFRA publishes (domestic average; short haul economy/business; long haul economy/premium/business/first), not the full 3 × 4 grid. Config marker `calculation.standard = "scope3-travel@1"`; a config with another name and no marker is the client's and is never touched.
- **Factors (`factors.ts`, not factors.json: tsc ships no JSON).** Every factor name the forms map to, DEFRA, life_cycle, AR5, GB (hotels per country). **Values (2026-10-16):** DEFRA 2025 condensed set v1, uploaded by Shyam, one 2025 value per name with its `tab!cell`. Flights use the "to/from UK" rows, cars the "Average car" row by fuel, fuel the forecourt "average biofuel blend" litres, hotels the country's room-per-night row. The seed adds a factor only where the site × category has none of that name and year, so re-running `migrate:scope3-travel` fills standard forms that have none; customised forms are left alone. For a new DEFRA year, add another entry per year.
- **Survey (`survey.ts`, `schemas.ts`).** `POST /scope3/commuting/surveys`, Manager, Admin, Superadmin (`company_id`); the site must be the caller's (404 otherwise) and have a Category 7 (`CATEGORY_7_NOT_ASSIGNED`); more respondents than `total_employees` → `FEWER_EMPLOYEES_THAN_RESPONDENTS`; a customised commuting form → `COMMUTING_FORM_CUSTOMISED`. Modes are matched to the form's labels (aliases such as train, tube, car, EV); walking and cycling are skipped as zero-emission, a mode with 0 km as `no_distance`, an unknown mode is planned as written and shows as an unknown activity in the plan review. Respondents = distinct refs (an empty ref counts by position). Response: `{plan, summary: {respondents, total_employees, scale, coverage_pct, modes, skipped}}`; 201 with a plan, 200 when nothing was planned. Validation details carry paths and codes, never values. `schemas.ts` is a stand-in for S3-0 #144's `CommutingSurveyBodySchema`.
- **Survey scaling on the row.** `ImportRow.survey` (`src/imports/contracts.ts`, `{basis: "sample", respondents, total_employees, coverage_pct}`) is copied by `insertRows` to `extra_data.survey`; S3-12 backfills `emission.proxy` from it.
- **Migration.** `migrate:scope3-travel` (`src/scripts/migrateScope3Travel.ts`): sites with `category.ghg_category` 6 or 7; idempotent, never deletes, logs ids and counts.
- **Waits on S3-3:** `is_estimate = true` on survey rows with coverage < 100 %, writing `method_options` (configs.ts `METHOD_OPTIONS`, `UNITS_BY_METHOD`), and reading the row's `method` column instead of `activity_data["@method"]`. Spend (`spend_based`) waits on S3-5.
- **Tests.** `ci/unit/scope3-travel.test.cjs` (divide, @method, forms, mode matching, aggregation, golden 6.1 / 7.1 via the survey / 7.2 through the forms), `ci/api/tests/s3-9-travel-commuting.test.cjs` (survey roles, tenant isolation, limits, commit with `extra_data.survey`, migration twice, divide by 0, legacy Cat 6 row). Golden ex-6.1, 7.1, 7.2 set to `run` (stored totals are 2 dp tCO₂e: 8,317,580 and 3,070 kg, within the 0.1 % tolerance).
