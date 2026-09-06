# Use of Sold Products — configuring a site (Superadmin)

Everything is done through the Superadmin screens; no scripts. Two routes end
in the identical form. Factor sources: `emission-factor-sources.md`.

The **Calculation** tab used in both routes ships with the `feature/transport-fixes`
frontend branch (ESG-lite_FE). Until that is merged, the calculation rule can
only be set by `src/scripts/seedUseOfSoldProducts.ts` or the column-config API
(`PUT /admin/column-configs/:id` with a `calculation` body).

## What the finished setup contains

| Piece | Where | Value |
|---|---|---|
| 8 global columns | Manage Columns | Method (select), Product Name (text), Country / Fuel / Gas (select), Units Sold, Energy per Use (kWh), Lifetime Uses, Gas per Product (kg), % of Gas Released (number) |
| Units | Manage Units | kWh, litre, kg |
| Factors | Emission Factors | 8 per year (4 countries, 2 fuels, 2 gases) |
| Config | Column Config | the 8 columns; Method options; Country / Fuel / Gas depends on Method; 8 mappings; calculation rule |
| Assignment | Sites → edit site → Categories | tick *Use of sold products* (also grants the site's users) |

Formulas (the calculation rule):

| Method | multiply | activity unit |
|---|---|---|
| Product that uses energy | Units Sold × Energy per Use (kWh) × Lifetime Uses | kWh |
| Fuel sold to customers | Units Sold | litre |
| Product containing gas | Units Sold × Gas per Product (kg) × % of Gas Released ÷ 100 (percent field) | kg |

Product Name is a duplicate-identity column (two products, same country, same
month are not duplicates).

## Route A — manual (Add Column Config)

1. **Emission Factors → Bulk Upload**: site, category *Use of sold products*,
   file `factor-files/UPLOAD-manual-factors-2025.xlsx` (8 rows, year 2025).
2. **Manage Units → Add Unit** ×3: `kWh`, `litre`, `kg` for the site/category.
3. **Manage Columns → Add Column** ×8 (once, global): names and types above.
4. **Column Config → Add Column Config**: name `Use of Sold Products - Standard`,
   site, category, tick the 8 columns → Save.
5. **Edit → Options**: under Method add `Product that uses energy`,
   `Fuel sold to customers`, `Product containing gas` (ID = Label).
6. **Edit → Dependencies**: Child `Country / Fuel / Gas` ← Parent `Method`;
   dependent options (ID = Label): energy → Germany, Denmark, Netherlands,
   India; fuel → Petrol, Diesel; gas → R134a, R410A.
7. **Edit → Mappings**: *Generate from Dependencies*, then overwrite the values:

   | Key | Value |
   |---|---|
   | Product that uses energy\|Germany | Grid Mix Germany |
   | Product that uses energy\|Denmark | Grid Mix Denmark |
   | Product that uses energy\|Netherlands | Grid Mix Netherlands |
   | Product that uses energy\|India | Grid Mix India |
   | Fuel sold to customers\|Petrol | Petrol - Combustion |
   | Fuel sold to customers\|Diesel | Diesel - Combustion |
   | Product containing gas\|R134a | R134a - GWP |
   | Product containing gas\|R410A | R410A - GWP |

8. **Edit → Calculation**: Mode *Per method*, dropdown *Method*; tick the
   fields per the formula table, tick the small `%` next to *% of Gas Released*
   on the gas row, preselect units kWh / litre / kg, tick *Product Name* under
   "fields that make an entry unique" → **Save Changes**.

## Route B — Smart Config (Auto-Generate)

Uses factor names shaped `Method - Choice` so the popup can split them.

1. **Emission Factors → Bulk Upload** `factor-files/UPLOAD-smart-factors-2025.xlsx`
   (same values, names like `Product that uses energy - Germany`).
2. **Column Config** → set the page filters (site, category) → **Auto-Generate
   Config**: name it; tick all three unit groups (kwh, litre, kg), keep 2
   dimensions each; Columns tab: rename Dim 1 → `Method`, Dim 2 →
   `Country / Fuel / Gas`, number column → `Units Sold`; Mappings tab must show
   **8**; leave *create missing units* ticked → **Create Config**.
   (Renaming to an existing global column name reuses that column. Adding or
   removing a dimension clears the generated mappings — the popup now warns and
   blocks Create Config in that state.)
3. **Edit → Columns**: *+ Add existing column…* Product Name, Energy per Use
   (kWh), Lifetime Uses, Gas per Product (kg), % of Gas Released.
4. **Edit → Calculation**: as Route A step 8 → Save Changes.

Do not mix the two factor-naming schemes on one site: the mapping values must
match that site's factor names.

## Verifying the mapping (user login)

Data Entry → site → *Use of sold products* → Monthly → April 2026 → Add New
Entries. With factors from the files (year 2025):

| Row | Inputs | Expected |
|---|---|---|
| Energy, Germany | 2000 units × 0.01 kWh × 15000 uses | EF 0.3371 per kWh · **101.13 tCO2e** |
| Fuel, Diesel | 1000 litres | EF 2.57082 per litre · **2.57** |
| Gas, R134a | 100 units × 0.5 kg × 80 % | EF 1300 per kg · **52.00** |

"No emission factor found" → mapping value ≠ factor name (or wrong year).
"Unit mismatch" → denominator unit / unit list not the bare unit.
All five number boxes visible for every method → calculation rule not saved.

Adding a country later: dependent option + mapping line + factor row. No code.
