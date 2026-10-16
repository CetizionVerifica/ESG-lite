# S3-8 · Transport and distribution (Cat 4, 9)

> Module spec. Lane L4. Copy to `ESG-lite/src/scope3/transport/CLAUDE.md` as the first commit. PR titles `[S3-8 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on (merged): S3-3 · Owns: transport and warehousing form configs (`src/scope3/transport/configs.ts`), `src/scripts/seedScope3Transport.ts` · Touches: `calculationSpec.ts` (new units only)

## Job to be done
A contributor records freight and warehousing for Category 4 (what we paid for) and Category 9 (after the sale, not paid by us) with the method they actually have data for: fuel used, weight × distance, warehouse energy, average storage or spend.

## Guidance (what the GHG Protocol expects)
- Cat 4 covers transport and storage of purchased goods and outbound transport the company pays for; Cat 9 only what happens after the point of sale and is not paid by the company (guidance L2677-2702, Table 4.1; L4844-4860, Figure 9.1).
- Fuel-based, formula 4.1: Σ fuel × factor + Σ kWh × grid factor + Σ refrigerant leaked × GWP (L2885-2897). Fuel from spend or distance: 4.2, 4.3 (L2900-2912). Shared vehicle allocation by mass or volume share, 4.4 (L2917-2925). Unladen backhaul optional, 4.5 (L2927-2933).
- Distance-based, formula 4.6: Σ mass × leg distance × mode factor, legs calculated separately (L3239-3247).
- Spend-based, formula 4.7: Σ spend × EEIO factor (L3411-3416).
- Distribution site-specific, formula 4.8: storage-facility energy + refrigerant, allocated by the company's volume share (L3507-3522). Average-data, 4.9: volume × days stored × factor per m³/pallet/TEU per day (L3624-3628).
- Cat 9 uses the same methods; distances may be estimated from maps and port-to-port tables (L4925-4940). Sampling of distribution channels is allowed (L6697).
- Use life-cycle factors for value-chain fuel and energy (L1220-1238). Air: disclose any radiative-forcing multiplier (L2866).

## Today (evidence)
- Categories 13 (upstream) and 18 (downstream) share one `per_unit` spec: tonne.km = Weight × Distance, km = Distance (`ESG-lite/src/scripts/repairTransportConfigs.ts:96-104`, `src/services/calculationSpec.ts:81-95`).
- Modes Road (HGV, refrigerated HGV, Van × 7 fuels), Rail, Air, Sea; units km and tonne.km only, `kg` removed as a stray unit (`repairTransportConfigs.ts:61-78, 106-107, 199-211`).
- Spec categories never spawn a FERA twin (`src/services/emissionWrite/compute.ts:123`), so Cat 4/9 rows carry no Cat 3 double count from the twin.
- No fuel-based, warehousing, refrigerant or paid-by field exists; extra fields are free text (`src/utils/defaultExtraFields.ts:61-99`).
- Distance helper: Google Routes and the sea route (`src/controllers/emission.controller.ts:3384-3563`); the FE "Estimate" badge is not saved (`ESG-lite_FE/src/features/add-data/components/distance/DistanceDrawer.tsx:114`).

## Build
### Backend (ESG-lite)
1. `src/scope3/transport/configs.ts`: one pure definition for both categories (columns, dependent options, mapping, spec, units, `method_options`), found by `category.ghg_category IN (4, 9)` (S3-1), not by ids 13/18. Keep the existing columns and mapping from `repairTransportConfigs.ts` unchanged so old rows still resolve.
2. Extend the `per_unit` spec (one spec, keys are normalised units):
   - `tonne.km` and `km`: unchanged (distance_based).
   - `litre` → [Fuel used (litres), Your share of the load (%)] and `kwh` → [Energy used (kWh), Your share (%)] (fuel_based 4.1 + 4.4; site_specific 4.8 uses the same `kwh`/`litre` keys with the volume share).
   - `kg` → [Refrigerant leaked (kg), Your share (%)] (4.1/4.8 leakage; mapped only under "HGV refrigerated" and "Warehouse").
   - `m3.day`, `pallet.day`, `teu.day` → [Volume stored, Days stored] (average_data 4.9).
   - Spend rows use S3-5's spend method and fields; nothing here.
   `% share` fields are `percent` (100 = vehicle or warehouse used only by us).
3. `calculationSpec.ts`: `normalizeUnitKey` aliases only (`m³.day`, `m3 day`, `pallet day`, `teu day`, `kwh`, `litres` → keys above). No change to multiply logic.
4. `method_options` order (S3-3 column): Cat 4 `fuel_based, distance_based, site_specific, average_data, spend_based`; Cat 9 `distance_based, fuel_based, average_data, site_specific, spend_based`. The method picks which units the form offers. S3-0 follow-up: `method_options` needs a per-method unit list (today it is keys only, S3-3 §Build 1).
5. Extra field "Who paid for this transport?" (We paid / Customer or other) on both forms, stored in `extra_data.paid_by`. S3-0 follow-up: add warning `TRANSPORT_PAID_BY_MISMATCH` (Cat 9 row with "We paid", Cat 4 outbound with "Customer"); until it exists the FE shows the hint only.
6. `src/scripts/seedScope3Transport.ts` (`migrate:scope3-transport` in `package.json`; `scripts/migrate-all.cjs` runs every `migrate:*` entry): applies `configs.ts` to every site with Cat 4/9 assigned, creates the new Unit rows, adds fuel, grid, refrigerant (R134a 1530, R410A 2256 at AR6, D7) and warehouse factor rows only where the site has none, read from `src/scope3/transport/factors.json` (values transcribed from DEFRA 2025 with `dataset`, `dataset_version`, `factor_type` per S3-2; warehouse per-m³/day factors are left for the client to upload). Idempotent; never deletes. It runs on every start, so it updates a config only when it still carries the standard name (`Transport - Standard …`) or the S3-8 version marker in `calculation`; a customised config is left alone and its id logged. Retire `repairTransportConfigs.ts` to call the same `configs.ts`.
7. Engine: the rows go through `methods/spec.ts`; confirm the S3-0 dispatch maps `fuel_based`, `distance_based`, `site_specific`, `average_data` to it (dispatch table line only if missing). A row with `is_estimate` and a distance unit gets `ESTIMATED_DISTANCE`. Factor type allowed list: S3-0 follow-up to add `other` for Cat 4/9 (refrigerant GWP rows would otherwise warn `FACTOR_TYPE_MISMATCH`).

### Frontend (ESG-lite_FE)
1. `src/features/add-data`: the form renders from config, so most of this is data. Add per-method helper copy (fuel: "Litres your carrier used for your goods"; warehouse: "Energy of the warehouse × your share of its volume"), the paid-by select with the Cat 4/9 hint ("If you paid for it, it belongs in Category 4"), and send `is_estimate: true` from `DistanceDrawer` when the route was estimated. Outside the §4 file list: list under "Deviations" in the PR.
2. `src/lib/emissions/emissionCalc.ts`: new unit aliases, so the preview matches.
3. Capture setup builder (`src/features/capture-setup/components/builder/CalcTab.tsx`) needs no change; the new keys appear as per-unit methods.

### AI service
None.

## Golden cases
Turn to `run` (owner S3-8); factors as given in each example, reporting units kgCO₂e:
- ex-4.1 fuel: diesel 50,000 + 80,000 + 90,000 L × 3, R410a 50 kg × 2,000, share 100 % → **760,000** (L2939-2968). S3-0 follow-up: add case.
- ex-4.2 distance: 2 t × 2,000 km × 0.2 + 1 × 3,000 × 1.0 + 6 × 4,000 × 0.05 → **5,000** (L3249-3288).
- ex-4.4 spend: 20,000 × 0.04 + 30,000 × 0.15 + 40,000 × 0.05 USD → **7,300** (L3420-3448); runs only once S3-5 `spend.ts` is merged.
- ex-4.5 site-specific: (10,000 kWh × 0.8 + 1,000 × 0.25) × 25 % + (15,000 × 0.8 + 2,000 × 0.25) × 25 % → **5,187.5** (L3535-3592; shares 100/400 and 200/800). S3-0 follow-up: add case.
- ex-4.6 average: 4,000 m³ × 2 d × 0.01 + 4,000 × 2 × 0.02 → **240** (L3633-3653).
- ex-9.1 downstream: 4 t × 2,000 km × 0.2 → **1,600** (L4950-4971). S3-0 follow-up: add case.
Compare on summed `total_kgco2e` (4.5 has rows of 62.5 and 125 kg that round to 0.06 and 0.13 t).

## Tests
- API (`ci/api/tests/s3-8-transport.test.cjs`): each new unit key computes; percent > 100 → `FIELD_INVALID`; old tonne.km rows (legacy_field) still compute; seed run twice gives no duplicates; tenant isolation on the seeded site configs (company 2 can't read company 1's form).
- `ci/golden` unchanged (existing tonne.km cases).
- Unit: `configs.ts` mapping covers every option chain; FE `emissionCalc` per new key.
- Playwright (`e2e/add-data.spec.ts`): Cat 4 → "From fuel used" → 1,000 L diesel at 100 % → preview and saved row match.

## Out of scope
Cat 3 WTT split and the double-count flag (S3-7, D6). Spend maths (S3-5). Unladen backhaul (4.5) and fuel-from-spend (4.2) as calculators. Route estimation changes.

## Done when
- Cat 4 and Cat 9 forms offer fuel, distance, warehouse (site and average) and spend methods on every assigned site.
- Six transport golden cases run green (4.4 after S3-5).
- Estimated distances are saved as `is_estimate` and warn `ESTIMATED_DISTANCE`.
- Existing transport totals in `ci/golden` are unchanged.

## As built (2026-10-15, branch s3-8-transport, part 1: what today's engine supports)
- **`configs.ts`**: the one standard form for Cat 4 and Cat 9. The pre-S3-8 columns, options and mapping are kept, so old rows resolve to the same factors. New chains carry their unit in the class name: `Diesel used [litre]`, `Electricity used [kWh]`, `Refrigerant R410A leaked [kg]` (refrigerated HGV and warehouse only), `Ambient storage [m3.day]`, … under the new Travel Mode `Warehouse` (vehicles "Warehouse energy (site-specific)" and "Average storage"). Spec keys `litre`, `kwh`, `kg` multiply by a `percent` share; `m3.day`, `pallet.day`, `teu.day` are volume × days. `calculation.standard = "scope3-transport@1"` marks a config this module wrote. `METHOD_OPTIONS` and `UNITS_BY_METHOD` are ready for S3-3's column.
- **`factors.ts`** (not `factors.json`: the build has no `resolveJsonModule` and doesn't ship JSON). Fuel factors are life cycle, DEFRA "Fuels" + "WTT- fuels", 2024 and 2025 full sets (diesel 3.1238 / 3.18183, petrol 2.66534 / 2.6501, LPG 1.74264, natural gas per kWh gross CV 0.21311 / 0.21317); refrigerants AR6 (R134a 1530, R410A 2256, D7). Not seeded: grid electricity (DEFRA 2025 has only a UK factor; overseas factors are sold by the IEA, so a UK value on Indian or Bahraini sites would be wrong) and per-day storage factors. Both are the client's.
- **`migrate:scope3-transport`** (`src/scripts/seedScope3Transport.ts`): creates the standard form where a site × category has none, updates it only while it is the standard one, and leaves a client's own form, its units and its factors alone (ids logged). Adds missing unit rows and the factors.ts rows per year; never deletes; the second run writes nothing (jsonb key order ignored when comparing). Finds Cat 4/9 by `category.ghg_category` once S3-1 adds it, the legacy ids 13/18 until then. `repairTransportConfigs.ts` (by hand, per site) now writes the same form: it is how a Superadmin switches an existing site to it.
- **Real data** (copy of production, 24 transport assignments): none of the 17 existing forms is the standard one ("… Auto Generated", LUQOM's "Transport - Smart"), so the seed leaves them all and sets up the 7 assignments with no form. 2 transport entries exist in total. Switching existing sites is a Superadmin decision: `npx ts-node src/scripts/repairTransportConfigs.ts <site ids>`.
- **`calculationSpec.normalizeUnitKey`**: `m³.day`/`m3 day` → `m3.day`, `pallet day`, `teu day`, `litres` → `litre` (kWh was already lower-cased). Existing keys unchanged; `ci/golden` unchanged.
- **Waiting on**: S3-3 (`method_options` from `METHOD_OPTIONS`/`UNITS_BY_METHOD`, `is_estimate` stored and `ESTIMATED_DISTANCE`; the FE already sends `is_estimate`), S3-1 (`ghg_category`; the seed switches to it by itself when the column exists), S3-4 (`FIELD_INVALID` code on the >100 % refusal; ex-4.5 reads 5,190 kg until S3-4's kg figure lands), `TRANSPORT_PAID_BY_MISMATCH` (S3-0 follow-up).
- **Done after S3-0 and S3-2 merged**: the seed writes S3-2's factor metadata (factor_type `life_cycle` for DEFRA fuels and `other` for refrigerants, which Cat 4/9 allow; gwp_set; geography GB / GLO; dataset and version). S3-0's golden cases ex-4.1, 4.2, 4.5, 4.6 and 9.1 run (`npm run test:scope3-golden`). The rows go through `methods/spec.ts` for every method (S3-0's dispatch picks the spec whenever the category has one), so no dispatch line was needed.
- Tests: `ci/unit/scope3-transport.test.cjs` (mapping, units, aliases, each key, ex-4.1 760,000 · ex-4.2 5,000 · ex-4.5 5,187.5 · ex-4.6 240 · ex-9.1 1,600 kg), `ci/api/tests/s3-8-transport.test.cjs` (seed twice, client form untouched, each key on a typed entry, >100 %, legacy tonne.km, tenant isolation).

## As built (2026-10-16, verify/s3-8-be, after S3-1, S3-3 and S3-5 merged)
- **`method_options`** (S3-3): the seed and `repairTransportConfigs.ts` write `methodOptionsFor(4 | 9)` (`{method, units}`, Cat 4 fuel first, Cat 9 distance first; spend_based offers S3-5's currencies) when they write a form whose list is empty. A list a Superadmin set is never overwritten.
- **Edited standard forms stay edited**: `calculation.standard_hash` (the S3-9 pattern) covers everything a Superadmin can change. The seed rewrites a form only while the hash still matches, or it is the pre-S3-8 standard set by name with its distance-only spec unchanged. Before, any form named "Transport - Standard …" was reset on every start.
- **Warnings** (`emissionWrite/transportWarnings.ts`, never block): `ESTIMATED_DISTANCE` when a row with `is_estimate` is in a distance unit (km, tonne.km, passenger.km, …); `TRANSPORT_PAID_BY_MISMATCH` on a Category 9 row whose `extra_data.paid_by` is "We paid". A Category 4 row paid by "Customer or other" is not flagged: inbound freight of purchased goods is Category 4 whoever paid, and the form doesn't record the direction (the spec's "Cat 4 outbound" case needs a direction field).
- Open: rows that name no method record `method_options[0]` (01-contracts §6), so a Cat 4 tonne.km row records `fuel_based`. Choosing the default by the row's unit needs an S3-0/S3-3 follow-up. The seeded DEFRA fuel factors bundle WTT but keep `includes_wtt = false` (setting it raises WTT_ALREADY_IN_FACTOR on every fuel row; D6 decision).

