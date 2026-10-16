# S3-3 · Method and data quality on every row

> Module spec. Lane L3. Copy it to `ESG-lite/src/scope3/dq/CLAUDE.md` and `ESG-lite_FE/src/lib/scope3/CLAUDE.md`. PR titles `[S3-3 k/m] …`.
> Depends on (merged): S3-0 · Owns: `emission.method/dq/data_type/is_estimate`, `src/scope3/dq/*`, `ColumnConfig.method_options`, FE `src/lib/scope3/dq.ts`, `src/ui/DataQualityBadge` · Touches: `emissionWrite/index.ts`, `src/imports/contracts.ts` (row shape), approvals-ledger drawer, my-entries drawer

## Job to be done
Each emission row records how it was calculated (method) and how good its data is (DQ, primary or secondary, estimated or not). Contributors pick the method in plain words. Managers and reports can see quality at a glance.

## Guidance
- Methods are ranked by specificity, and companies may mix methods within a category (Introduction, L1100–1180).
- Companies are required to describe the methods used per category (L1135).
- Data quality indicators cover technology, time, geography, completeness and reliability (Scope 3 Standard §7.3; guidance L1402–1418). Prioritise improving activities with low quality and high emissions.
- Primary data comes from specific activities in the value chain, and secondary data is everything else (Table III, L1283–1300).

## Today
- Every row is `activity × factor / 1000` with no method recorded (`ESG-lite/src/services/emissionWrite/compute.ts:44-45`).
- No row has a DQ, primary or secondary flag. The full model exists only in PCF (`src/pcf/engine/computePcf.ts:16-20,205-232`).
- The distance "Estimate" badge isn't saved (`ESG-lite_FE/src/features/add-data/components/distance/DistanceDrawer.tsx:114`).

## Build
### Backend (ESG-lite)
1. `migrate:scope3-row-quality` adds `emission.method`, `dq`, `data_type`, `is_estimate`, and `column_config.method_options jsonb null`: the methods allowed for that form, most specific first, each with the units it offers (`[{method, units: string[]}]`). Type the column and validate writes with `MethodOptionsSchema` from `src/scope3/contracts/schemas.ts` (01-contracts.md §6); don't declare a keys-only `string[]`.
   - Backfill `method` for existing Scope 3 rows: spec forms with `per_unit` and tonne.km → `distance_based`, a currency unit → `spend_based`, a Cat 11 spec → `direct_use`, everything else → `average_data`.
   - Scope 1/2 rows get null.
   - DQ backfill uses the §3 auto default with `source: 'auto'`.
2. `src/scope3/dq/defaults.ts` implements the `01-contracts.md` §3 rules as a pure function of `(method, factorSnapshot, site.country, reportingYear, hasEvidence, proxy)`, with unit tests for every rule.
   - The engine's `computeRow` fills `method` (row → form default → `activity`), `dq` (auto unless the row brings a `manual` one) and `data_type`.
   - When evidence is attached after save (`EmissionDocument` create), recompute DQ reliability only. The total is untouched.
3. Accept `method`, `is_estimate` and an optional manual `dq` on typed entries, bulk upload and import plans (`src/imports/contracts.ts` row shape, an IM0-style follow-up in the same PR).
   - A method not in the form's `method_options` → `METHOD_NOT_ALLOWED`.
4. `GET /user/emissions` and the ledger export return `method`, `dq.overall`, `data_type` and `is_estimate`. Filters: `method=`, `dq_max=`.

### Frontend (ESG-lite_FE)
1. `src/lib/scope3/dq.ts` (labels, overall mapping) and `src/ui/DataQualityBadge` (Good / Fair / Poor plus a tooltip with the five indicators; word and glyph, never colour alone).
2. **Capture setup** (`src/features/capture-setup`): the form builder gets a "Methods offered" multi-select, ordered, for Scope 3 categories, prefilled from `ghgCategory` methods.
3. **Add data:** no method picker, method line or "Data quality" line for contributors (simple data entry SE-1/SE-2: the form sets the method, from `method_options` or `method_by_choice`). Save the distance helper's estimate flag as `is_estimate`.
4. Approvals-ledger drawer (reviewers): show a "How it was calculated" line (the method label) and the `DataQualityBadge`. The list gets a DQ column, hidden by default. My entries (Users) shows neither.

### AI service
None.

## Golden cases
None calculate. DQ default unit tests cover every rule in §3.

## Tests
- API: method validation, the backfill run twice, DQ recompute on evidence upload, tenant isolation on the filters.
- Unit: `defaults.ts`.
- Playwright: pick "From the amount spent" on a Cat 1 form and save, then the drawer shows the method and "Poor".

## Out of scope
- The spend, supplier and hybrid calculations themselves (S3-5, S3-6).
- Review checks (S3-15).

## Done when
- New rows always carry a method (Scope 3) and a DQ.
- Old Scope 3 rows are backfilled.
- DQ is visible in the drawers.
