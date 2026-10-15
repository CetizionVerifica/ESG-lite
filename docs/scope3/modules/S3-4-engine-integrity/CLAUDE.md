# S3-4 · Engine integrity fixes

> Module spec. Lane L4. Copy it to `ESG-lite/src/services/emissionWrite/S3-4.CLAUDE.md`. PR titles `[S3-4 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on: nothing (it may merge before S3-0; if S3-0 has merged, put the changes in `methods/activity.ts`) · Owns: the null-unit rule in `emissionWrite/units.ts`, `historicalImport.ts`, `seedEmissionsFromExcel.ts`, scope validation in `category.controller.ts`, `emission.total_kgco2e`, the FE Findings fix · Touches: `emissionWrite/resolve.ts` (warnings only), edit paths in `emission.controller.ts`

## Job to be done
Fix the small calculation and reporting faults found in the gap report. These are the quick wins. They make totals trustworthy before the bigger Scope 3 modules build on them.

## Today (each item is one fix)
1. A null unit on either side counts as a match, so a factor with no unit is applied with no check (`ESG-lite/src/services/emissionWrite/units.ts:115-117`).
2. The historical import computes its own totals and falls back to the sheet's figure (`src/services/historicalImport.ts:83-102`). A seed stores sheet totals (`src/seeds/seedEmissionsFromExcel.ts:266-267`). Both break the root rule.
3. The historical upload auto-creates unknown categories as "Scope 1" (`src/controllers/upload.controller.ts:302-308`). Category create and update accept any scope string (`src/controllers/category.controller.ts:71,107-110`).
4. The year fallback is silent on typed entries. Only imports warn (`resolve.ts:64-80`, `index.ts:262`). A missing FERA factor silently yields no Cat 3 row (`resolve.ts:83-89`).
5. The edit paths (`updateEmission`, `managerUpdateEmission`, FERA recalculation) still call `findEmissionFactorForCategory` directly (`src/services/emissionWrite/CLAUDE.md:46`).
6. Totals are rounded to 0.01 t per row, so small rows lose precision (`compute.ts:44-45`).
7. The FE Findings rule "dominates the footprint" compares only S1 vs S2 (`ESG-lite_FE/src/features/ghg-report/logic.ts:423`). The backend PDF uses all three (`src/reporting/ghg.ts:137-141`).
8. GBP, BHD, SAR and AED are offered in the currency dropdown but can't be converted (`src/utils/defaultExtraFields.ts:24`, `units.ts:36-38`). S3-5 fixes the FX source properly. Here, only stop offering currencies that can't convert, or add a static rate row each with `FX_RATE_FALLBACK`.

## Build
### Backend (ESG-lite)
1. `unitsMatchExact`: when the factor's unit is null or empty, return the error `UNIT_REQUIRED` for that row. A null activity unit stays a match only when the form has a single unit.
   - List the staging factors with no unit in the PR, from a read-only query. Fix them via data, not code.
2. **Historical import and seed:** route rows through `planRows/prepareEntry/insertRows`, with channel `historical`. A row whose units don't line up becomes an error row, not the sheet's figure. Unknown categories are rejected with `SCOPE_INVALID`, not created as Scope 1.
3. **Scope validation:** create and update accept only `'Scope 1' | 'Scope 2' | 'Scope 3' | null` (case-insensitive input, normalised on save). `migrate:scope3-scope-normalise` normalises existing values ("scope3", "S3", "Scope-3" → "Scope 3") and lists anything else for Shyam.
4. **Warnings:** `FACTOR_FALLBACK_YEAR` and `FERA_FACTOR_MISSING` are returned on typed entries too. The FE shows them on the result line.
5. **Edit paths:** call `computeRow` (or `prepareEntry` for one row), so edits use the same resolution, snapshot and FERA logic.
6. `emission.total_kgco2e numeric(18,4)` is written on every insert and update (D5). Backfill = `total_emission × 1000` for old rows, marked `dq.source` untouched.

### Frontend (ESG-lite_FE)
1. `ghg-report/logic.ts`: the dominant-scope finding uses the largest of S1, S2 and S3, with the matching label "Scope 3 (value chain)". The recommended actions add "Engage the largest suppliers for their own emissions data" when S3 is dominant. Unit test it.
2. **Add data result line:** show the fallback-year and missing-FERA warnings.
3. **Currency select:** offer only the currencies the API reports as convertible (`GET /units?kind=currency`, existing units endpoint, or a static list until S3-5).

### AI service
None.

## Golden cases
`ci/golden` must stay unchanged, except that rows whose factor has no unit now fail. List them. Expected: none in the golden fixture.

## Tests
- API: the `UNIT_REQUIRED` row error, the historical import through the engine (one golden row re-imported gives the same total), scope validation codes, and the normalisation migration run twice.
- FE unit: the dominant-scope rule with S3 largest.

## Out of scope
FX sources and inflation (S3-5). Changing rounding in reports (S3-13, D5).

## Done when
- No write path computes a total outside `emissionWrite`. `grep` for `calculatedEmission` writes returns nothing.
- Every category's scope is one of the four values.
- The Findings rule can name Scope 3.
- Edits go through the engine.
