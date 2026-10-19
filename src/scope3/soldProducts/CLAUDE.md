# S3-10 · Sold products: processing, use, end of life (Cat 10, 11, 12)

> Module spec. Lane L6. Copy to `ESG-lite/src/scope3/soldProducts/CLAUDE.md` and `ESG-lite_FE/src/features/scope3/soldProducts/CLAUDE.md` as the first commit. PR titles `[S3-10 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on (merged): S3-1, S3-3 · Owns: `src/scope3/soldProducts/*`, `product_sale` table · Touches: `Product` (read), PCF BOM read model

## Job to be done
A manager enters what the company sold in the year once (product, quantity, region) and ESGLite turns it into reviewable rows for processing by customers (Cat 10), lifetime use (Cat 11) and end-of-life disposal (Cat 12), using product data the client already keeps for PCF.

## Guidance (what the GHG Protocol expects)
- Cat 10: processing of sold intermediate products by third parties, allocated to the intermediate product; may be excluded with justification when end uses are unknown (L4976-4995). Formula 10.1 site-specific: customer fuel, electricity, refrigerant, process and waste × factors (L5074-5094). Formula 10.2 average-data: mass sold × processing factor per kg (L5169-5173).
- Cat 11: total expected lifetime emissions of products sold in the year (L5209-5215, Box 11.1 L5256-5264); report lifetime assumptions and intensity metrics (Box 11.2 L5266-5275; L5246-5248). Direct use is required: 11.1 energy-using (uses × sold × kWh per use × factor, L5334-5347), 11.2 fuels (combustion factor only, L5413-5418), 11.3 GHG-containing (GHG per product × sold × % released × GWP; 100 % if unknown, L5442-5452). Indirect use (11.4) optional. Intermediate products: formula 11.5 with physical allocation (L5581-5613).
- Avoided emissions are reported separately, never netted (L5254-5255).
- Cat 12: total expected end-of-life emissions of products and packaging sold in the year; methods as Cat 5; formula 12.1: mass × % per treatment × treatment factor (L5621-5640, L5685-5689).

## Today (evidence)
- Cat 11 (id 20) works: `per_method` spec with formulas 11.1-11.3 and `identity_columns: ["Product Name"]` (`ESG-lite/src/scripts/seedUseOfSoldProducts.ts:70-92`); refrigerant factors at AR4 (1430, 2088) (`:106-107`). Units sold and lifetime uses are typed per row.
- Cat 12 (id 21) has only period and month fields, no model (`src/utils/defaultExtraFields.ts:101-105`). Cat 10 has no category row.
- `Product` is site-scoped with `mass_per_unit_kg` and `declared_unit` (`src/entities/Product.ts:25-43`); it holds production, not sales. PCF BOM lines carry material, quantity and unit per declared unit (`src/entities/PcfInput.ts:30-64`).

## Build
### Backend (ESG-lite)
1. `migrate:scope3-sold-products`: `product_sale` (§4), `product.lifetime_uses numeric null`, `product.eol_mix jsonb null`; create the global Cat 10 category "Processing of sold products" (scope 'Scope 3', `ghg_category` 10) when S3-1 has not. S3-0 follow-ups: define `product_sale.period` (proposed `date`, first day of month or year) and the `eol_mix` shape (proposed `{packaging_kg_per_unit, treatments: {landfill, incineration, recycling, composting} %}` summing to 100); note `Product` gains columns although §4 lists it as read-only.
2. `src/scope3/soldProducts/` (router, controller, service): `GET/POST/PUT /scope3/product-sales` (Manager+ for products on own sites; Admin/Superadmin company-wide; CSV import of ≤ 5,000 rows) and `PUT /scope3/products/:id/use-profile` (lifetime uses, EOL mix). S3-0 follow-up: add both to §5.
3. `POST /scope3/sold-products/plan {site_id, year, year_type, ghg_category}` (S3-0 follow-up): builds an import plan through `src/imports` with one yearly row per product (Cat 12: per product × material × treatment with share > 0), channel Bulk upload, so the manager previews and commits as usual. It only fills activity fields; the engine calculates.
   - Mass sold = quantity × `mass_per_unit_kg` (+ packaging kg per unit). Material split for Cat 12 = the product's latest PCF study A1 + packaging lines by mass (read model in `soldProducts/bom.ts`, read-only on `pcf_*`); no study → one "Mixed" line.
4. Forms (`soldProducts/configs.ts`, applied to sites with Cat 10/11/12 assigned; idempotent seed `migrate:scope3-sold-product-forms`):
   - Cat 10 `per_method`, `method_column: "@method"` (S3-9; S3-0 follow-up: S3-10 then needs S3-9 merged, not in §4): site_specific → [Quantity, Share for our product (%)] in the factor's unit (kWh, litre, kg waste); average_data → [Mass sold (kg)] × processing factor (kgCO₂e/kg, `factor_type process`). `method_options`: site_specific, average_data.
   - Cat 11: keep the existing spec and options; add a "Product" select (identity column) and option "Part of a customer's product" (11.5) → [Units sold, Lifetime uses of final product, Share of final product (%)] × factor per use (unit `use`). `method_options`: direct_use. D7: add 2026 refrigerant rows at AR6 (R134a 1530, R410A 2256, `gwp_set` AR6); mark the old rows `gwp_set` AR4. `seedUseOfSoldProducts.ts` is in no module's §4 list: say so in the PR.
   - Cat 12 `per_method @method`: waste_type_specific → [Mass at end of life (kg), Share treated this way (%)] × factor per material × treatment (Landfill, Incineration, Recycling, Composting; recycling uses the cut-off factor); average_data → [Mass at end of life (kg)] × average disposal factor. Factors from `soldProducts/factors.json` (DEFRA 2025 waste disposal, per tonne converted to per kg at seed time with the conversion noted in `source`).

### Frontend (ESG-lite_FE)
1. `src/features/scope3/soldProducts/` (route `/settings/scope3/sold-products`, Manager+; registered in `features/scope3/routes.tsx`): year picker in the URL (`?year=&site=`), sales table (product, quantity, unit, region, mass), CSV import with a template, product drawer with lifetime uses, EOL mix (shares must sum to 100 %, shown live) and packaging per unit, and three actions "Create Category 10 / 11 / 12 plan" that open the existing plan review. Empty state: "No sales recorded for 2026" with Import. Loading and error states; table scrolls inside its frame at 390 px.
2. Cat 10 copy on the boundary row link: "If you can't know what customers make from it, exclude Category 10 and say why."
3. `src/lib/emissions/emissionCalc.ts`: nothing new beyond S3-9's mirror; add unit tests for the new option chains.

### AI service
None.

## Method choices (S3-3 `method_options`)
- `migrate:scope3-sold-product-forms` fills each standard form's `method_options` once, from `configs.ts` `METHOD_OPTIONS` / `UNITS_BY_METHOD` (most specific method first), and marks the form with `calculation.method_options_seeded` (kept out of `standard_hash`). After that the list is the Superadmin's: an edited, reordered or cleared list is never written back on restart.
- Contributors (Users) don't pick a method: once the FE reads `method_options` (S3-3 FE), their rows start on `method_options[0]`. With the seeded lists that is the most detailed method: Category 10 site-specific (Quantity × Share) and Category 12 waste-type-specific. A client whose contributors only have mass sold needs a Superadmin to put `average_data` first, or narrow the list, in Capture setup. SE-5 moves these forms to `method_by_choice`.

## Golden cases
Turn to `run` (owner S3-10):
- ex-10.1 site-specific: gas 3,500 kWh × 0.2 + electricity 2,000 kWh × 0.5 + waste 50 kg × 0.5, share 100 % → **1,725** (L5096-5128). S3-0 follow-up: add case.
- ex-10.2 average: 1,000 kg × 1.5 → **1,500** (L5174-5191). S3-0 follow-up: add case.
- ex-11.1 energy: 1,000 × 11,500 × 1.3 + 1,100 × 1,900 × 1.5 + 2,000 × 20,000 × 0.2 kWh × 0.5 → **13,042,500** (L5348-5385).
- ex-11.3 intermediate: 10 engines × 300,000 km × 4 % (20 t / 500 t) × 0.3 kg/km → **36,000** (L5589-5613).
- ex-12.1 end of life: 10,000 kg × 90 % × 0.3 + 10,000 × 10 % × 1.0 → **3,700** (L5691-5713; the 0 % recycling row is not created).

## Tests
- API (`ci/api/tests/s3-10-sold-products.test.cjs`): company 2 token on company 1 product sales and plan endpoint → 404; User → 403; EOL shares ≠ 100 → 400; plan built twice for the same year flags `DUPLICATE_EXISTING` on commit; plan rows carry no total; migration twice.
- Unit: BOM mass split, mass-sold maths, AR6 seed rows.
- Playwright (`e2e/scope3-sold-products.spec.ts`): add a product sale, set EOL mix, create Cat 12 plan, preview shows one row per treatment.

## Out of scope
Indirect use phase (11.4). Avoided-emission claims. Customer-specific Cat 10 data requests (supplier-request style). Changing PCF studies.

## Done when
- Sales per product and year can be entered or imported, and Cat 10/11/12 plans are built from them.
- Cat 11 refrigerant rows from 2026 use AR6 and say so in the snapshot.
- Five golden cases run green; `ci/golden` is unchanged.
