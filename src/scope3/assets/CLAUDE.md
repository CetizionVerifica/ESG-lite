# S3-11 · Leased assets, franchises, investments (Cat 8, 13, 14, 15)

> Module spec. Lane L5. Copy to `ESG-lite/src/scope3/assets/CLAUDE.md` and `ESG-lite_FE/src/features/scope3/assets/CLAUDE.md` as the first commit. PR titles `[S3-11 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on (merged): S3-1 · Owns: `Site.lease_role`, `src/scope3/assets/*`, `investment` table · Touches: —

## Job to be done
A client that leases buildings or vehicles, leases assets out, runs franchises or holds equity stakes can record them with the simplest method the guidance allows, and a client that has none can confirm "not relevant" with one click (D10).

## Guidance (what the GHG Protocol expects)
- Cat 8: assets the company leases (lessee) that are not in its Scope 1/2 under its consolidation approach; part-year leases count pro rata (L4587-4600). Methods: asset-specific 8.1 (fuel, refrigerant, process + electricity × factors, L4677-4691), non-sub-metered space 8.2: our area ÷ (building area × occupancy) × building energy (L4697-4701), lessor-specific 8.3: lessor Scope 1+2 × our share of area (L4783-4795), average-data 8.4 floor area × kgCO₂e/m²/year and 8.5 number of assets × per-asset factor (L4830-4840).
- Cat 13: assets the company owns and leases out (lessor), same methods as Cat 8; products leased to customers may be reported in Cat 11 instead, never both (L5718-5752).
- Cat 14: franchisors report franchisees' Scope 1+2: franchise-specific 14.1 (L5843-5848), non-sub-metered 14.2 (L5853-5858), sample extrapolation 14.3: sampled emissions × franchises in group ÷ sampled (L5880-5892), average-data 14.4/14.5 (L5941-5953).
- Cat 15: equity investments' proportional Scope 1+2 are required; a disclosed threshold (e.g. 1 % equity share) may exclude small stakes (L6174-6190). Investment-specific 15.1: investee Scope 1+2 × share of equity (L6254-6258). Average-data 15.2: investee revenue × sector EEIO factor × share (L6338-6343); disclose whether the EEIO boundary is Scope 1+2 or all upstream (L6310-6321).
- The consolidation approach decides what is in Cat 8/13 versus Scope 1/2 (L4595-4597; Scope 3 Standard Appendix A, not in the reference text).

## Today (evidence)
- No leased-asset, franchise or investment code exists (`grep -ri "leased\|franchis\|investment" src` finds nothing relevant); none of Cat 8, 13, 14, 15 has a category row.
- `Site` has no lease or floor-area field (`ESG-lite/src/entities/Site.ts:22-41`); `Company` has no ownership or approach field until S3-1 (`src/entities/Company.ts`).
- The report boundary is the hard-coded "Operational control" (`src/reporting/ghg.ts:230, 446`).
- A spec can only multiply and take percentages, no division (`src/services/calculationSpec.ts:143-158`).

## Build
### Backend (ESG-lite)
1. `migrate:scope3-assets`: `site.lease_role`, `site.floor_area_m2`, table `investment` (§4); global categories for 8, 13, 14, 15 (scope 'Scope 3', `ghg_category` set) when S3-1 has not created them. D10 backfill through the S3-1 boundary service: for each company whose Cat 13, 14, 15 rows are still `screening`, set `not_relevant` with reason "No leased-out assets, franchises or investments" and `updated_by` = system, for Admin to confirm. Run twice safely.
   S3-0 follow-ups: `site.lease_type` (`finance`, `operating`) is needed for the boundary rule; `investment` needs `revenue`, `currency`, `eeio_sector` (and a per-sector revenue split) for 15.2.
2. `src/scope3/assets/boundary.ts`: pure `leaseBoundary(lease_role, lease_type, approach)` → `scope12 | cat8 | cat13`: lessee finance lease → scope12; lessee operating lease → scope12 under operational control, cat8 under equity share or financial control; lessor mirror for cat13. Used by `GET /scope3/categories` (S3-1 response) as a per-site note, and by S3-13 for the boundary text. It never moves rows.
3. Category forms (`assets/configs.ts`, seeded on sites that have the category assigned, `migrate:scope3-asset-forms`):
   - Cat 8 / 13 `per_unit`: `litre`, `kwh`, `kg` (refrigerant) → [Building or asset quantity, Your floor area (m²)] ÷ [Building floor area (m²), Occupancy rate (%)] (8.1 + 8.2; area fields = 1 when sub-metered); `kgco2e` → [Lessor's or lessee's Scope 1+2 (kgCO₂e), Your area] ÷ [Their total area] (8.3, 13.1); `m2.year` → [Floor area (m²)] (8.4); `asset.year` → [Number of assets] (8.5). `method_options`: Cat 8 asset_specific, lessor_specific, average_data; Cat 13 asset_specific, lessee_specific, average_data.
   - Cat 14 `per_unit`: `kgco2e` → [Franchise Scope 1 (kgCO₂e)] and a second row for Scope 2, or [Sampled Scope 1+2 (kgCO₂e), Franchises in group] ÷ [Franchises sampled] (14.3, saved `is_estimate`); `m2.year`, `asset.year` as above. `method_options`: franchise_specific, average_data.
   - `÷` uses S3-9's `divide`. If S3-9 has not merged, wait for it (S3-0 follow-up: move `divide` into the S3-0 engine contract).
4. Reported partner emissions (8.3, 13.1, 14.1, 15.1) are activity data with evidence, calculated by the engine with an identity factor "Reported emissions" = 1 kgCO₂e per `kgco2e` (and 1,000 per `tco2e`), `factor_type other`, `dataset reported`. S3-0 follow-up: confirm this reading of "never store a total sent by a client" and add `other` to the allowed factor types for Cat 8, 13, 14, 15 (none are listed in §2).
5. `src/scope3/assets/` router (`router.use` in `src/scope3/router.ts`): `GET/POST/PUT /scope3/investments` (Admin and Superadmin; Manager read) and `POST /scope3/investments/plan {site_id, year, year_type}` → an import plan (channel Bulk upload) with one yearly Cat 15 row per investment: investment_specific → [Investee Scope 1+2 (tCO₂e), Share of equity (%)] with the identity factor; average_data → [Investee revenue, Share of revenue in sector (%), Share of equity (%)] through S3-5 `spend.ts` with the sector's `eeio_spend` factor. Investments below the company's disclosed threshold are listed, not planned. S3-0 follow-up: add these endpoints to §5; and company-level rows need a home site (here: the `site_id` the caller picks).
6. Audit log rows (`scope3_investment`) on create and update; logs carry ids only.

### Frontend (ESG-lite_FE)
1. `src/features/scope3/assets/` (route `/settings/scope3/investments`, registered in `features/scope3/routes.tsx`): investments register (DataTable: investee, type, share %, Scope 1+2 tCO₂e or revenue and sector, year, source) with an edit drawer, a threshold note, and "Create Category 15 plan". Empty state links to the boundary page ("Not relevant? Confirm it on Scope 3 boundary").
2. Sites form (`src/features/sites`): "Lease" section (None / We lease it / We lease it out / Franchise; lease type; floor area m²) with the live note from `leaseBoundary`, e.g. "With financial control, this site's energy belongs in Category 8." Not in §4: list under "Deviations".
3. Boundary page rows 13, 14, 15 (S3-1 page, data only): the D10 reason shows as written with "Confirm".
4. `src/lib/emissions/emissionCalc.ts`: new unit keys (`kgco2e`, `tco2e`, `m2.year`, `asset.year`).

### AI service
None.

## Golden cases
Turn to `run` (owner S3-11); S3-0 follow-up to add every case except 15.x:
- ex-8.1: gas 1,500 kWh × 0.2, electricity 3,000 × 0.7, refrigerant 5 kg × 1,500, each × 200 ÷ (2,000 × 75 %) → **1,320** exact (L4702-4755). The guidance prints 1,325 because it rounds the refrigerant to 0.67 kg; record 1,320 with that note (S3-0 follow-up: correct the transcribed value).
- ex-13.1: 9,000 kgCO₂e × 5,000 ÷ 15,000 → **3,000** (L5754-5774).
- ex-14.1: (100,000 + 20,000) + (25,000 + 10,000) + (30,000 + 10,000) + (90,000 + 30,000) + (30,000 + 10,000) → **355,000** (L5893-5907).
- ex-14.2: 100 × 30,000 + 150 × 30,000 + 400 × 10,000 + 700 × 10,000 + 500 × 10,000 → **23,500,000** (L5955-5970).
- ex-15.1: 120,000 t × 40 % + 200,000 × 15 % + 1,600,000 × 25 % + 60,000 × 25 % → **493,000,000** kg (493,000 t, L6258-6290).
- ex-15.2: (3,000,000 × 0.6) × 5 % + (7,500,000 × 0.5) × 15 % + (1,150,000 × 3) × 20 % + (5,500,000 × 60 % × 2 + 5,500,000 × 40 % × 1.5) × 10 % → **2,242,500** kg (L6347-6393; printed as "tonnes" but the factors are kgCO₂e/$). Runs once S3-5 `spend.ts` is merged.

## Tests
- API (`ci/api/tests/s3-11-assets.test.cjs`): investments and plan with company 2 token on company 1 ids → 404; Manager PUT → 403; `leaseBoundary` matrix (2 roles × 2 lease types × 3 approaches); D10 backfill twice; plan rows carry no total.
- Unit: configs map every option chain; identity factor rows.
- Playwright (`e2e/scope3-investments.spec.ts`): add a 25 % equity investment with 60,000 tCO₂e, create the plan, preview shows 15,000 tCO₂e.

## Out of scope
Project finance and debt (15.3-15.5), managed investments, PCAF. Moving Scope 1/2 rows of leased sites automatically. Life-cycle emissions of building leased assets.

## Done when
- Cat 8, 13, 14, 15 have forms and categories; every company has a D10 default on 13-15 for Admin to confirm.
- Investments can be registered and planned into Cat 15 rows.
- The six golden cases run green (15.2 after S3-5); `ci/golden` unchanged.
