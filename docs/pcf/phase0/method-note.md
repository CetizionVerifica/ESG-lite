# PCF method note · Midal pilot (phase 0)

> Status: **draft for sign-off**. Written 2026-10-09 from `docs/pcf/00-pcf-plan.md` §2 and §7 (ESG-lite_FE) and the E1 engine spec.
> The pilot numbers in `pilot-golden.xlsx` / `pilot-golden.json` are **placeholders, not Midal data**. They exist so the E1 engine has a fixed target to reproduce; they get replaced once Midal's BOM and one year of approved plant data are in.

## 1. Pilot
| | |
|---|---|
| Product | Midal EC-grade aluminium wire rod, 9.5 mm |
| Producing plant | Midal Cables, Bahrain |
| Declared unit | 1 kg of rod at the factory gate (`declared_unit = kg`, `declared_unit_qty = 1`, `mass_per_unit_kg = 1`) |
| Next product | AAAC conductor, using the rod footprint as its main A1 input |
| Decided by | Shyam, 2026-10-09 |

## 2. Method defaults (each needs a sign-off)
Each line is what the engine will do unless changed here. Changing a default later means a new engine version, and published results are never recalculated silently.

### 2.1 Standard
ISO 14067:2018, aligned with the GHG Protocol Product Standard.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.2 Exchange format
PACT Pathfinder Framework v3 (WBCSD) JSON, produced in phase 2 (C05). Phase 1 exports PDF and CSV only.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.3 System boundary
Cradle-to-gate: A1 raw materials, A2 inbound transport, A3 manufacturing (plant energy, packaging, process waste). Distribution, use and end of life are out of scope until phase 4.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.4 Product category rules
PEP ecopassport PCR-ed4 / EN 50693 stored as an optional tag per product; it does not change the calculation in phase 1.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.5 Allocation of plant energy (A3)
Approved Scope 1 and Scope 2 `Emission` rows of the producing site in the reference period are summed per category and split across products by **mass of approved `ProductionData`** in the same period:
`A3 energy per unit = Σ period_total_tCO2e × 1000 × (product_t ÷ site_total_t) ÷ product output in declared units`.
Scope 3 categories are excluded (covered by A1/A2 or outside the boundary). Market-based Scope 2 follows the corporate inventory's own treatment. Override per product with machine hours, metered kWh, economic value or a manual share.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.6 Recycled content
Cut-off (recycled content) approach: a recycled share `r` splits a material line into `(1 − r) × virgin factor + r × recycled factor`, where the recycled factor carries only collection and reprocessing. Waste sent to recycling carries no burden beyond its transport.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.7 Process losses
Yield losses raise the A1 input mass (the pilot uses 1.012 kg aluminium per kg of rod); they are not a separate line.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.8 Cut-off rule
Any input or transport leg below **1%** of the total is listed as a cut-off candidate; together they must stay **below 5%**. Choice made here because the spec allows two readings: **candidates stay in the total** (the engine lists them and checks the 5% limit); a user who wants to omit one deletes it from the study, and the 5% check still counts it.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.9 Reference period
12 months, calendar or fiscal year according to the company's `year_type`. Pilot: CY 2025.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.10 GWP set
IPCC AR6 GWP100 (PACT v3 requirement). A factor available only in AR5 may be used and is flagged on the result.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.11 Data quality
- **Primary data share** (PACT `primaryDataShare`) = emissions from primary-data lines ÷ total. Allocated plant Scope 1+2 counts as primary (it is measured and approved in ESG Lite).
- **DQR** 1 (best) to 3 per line for technology, geography and time; each dimension is the emission-weighted mean over all lines, and the overall DQR is the mean of the three.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.12 Biogenic carbon, aircraft, land-use change
Reported separately from the fossil total, as PACT requires. The pilot has none that is material; the pallet factor is its fossil part only.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.13 Precision
Full precision stored; rounding only on display. The engine must reproduce the golden spreadsheet within **±0.5%**, and regenerate a stored result byte-identical from its factor snapshot.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

### 2.14 Relation to CBAM
A PCF result is never reused as a CBAM "specific embedded emissions" figure. A future CBAM export may share inputs, not results.
Sign-off: ☐ agreed ☐ change to: ________ · name / date: ________

## 3. Open decisions (questions for the product owner)
1. **Secondary database.** Free sources only (IAI, DEFRA, EU EF 3.1 where licence allows, supplier EPDs), or a paid **ecoinvent** licence? Both work in the engine; with ecoinvent, C04 must hide raw factor values from clients.
   Answer: ________
2. **Commercial model.** Is PCF a paid add-on per client (adds a `Company.pcfEnabled` flag), or part of every plan?
   Answer: ________
3. **Verification.** Plan third-party verification (a read-only verifier role) for phase 2, or later?
   Answer: ________
4. **Aluminium factor for the pilot.** Use a supplier-specific footprint from the smelter (would make A1 primary data and lift the primary data share well above today's ~2%), or a regional average (IAI GCC) until the supplier provides one?
   Answer: ________

## 4. What the pilot still needs from Midal (phase 0 exit check)
- Bill of materials per kg of rod: metal input incl. yield loss, alloying additions, emulsion and other consumables, packaging per coil, process waste by route.
- Inbound logistics per input: origin, mode, distance.
- One year (CY 2025) of **approved** Scope 1+2 `Emission` rows and `ProductionData` per product at the Bahrain site in ESG Lite.
- The aluminium supplier's footprint, if available (decision 4).

When these arrive, edit the input blocks at the top of `build_golden.py`, run `python3 docs/pcf/phase0/build_golden.py`, and commit the regenerated `.xlsx` and `.json` together.

## 5. Placeholder pilot result (for orientation only, NOT Midal data)
| Stage | kg CO₂e / kg rod | Share |
|---|---|---|
| A1 materials | 8.3188 | 97.5% |
| A2 inbound transport | 0.0016 | 0.02% |
| A3 plant energy (allocated) | 0.2025 | 2.4% |
| A3 packaging | 0.0060 | 0.07% |
| A3 waste | 0.0020 | 0.02% |
| **Total** | **8.5309** | |

Primary data share 2.4% · DQR 1.65 · cut-off candidates 0.41% of total (limit 5%) · reconciliation: the pilot covers 40% of plant Scope 1+2 (below 90% is expected while only one product is footprinted).

## Files
- `pilot-golden.xlsx`: the calculation with live formulas; yellow cells are inputs.
- `pilot-golden.json`: same inputs plus the expected outputs, read by the E1 golden test.
- `build_golden.py`: generates both; edit inputs there.
