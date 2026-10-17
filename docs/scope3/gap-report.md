# Scope 3 gap report: ESGLite vs the GHG Protocol Scope 3 Calculation Guidance

Date: 2026-10-15. Analysis only, no code changed.

**Reference document:** *Technical Guidance for Calculating Scope 3 Emissions (version 1.0)*, the supplement to the GHG Protocol Corporate Value Chain (Scope 3) Standard, by WRI/WBCSD with the Carbon Trust. The text was confirmed from the upload. Where the guidance says "report", it is pointing to Scope 3 Standard ch. 11.

**Code compared:** `production` heads:
- ESG-lite `37becd7`
- ESG-lite_FE `6e4f4b4`
- python_AI_service `8b3de26`

Paths starting `FE/` are in ESG-lite_FE, paths starting `AI/` are in python_AI_service, and all other paths are in ESG-lite.

**Gap size scale:**
- **S**: config, copy or a small fix (days)
- **M**: new fields plus engine or report changes (1–2 weeks)
- **L**: a new module or data model (several weeks)
- **XL**: a new product area

---

## 1. Summary

ESGLite works today as a **generic activity × factor engine with a Scope 3 label**. It does well on one thing: every row is calculated server-side by one engine, with an approval workflow, evidence files and a factor snapshot. That is a sound base. What it lacks is the *Scope 3-specific structure* the guidance builds on.

| # | Gap | Why it matters | Size |
|---|---|---|---|
| G1 | **No 15-category taxonomy.** A category is a free-text name plus a free-text `scope` string. It has no Cat 1–15 number and no upstream/downstream flag. | Category-level reporting, completeness and exclusions all depend on it. A typo such as "scope3" silently drops out of reports. | M |
| G2 | **No calculation-method concept.** Everything is `activity × factor / 1000`. There is no record of whether a row is supplier-specific, hybrid, average-data, spend-based, distance-based or fuel-based. | The guidance requires the method to be described per category, and data quality depends on it. | M |
| G3 | **Emission factors are one CO₂e number.** They have no gas split, GWP set, region, factor type (cradle-to-gate / WTT / combustion / EEIO), version or price base year. The AI importer throws away WTT and gas columns. | The guidance requires all 7 Kyoto gases, a disclosed GWP source and the right factor type per category. | M |
| G4 | **No data-quality layer on corporate data.** It has no DQI, no primary/secondary flag, no uncertainty and no "% from supplier data". The full DQR model exists only in PCF. | Data-quality description is a reporting requirement, and quality should improve over time. | M |
| G5 | **Supplier-specific and hybrid methods (Cat 1/2) don't exist in the inventory.** Supplier PCFs collected through C06 feed only product footprints. | These are the top-ranked methods for the largest category for most manufacturers. | L |
| G6 | **Spend-based method is fragile.** It uses today's FX rate, which is not stored. It has no inflation or price-year adjustment and no EEIO sector model. GBP/BHD/SAR/AED can't convert, and the spend field doesn't drive the calculation. | Spend-based is the fallback for Cat 1/2/4/6, and the current numbers can't be reproduced. | M |
| G7 | **Five categories are entirely missing (8, 10, 13, 14, 15).** Cat 12 is a shell, and Cat 11 is direct use-phase only. | Completeness. Each missing category needs either a figure or a justified exclusion. | L–XL |
| G8 | **The report doesn't meet Scope 3 reporting requirements.** It shows one Scope 3 total plus free-text category names. It has no per-category list of included or excluded categories with justification, no method or data-source note per category, no per-gas, biogenic or base-year recalculation lines, and the boundary is hard-coded to "Operational control". | This is what an auditor or customer reads. | M |
| G9 | **Cat 3 (FERA) risks double counting.** Freight factors already include WTT ("DEFRA freighting + WTT … summed"), and the FERA twin adds Cat 3 separately. Cat 3a/b/c/d are not separated, and there is no T&D-loss logic. | Accuracy and transparency. | S–M |
| G10 | **No screening and relevance step.** Nothing helps a client estimate all 15 categories cheaply first and then decide where to collect better data. | The guidance's recommended starting point (Introduction, Table II). | M |

**Quick wins (S):**
- Fix the FE Findings rule that can never call Scope 3 dominant.
- Store the FX rate and date on each spend row.
- Add the missing currencies.
- Validate `scope` to a fixed enum.
- Refuse factors with no unit.
- Route the historical import through the engine.

---

## 2. What the app does today (baseline)

| Area | Today | Evidence |
|---|---|---|
| Category | `category_name` string and `scope` nullable varchar. Categories are global, with no company link. | `src/entities/Category.ts:18-22` |
| Scope check | Reports sum on the exact string `'Scope 3'`. Create and update accept any string. The historical upload auto-creates unknown categories as "Scope 1". | `src/reporting/ghg-data.ts:196-198`, `src/controllers/category.controller.ts:71,107-110`, `src/controllers/upload.controller.ts:302-308` |
| Formula | `activity × factor_value / 1000`, rounded to 0.01 t | `src/services/emissionWrite/compute.ts:44-45, 99-102` |
| Multi-field products | `calculation` spec: `per_method` (Cat 11) and `per_unit` (tonne.km = weight × distance) | `src/services/calculationSpec.ts:4-16,117-161`, `FE/src/features/capture-setup/components/builder/CalcTab.tsx:26-36` |
| Factor choice | Only that site × category's factors. Year = reporting year − 1, with silent fallback to the newest year on typed entries. Name match runs through 6 steps. | `src/services/emissionWrite/resolve.ts:27-33, 49-54, 64-80` |
| Factor fields | `factor_value` decimal(10,4) kgCO₂e per `denominator_unit`, `year`, free-text `source`, names | `src/entities/EmissionFactor.ts:13-50` |
| Unit check | A null unit on either side counts as a match | `src/services/emissionWrite/units.ts:115-117` |
| Workflow | Pending / Approved / Rejected. Reports use approved rows only. Evidence files, audit log and factor snapshot are kept per row. | `src/entities/Emission.ts:15-56,96-107`, `src/entities/EmissionDocument.ts`, `src/reporting/ghg-data.ts:181` |
| Client calc | FE preview only. Save sends `total_emission: 0` and the server recalculates. | `FE/src/lib/emissions/emissionCalc.ts:1-5`, `FE/src/features/add-data/logic/entry.ts:98-120` |
| Engine bypasses | The historical import computes its own totals and falls back to the sheet's figure. A seed stores sheet totals. | `src/services/historicalImport.ts:83-102`, `src/seeds/seedEmissionsFromExcel.ts:266-267` |
| AI service | Doesn't calculate. The factor importer keeps one sub-column ("Total") and drops Direct, WTT and gas columns. It rounds to 4 decimals. | `AI/app/services/excel_parser.py:150,179-180,284-300,418-438`, `AI/app/services/pipeline.py:314` |

---

## 3. Category by category

The method lists below are taken from the guidance, most specific first.

### Cat 1 · Purchased goods and services
- **Guidance:** four methods.
  1. Supplier-specific: the supplier's cradle-to-gate product PCF × quantity (formula 1.1).
  2. Hybrid: the supplier's allocated Scope 1+2, plus material inputs × factors, plus transport and waste (1.2, 1.3).
  3. Average-data: mass or units × cradle-to-gate factor (1.4).
  4. Spend-based: spend × EEIO factor, inflation-adjusted to the factor's price year (1.5).
  
  Use cradle-to-gate factors. Methods can be mixed within the category. Results from a sample of suppliers can be extrapolated.
- **Today:**
  - The category exists (id 3; `src/utils/defaultExtraFields.ts:130-133`).
  - Calculation is quantity or spend × a site-level factor.
  - PO, description, quantity, spent value, currency and supplier name are *extra fields* that don't enter the calculation (`src/utils/defaultExtraFields.ts:17-26`, `src/entities/ColumnConfig.ts:64-66`).
  - Bulk upload uses one "Value (spend or quantity)" field (`FE/src/features/bulk-upload/logic.ts:62-86`).
  - The AI bill flow reads vendor and amount but removes them before saving (`FE/src/features/add-data/logic/entry.ts:110-111`).
  - Supplier PCFs from C06 become PCF-only `MaterialFactor` rows (`src/controllers/supplierRequest.controller.ts:445-464`). Nothing in `emissionWrite` or `reporting` reads them.
- **Gaps:**
  - Supplier-specific and hybrid methods are absent (**L**).
    - The building blocks exist in PCF: a supplier request, a supplier `MaterialFactor` and a boundary check. The missing piece is a *supplier* and *purchased item* on the emission row, plus a factor that can come from a supplier.
  - Average-data works if the admin uploads cradle-to-gate factors per material, but no factor type marks them as such (**S**, covered by G3).
  - Spend-based is fragile. See G6 and section 4.5 (**M**).
  - No supplier or vendor is stored on rows, so "top suppliers by emissions" or "% of spend covered by supplier data" can't be shown (**M**).
  - No extrapolation from a sample (**S–M**).

### Cat 2 · Capital goods
- **Guidance:** the same four methods as Cat 1, with average-product in place of average-data. Report 100% of cradle-to-gate emissions in the **year of acquisition**, with no depreciation (Box 2.1).
- **Today:**
  - The category exists (id 12) with the same extra fields as Cat 1 (`src/utils/defaultExtraFields.ts:50-59`).
  - One documented site has mappings but no Capital Goods factors (`docs/yearly-data-entry.md:118-119`).
- **Gaps:**
  - Same as Cat 1.
  - Nothing tells users to book capex in the acquisition year, and nothing separates capital goods from purchased goods except the free-text category (**S** guidance copy, **L** with Cat 1 supplier work).

### Cat 3 · Fuel- and energy-related activities (not in Scope 1 or 2)
- **Guidance:** four sub-activities.
  - (a) Upstream (WTT) of purchased fuels.
  - (b) Upstream of purchased electricity, steam, heat and cooling.
  - (c) T&D losses: generation emissions of the lost energy plus their upstream.
  - (d) Generation of energy bought and resold (utilities).
  
  Use upstream emission factors that *exclude* combustion. Each sub-activity has supplier-specific and average-data methods.
- **Today:**
  - A "FERA" twin row is added automatically when a fuel or energy row matches a factor in the site's category literally named `fera` (`src/services/emissionWrite/compute.ts:117-131`, `context.ts:255`).
  - The FERA factor lookup is exact on name and year, with no fallback (`resolve.ts:83-89`).
  - Approving the parent approves the twin (`src/utils/feraFold.ts:1-21`).
- **Gaps:**
  - **No split of 3a/3b/3c/3d.** A FERA factor's content (WTT only, or WTT plus T&D) depends on what the admin uploaded. There is no T&D-loss rate logic (**M**).
  - **Possible double count.** Cat 4/9 freight factors are "DEFRA freighting + WTT … summed" (`docs/emission-factor-sources.md:49-51`). If a company also has a FERA twin for that own-fleet fuel, WTT lands twice. Today the twin applies only to rows in categories that have FERA factors, so the risk depends on configuration (**S** to audit and document, **M** to enforce).
  - 3d is not supported (low relevance for most clients).
  - The FERA match is by activity name only. A missing year silently yields no Cat 3 row, with no warning (**S**).

### Cat 4 · Upstream transportation and distribution
- **Guidance:**
  - Transport has three methods: fuel-based (4.1–4.5, including refrigerant leakage), distance-based (mass × distance × mode factor, 4.6) and spend-based (4.7).
  - Distribution (warehousing) has two: site-specific (4.8) and average-data (4.9).
  - It also covers third-party transport the company *paid for*, including outbound.
- **Today:**
  - The category exists (id 13).
  - Distance-based works well:
    - `per_unit` spec: tonne.km = weight × distance (`src/services/calculationSpec.ts`).
    - Seeded modes: road (HGV, refrigerated, van × 7 fuels), rail, air and sea (`src/scripts/repairTransportConfigs.ts:63-109`).
    - Distance helper: Google Routes for road, `searoute` for sea (`src/controllers/emission.controller.ts:3384-3466`, `AI/app/services/sea_route.py:59`).
    - Estimated distances are not flagged once saved (`FE/src/features/add-data/components/distance/DistanceDrawer.tsx:114`).
- **Gaps:**
  - The fuel-based method has no dedicated form. Possible with admin config: litres × fuel factor (**S**).
  - No warehousing / distribution method, either site-specific (kWh per m² or per pallet-day) or average (**M**).
  - No refrigerant leakage on reefer transport (**S**).
  - Spend-based transport inherits the G6 issues.
  - The "Estimate" flag on distances is not saved, so it can't feed data quality (**S**).

### Cat 5 · Waste generated in operations
- **Guidance:**
  - Three methods: supplier-specific (data from the waste company), waste-type-specific (mass by waste type × treatment-specific factor, 5.2) and average-data (total waste × treatment mix, 5.3).
  - Wastewater is included.
  - Only end-of-life treatment emissions count. Recycling is cut-off: transport to the recycler only.
- **Today:**
  - The category exists (id 6). Waste type is a dropdown and the amount is the quantity (`src/utils/defaultExtraFields.ts:38-43`, `ci/golden/fixture.sql:14,37,39`).
- **Gaps:**
  - Waste-type-specific works if factors are uploaded per type × treatment. No fixed list of treatment methods is enforced (**S**).
  - No wastewater form (**S**).
  - No supplier-specific path (**M**, same pattern as G5).

### Cat 6 · Business travel
- **Guidance:**
  - Three methods: fuel-based, distance-based (pkm × mode factor, 6.1) and spend-based.
  - Hotel stays are optional (room-nights × factor).
  - Radiative forcing for air is optional but must be disclosed.
  - Travel in company-owned vehicles is Scope 1/2.
- **Today:**
  - The category exists (id 15). Extra fields are vehicle, passengers and boarding/drop points (`src/utils/defaultExtraFields.ts:72-79`).
  - `passenger.km` is normalised (`src/controllers/emissionFactor.controller.ts:52-56`).
  - The FE builds pkm as count × distance (`FE/src/features/add-data/logic/distance.ts:15-48`).
- **Gaps:**
  - No hotel stays (`hotel` has no hits) (**S**).
  - No cabin class and no radiative-forcing choice or disclosure (**S**).
  - Nothing stops company-car trips from being entered here rather than in Scope 1 (**S**, guidance copy).

### Cat 7 · Employee commuting
- **Guidance:**
  - Three methods: fuel-based, distance-based (survey: employees × days × distance × mode) and average-data (national averages extrapolated from headcount).
  - Teleworking is optional.
  - Survey results can be extrapolated to all staff.
- **Today:**
  - The category exists (id 16). Extra fields are vehicle, number of employees, vehicles and departure/destination (`src/utils/defaultExtraFields.ts:81-88`).
- **Gaps:**
  - No survey tool and no working-days × distance model.
  - No average-data model from headcount × national averages, and no extrapolation from a sample.
  - No teleworking (**M** for a simple survey import and headcount extrapolation).

### Cat 8 · Upstream leased assets
- **Guidance:** applies to assets the company leases (as lessee) that are *not* in its Scope 1/2 under the chosen consolidation approach. The methods are asset-specific, lessor-specific and average-data (floor area or asset type).
- **Today:** **absent** (`grep -i leased` finds no code). The company has no consolidation-approach setting (`src/entities/Company.ts`), so nothing tells the user when leased sites belong here instead of in Scope 1/2.
- **Gap:** a category, a lease flag on sites, and the average-data method by floor area (**M**). Depends on G8's boundary setting.

### Cat 9 · Downstream transportation and distribution
- **Guidance:**
  - Covers transport and storage of sold products that the company does *not* pay for, including retail storage. Consumer travel to the shop is optional.
  - The methods are the same as Cat 4.
- **Today:**
  - The category exists (id 18) with the same `per_unit` spec as Cat 4 (`src/scripts/repairTransportConfigs.ts:98-106,167`).
- **Gaps:**
  - Nothing marks paid-for (Cat 4) vs not-paid-for (Cat 9) transport, so outbound freight can land in either (**S**, guidance copy plus a check).
  - No retail-storage method (**S–M**).

### Cat 10 · Processing of sold products
- **Guidance:** for intermediate products. There are two methods: site-specific (data from customers who process the product) and average-data (mass × processing factor). The category can be excluded with justification if end uses are unknown.
- **Today:** **absent.**
- **Gap:** a category plus the average-data method: sold mass × processing factor per process (**M**). This matters for Midal Cables-type clients, because aluminium rod gets drawn and processed downstream.

### Cat 11 · Use of sold products
- **Guidance:**
  - Direct use-phase emissions are **required**:
    - 11.1 energy-using products
    - 11.2 fuels and feedstocks
    - 11.3 GHG-containing products
  - Indirect use-phase is optional.
  - Use total *lifetime* emissions of products sold in the year (Box 11.1), with documented lifetime assumptions (Box 11.2).
- **Today:**
  - The best-covered downstream category (id 20). `per_method` spec with formulas 11.1, 11.2 and 11.3 (`src/scripts/seedUseOfSoldProducts.ts:75-91`).
  - Several products per period via `identity_columns` (`src/services/calculationSpec.ts:163-180`).
  - Seed factors: grids for DE/DK/NL/IN, DEFRA fuels, and R134a/R410A at **AR4** GWP (`seedUseOfSoldProducts.ts:98-108`). The AR4 vs AR5 choice is still open (`docs/use-of-sold-products.md:242-247`).
- **Gaps:**
  - Indirect use-phase is not supported (optional; **M**).
  - Lifetime assumptions are typed per row and not stored as a product attribute (**S**).
  - Units sold are typed rather than linked to `Product` (which holds production, not sales) (**S–M**).
  - The GWP set (AR4) is inconsistent with PCF (AR6/AR5). It should be one disclosed GWP set (**S**).
  - One grid factor is used for the whole lifetime. That is acceptable, but should be disclosed.

### Cat 12 · End-of-life treatment of sold products
- **Guidance:**
  - Methods: waste-type-specific (mass sold × disposal mix × treatment factor) or average-data.
  - It needs the mass of sold products and packaging, by material, in the reporting year.
- **Today:** the category exists (id 21), but its only fields are period and month (`src/utils/defaultExtraFields.ts:101-105`). There is no model.
- **Gap:** the product mass and material composition already exist in PCF (BOM lines). An end-of-life model would need sold quantity × BOM mass × disposal mix by region × treatment factors (**M**). Builds on the PCF "cradle-to-grave" plan (`FE/docs/pcf/00-pcf-plan.md:63`).

### Cat 13 · Downstream leased assets
- **Guidance:** assets the company owns and leases out that are not in its Scope 1/2. The methods are asset-specific, lessee-specific and average-data.
- **Today:** **absent.**
- **Gap:** the same pattern as Cat 8 (**M**). Low priority unless a client leases out property.

### Cat 14 · Franchises
- **Guidance:** for franchisors. Emissions of franchises not in Scope 1/2. Franchise-specific or average-data (floor area or building type).
- **Today:** **absent.**
- **Gap:** **M**. Likely not relevant to the current client base (manufacturers), so a justified exclusion is enough.

### Cat 15 · Investments
- **Guidance:** for investors and lenders. Required for equity (both proportional Scope 1+2), debt and project finance. The methods are investment-specific, average-data (revenue × sector EEIO) and project-specific. Managed investments and some others are optional.
- **Today:** **absent** (`investment`, `PCAF` and `financed` have no hits). There is no ownership share on sites or companies.
- **Gap:** **XL** if financial institutions become clients (a PCAF-style module). For industrial clients: a simple equity-investment entry (investee Scope 1+2 × share) plus a justified exclusion (**M**).

---

## 4. Cross-cutting requirements

### 4.1 Category taxonomy and boundary (Scope 3 Standard ch. 5–6)
- **Guidance:**
  - Account for each of the 15 categories.
  - Exclusions must be disclosed and justified.
  - The upstream/downstream split follows payment and ownership.
  - The organisational boundary uses an equity-share, financial-control or operational-control approach, and that choice decides what falls into Cat 8, 13, 14 and 15.
- **Today:**
  - Categories are free text with no number (`src/entities/Category.ts:18-22`).
  - The only number-like mapping is a deprecated id → name map (`src/utils/defaultExtraFields.ts:130-146`).
  - The boundary is the hard-coded string "Operational control" (`src/reporting/ghg.ts:230,446`).
  - There is no ownership % or approach setting (`src/entities/Company.ts`).
- **Gap (M):**
  - Add `ghg_category` (1–15, nullable for Scope 1/2) and a direction field to Category.
  - Validate `scope` to an enum.
  - Add a company-level consolidation approach and per-category status per company: Included / Excluded (reason) / Not relevant.

### 4.2 Screening and method selection (Introduction, Table II)
- **Guidance:**
  - Screen all 15 categories with less specific methods first, such as spend-based / EEIO.
  - Rank them by size, influence, risk, stakeholders, outsourcing and spend.
  - Put better methods on the biggest categories.
  - Within a category, use different methods for different activities.
- **Today:** none. There is no screening view, no relevance criteria and no method choice per activity.
- **Gap (M):** a "Scope 3 screening" page.
  - Spend by category × EEIO gives a first estimate.
  - Relevance ticks against Table II.
  - The output sets the per-category status from 4.1.

### 4.3 Calculation methods recorded per row
- **Guidance:** the method used per category (and activity) must be **reported**.
- **Today:** one formula for everything. The method is implicit in the factor's unit (`src/services/emissionWrite/compute.ts:44-45`).
- **Gap (M):**
  - Add `method` to the form config or emission row. Values: supplier_specific, hybrid, average_data, spend_based, distance_based, fuel_based, site_specific, waste_type_specific.
  - Store it in the factor snapshot.
  - Show the mix in the report.

### 4.4 Emission factors and GHGs (Introduction: factor types, GWP)
- **Guidance:**
  - Cover all 7 Kyoto gases (including NF₃).
  - Use 100-year GWPs and **disclose the GWP source**.
  - Use cradle-to-gate factors for Cat 1/2, life-cycle factors for most other energy use, and *upstream-only* factors for Cat 3.
  - Prefer recognised databases.
  - Assess factors for technology, time and geography representativeness.
  - **Disclose the types and sources of factors.**
- **Today:**
  - A factor is one kgCO₂e value with free-text source and year (`src/entities/EmissionFactor.ts:28-43`).
  - No gas split, GWP set, region, type or version.
  - The AI importer drops gas and WTT sub-columns (`AI/app/services/excel_parser.py:418-438`).
  - 4-decimal precision rounds small factors (`AI/app/services/excel_parser.py:284-300`).
  - Factor year = reporting year − 1, with silent fallback (`src/services/emissionWrite/resolve.ts:27-33,64-80`).
  - The FE drawer only hints at "IPCC AR6" in the source placeholder (`FE/src/features/emission-factors/components/FactorDrawer.tsx:135-176`).
  - PCF `MaterialFactor` already has `geography`, `gwp_set`, `dataset_ref`, `licence` and validity dates (`src/entities/MaterialFactor.ts:32-67`). That is a ready pattern to reuse.
- **Gap (M):**
  - Add `factor_type` (cradle_to_gate / combustion / wtt / life_cycle / eeio / supplier), `gwp_set`, `geography`, `dataset` and version.
  - Add optional CO₂ / CH₄ / N₂O / other columns, and widen precision.
  - Keep WTT columns on import as their own factor type, which also fixes Cat 3.
  - Warn on year fallback for typed entries too.

### 4.5 Spend-based / EEIO
- **Guidance:**
  - Spend × EEIO factor per sector.
  - Adjust spend for **inflation** to the factor's base year and use the right currency.
  - Use it mainly for screening and small categories.
- **Today:**
  - Currency conversion is live FX, refreshed every 12 h, applied on the *calculation* day and not stored. The code comment itself says callers should persist the rate (`src/services/fxRate.ts:3-12`, `src/services/emissionWrite/units.ts:52-64`).
  - Only INR, USD and EUR convert. GBP, BHD, SAR and AED are offered in the dropdown but fail (`src/utils/defaultExtraFields.ts:24`, `units.ts:36-38`).
  - `spent_value` is an extra field outside the calculation.
  - No EEIO model, no inflation adjustment, no sector classification (`eeio`, `exiobase`, `inflation`, `deflat` and `CPI` have no hits).
- **Gap:**
  - Store the FX rate and date and use the transaction-date rate (**S**).
  - Add the missing currencies (**S**).
  - Use EEIO sector factors with a price base year and apply a deflator (**M**).

### 4.6 Data quality, primary vs secondary data, improving over time
- **Guidance:**
  - Assess data with quality indicators for technology, time, geography, completeness and reliability.
  - Separate primary from secondary data.
  - Rank supplier data by specificity: product → process → facility → business unit → corporate (Table IV).
  - Prioritise improvement where quality is low and emissions are high.
  - **Describe data quality in the report.**
  - Disclosing the % of emissions calculated from supplier or value-chain data is expected.
- **Today:**
  - For corporate rows there is only approval status, evidence files, the audit log, the factor snapshot and import warnings (`FACTOR_FALLBACK_YEAR`, `LOW_CONFIDENCE_MATCH`) (`src/services/emissionWrite/index.ts:262,323`).
  - There is no DQI or primary flag.
  - PCF has the full model: DQR technology / geography / time, emission-weighted DQR and primary data share (`src/pcf/engine/computePcf.ts:16-20,205-232`, `FE/src/features/footprint-result/components/DataQualityTab.tsx:27`).
- **Gap (M):**
  - Reuse the PCF DQR model on emission rows, with defaults derived from method + factor type + evidence.
  - Add a primary/secondary flag.
  - Add a "Data quality" tab to the GHG report with the quality × emissions matrix and the % from supplier data.

### 4.7 Proxy data, sampling and extrapolation
- **Guidance:** proxy data, extrapolation from partial coverage (for example 80 of 100 sites, or 10 suppliers with 85% of volume) and sampling (Appendix A) are allowed if disclosed.
- **Today:** none. Sites without data are excluded, not estimated (`src/reporting/ghg.ts:447`).
- **Gap (M):** an "extrapolated" row type with its basis (coverage %, intensity), flagged as secondary.

### 4.8 Allocation
- **Guidance:** when supplier data comes at facility or company level, allocate it to the purchased product using physical (mass, units) or economic keys (Scope 3 Standard ch. 8; Cat 1 hybrid formula 1.3).
- **Today:**
  - Allocation exists **only in PCF**: plant Scope 1+2 split by mass, machine hours, energy, economic or manual key (`src/pcf/engine/computePcf.ts:175-194`, `src/entities/PcfStudy.ts:20,64-65`).
  - The inverse case is not supported: a supplier's facility emissions allocated to *our* purchases.
- **Gap (M):** reuse the PCF allocation logic in the Cat 1/2 hybrid method. Example: supplier facility tCO₂e × (our tonnes / their output tonnes).

### 4.9 Reporting (Scope 3 Standard ch. 11, as referenced throughout the guidance)

| Required / expected item | Today | Gap |
|---|---|---|
| Scope 3 emissions **per category (1–15)** | One Scope 3 KPI, plus a chart by free-text category name (`src/reporting/ghg.ts:264,330-360`; `FE/src/features/ghg-report/components/ScopeTab.tsx:21-32`) | M (needs 4.1) |
| List of categories included and **excluded, with justification** | The exclusions text covers only sites without data and renewables (`src/reporting/ghg.ts:447`) | M |
| **Methodology, data types and sources, and factors** per category | One generic sentence (`src/reporting/ghg.ts:448`). The FE page has no methodology section. | M (needs 4.3, 4.4) |
| **Data quality description**, % from supplier data | None | M (needs 4.6) |
| **GWP source** disclosed | None. AR4 is used in the Cat 11 seed. | S |
| Per-gas breakdown (optional) | None | M (needs 4.4) |
| **Biogenic CO₂ reported separately** | None. Hard-coded to 0 in PCF (`src/pcf/engine/computePcf.ts:216-219`). | M |
| Offsets / avoided emissions **reported separately, not netted** | No offsets. "Net emissions" on Overview = gross minus renewables avoided (`FE/src/ui/glossary.ts:72-75`, `FE/src/features/overview/Page.tsx:143-144`). | S (copy) |
| **Base year and recalculation policy** (significant method or data-quality changes trigger recalculation) | Base year exists only in the SBTi tools. No recalculation (`src/controllers/emission.controller.ts:2455-2560`). | M |
| Organisational boundary approach | Hard-coded "Operational control" | S–M |
| Findings rule | The FE "dominates the footprint" rule compares only S1 vs S2, so Scope 3 is never named, unlike the backend PDF (`FE/src/features/ghg-report/logic.ts:423` vs `src/reporting/ghg.ts:137-141`) | **S** (bug) |
| SBTi Scope 3 target coverage (67% of S3) | Only the "S3 ≥ 40% needs a target" rule (`FE/src/features/targets-sbti/logic.ts:17-18`) | S |

### 4.10 Calculation integrity (not in the guidance, found while comparing)
- **Historical import and seed bypass the engine** and can store spreadsheet totals (`src/services/historicalImport.ts:100-101`, `src/seeds/seedEmissionsFromExcel.ts:266-267`). This breaks the repo rule that every total goes through `emissionWrite` (**S**).
- **A factor with no unit is applied with no unit check** (`src/services/emissionWrite/units.ts:115-117`) (**S**).
- **0.01 t rounding per row**: many small rows (for example per-trip travel) lose up to 0.005 t each (**S**). Consider storing kg or more decimals.

---

## 5. Suggested order (if and when Shyam wants to build)

1. **Foundations (M):** do these together, because everything else depends on them.
   - Category taxonomy and status per company (4.1).
   - Method and factor type with GWP set (4.3, 4.4).
   - The quick wins from section 1.
2. **Report (M):** the per-category Scope 3 table with included/excluded + reason, method and data source; GWP and boundary disclosure; data-quality summary (4.9).
3. **Data quality (M):** reuse the PCF DQR model on emission rows (4.6).
4. **Cat 1/2 supplier-specific and hybrid (L):**
   - Supplier on rows.
   - C06 supplier answers usable as corporate factors.
   - PCF allocation reused (G5, 4.8).
5. **Spend-based done properly (M):** EEIO, deflator, stored FX, and a screening page (4.2, 4.5).
6. **Missing categories by client relevance:**
   - Cat 10 and 12 for manufacturers (reuse PCF BOM and mass).
   - Cat 8/13 when leases matter.
   - Cat 14/15 only as justified exclusions unless the client base changes.

No branches, PRs or code were created for this report.
