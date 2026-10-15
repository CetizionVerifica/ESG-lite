# S3-2 · Emission factor metadata

> Module spec. Lane L2. Copy it to `ESG-lite_FE/src/features/emission-factors/CLAUDE.md` (append it under "## S3-2") and to `ESG-lite/src/scope3/contracts/factor.CLAUDE.md`. PR titles `[S3-2 k/m] …` (backend, FE, AI service).
> Depends on (merged): S3-0 · Owns: `EmissionFactor` S3 columns, factor upload/edit/export, FE `emission-factors/*`, AI `excel_parser.py` sub-columns · Touches: `emissionWrite` snapshot builder

## Job to be done
Every factor records what kind of factor it is, which gases and GWP set it covers, where it applies and which dataset version it comes from. A factor's precision is no longer lost on import. WTT and per-gas columns survive the upload.

## Guidance
- Use cradle-to-gate factors for Cat 1/2, upstream-only (WTT) factors for Cat 3, and life-cycle factors for the other energy use in the value chain (Introduction, L1340–1380).
- Cover all 7 Kyoto gases including NF₃, with GWPs on a 100-year basis, and disclose the GWP source (L1381–1402).
- Prefer recognised databases, and check them for technology, time and geography fit (L1404–1418).

## Today
- A factor has only `factor_value decimal(10,4)`, `denominator_unit`, `year`, free-text `source` and the name columns (`ESG-lite/src/entities/EmissionFactor.ts:28-43`).
- The AI importer keeps only the "Total" sub-column (`python_AI_service/app/services/excel_parser.py:418-438`) and rounds to 4 decimals (`:284-300`).
- The FE drawer has only a free-text Source field (`ESG-lite_FE/src/features/emission-factors/components/FactorDrawer.tsx:135-176`).

## Build
### Backend (ESG-lite)
1. `migrate:scope3-factor-meta`: add the §2 columns (all nullable). Widen `factor_value` to `numeric(18,8)`; existing values are unchanged. Backfill `factor_type`:
   - from the category's scope (Scope 1 → combustion, Scope 2 → combustion);
   - from FERA categories → wtt;
   - from Scope 3 names → by `ghgCategory` map (Cat 1/2 with a currency unit → eeio_spend, otherwise cradle_to_gate; transport → life_cycle);
   - otherwise `other`.
   
   Set `includes_wtt = true` where the source text says WTT is included or summed in (for example the freight factors in `docs/emission-factor-sources.md:49-51`).

   Backfill `gwp_set` from the source text when it says "AR4", "AR5" or "AR6", otherwise null. Backfill `dataset` from the source text by keyword (DEFRA/DESNZ, IEA, IPCC, EPA, ecoinvent), otherwise null.
2. Factor create, update and bulk upload accept and validate the new fields with `schemas.ts`.
   - Warn `FACTOR_TYPE_MISMATCH` when the type is outside the allowed list for its category's `ghg_category`.
   - A factor with no `denominator_unit` → `UNIT_REQUIRED`. This complements the S3-4 engine rule.
3. The snapshot builder (`emissionWrite/compute.ts` `snapshotOf`, S3-0's location) adds `factor_type`, `gwp_set`, `geography`, `dataset`, `dataset_version` and the gas parts when present.
4. Export (the XLSX of factors) includes the new columns. `GET /admin/emission-factors` returns them and filters by `factor_type`.

### Frontend (ESG-lite_FE)
1. Factors list: add Type and GWP columns (hidden by default, available in the column picker) and a Type filter chip.
2. Drawer: add Type (select with the plain labels from `src/lib/scope3/labels.ts`), GWP set, Geography (country select plus "Global"), Dataset plus version, and a collapsible "Gas breakdown (optional)" with CO₂, CH₄, N₂O, Other (kg per unit) and Biogenic CO₂.
   - Show a hint when the parts don't add up to the total within 1 %. It's a warning, not a block.
3. Import stepper (P22 2/2): map the new columns when the sheet has them, and show "WTT kept as its own factor" rows in Preview.

### AI service
`excel_parser.py` returns one candidate per sub-column with `factor_type` and gas parts, at full precision as strings (layer rule 2). Remove the 4-dp rounding warning.

## Golden cases
None of the §9 cases. Add a regression case that a 2026 factor of `0.00012345` survives upload and calculation at 8 dp.

## Tests
- API: validation codes, the `FACTOR_TYPE_MISMATCH` warning, tenant isolation on the list filter, and the backfill run twice.
- AI: a pytest sheet with Direct, WTT and Total plus gas columns gives the expected candidates.
- Playwright: edit a factor's type and GWP, then reload.

## Out of scope
- Choosing factors by geography in the engine. That is S3-3 DQ only; factor selection by site stays as it is.
- EEIO-specific fields are used by S3-5.

## Done when
- Every staging factor has a `factor_type`.
- New uploads keep WTT and gas columns.
- Snapshots on new rows carry the type and GWP.
- `ci/golden` is unchanged.
