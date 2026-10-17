# KPI-5 · Auto KPIs from data already in ESGLite

> Module spec. Lane L2. Copy to `ESG-lite/src/kpi/auto/CLAUDE.md`. PR titles `[KPI-5 k/m]`.
> Depends on: KPI-4, KPI-2 · Owns: `src/kpi/auto/*` (one adapter per `AutoSourceKey`), `POST /kpi/auto/refresh`, the refresh hook · Touches: reads `src/reporting/ghg-data.ts`, `ghg-scope3.ts`, emission and production rows (no edits to them)

## Job to be done
Nobody types a number ESGLite already knows. Emissions by scope, energy used, production output and waste quantities fill themselves in. They are marked "From your data", and they agree with the GHG report to the decimal (00-plan §1.4, D9, D14).

## Today
- **The GHG report** (`computeGhgTables`, `computeGhgDetails`, `computeGhgByFuelType`, `computeScope3`) reads **approved** rows by period, sites and year type.
- **Fuel and electricity rows** hold activity quantities in their units (litre, kWh, MWh, kg …), with the factor snapshot.
- **`production_data`** holds approved quantities per product and site.
- **Waste:** Category 5 rows (and waste-type forms) hold quantities.

## Build (backend)
1. One adapter per key in 01-contracts §1 `AutoSourceKey`. Each adapter:
   - takes `(company, sites, period, yearType)`;
   - returns `{value_canonical, unit, breakdown?, snapshot}`, where the snapshot lists the row ids or report function, the filters and the read time.
2. **GHG adapters:** `ghg_scope1`, `ghg_scope2_location`, `ghg_scope2_market`, `ghg_scope3_total` and `ghg_scope3_category_n`. They call the reporting functions with the same filters as `GET /reports/ghg`; there's no SQL of their own for totals. Results are in tCO₂e.
3. **Energy adapters:** `energy_total`, `energy_renewable` and `energy_non_renewable`.
   - They sum the activity quantity of approved Scope 1 combustion and Scope 2 electricity rows, converted to GJ (canonical) with `units.ts`.
   - Fuel volumes and masses convert through net calorific values (NCVs) taken from the row's factor snapshot when present, otherwise from a small NCV table in `data/kpi/ncv.json` with its source (DEFRA conversion factors).
   - The renewable split uses the category's renewable flag or the activity name list in `data/kpi/renewables.json`.
   - Rows that can't be converted are listed in the snapshot as `skipped` and shown in the drawer, never silently dropped.
4. **`production_output`:** approved `production_data` quantity per site and period in the product's unit. It's used as a denominator, and only when all products share a unit; otherwise it's reported per product in the breakdown.
5. **`waste_total`:** Category 5 / waste-form rows' quantity in tonnes, with a breakdown by disposal method when the form records it.
6. **Refresh:**
   - `POST /kpi/auto/refresh?year=` (Manager+).
   - A hook after emission or production approve, reject and delete (the existing notification emit points) marks the affected auto values `KPI_AUTO_STALE`, and a debounced job (60 s) recomputes them.
   - Auto values are written through KPI-4's system writer with `source:'auto'` and `status:'approved'`, because their inputs are already approved.

## Golden cases (`ci/golden/kpi/auto.json`)
- Scope 1 and 2 for a fixture year equal `GET /reports/ghg`'s totals exactly.
- Energy from 1,000 L diesel and 10,000 kWh, worked by hand with NCVs.
- A Scope 3 category total.
- Production output.
- A refresh after rejecting one row.

## Tests
- Each adapter against the fixture.
- Staleness after approve, reject and delete.
- Read-only: a PUT on an auto value → `KPI_AUTO_READ_ONLY`.
- Tenant isolation; switch off; an emissions golden snapshot unchanged.

## Out of scope
Overriding auto values (D9). New emission categories.

## Done when
Auto KPIs fill themselves in for every period, match the GHG report, show where every number came from, and refresh when their source data changes.
