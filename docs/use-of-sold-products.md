# Use of Sold Products (Scope 3 Category 11)

Implements GHG Protocol Scope 3 **Category 11 — Use of Sold Products** (category_id **20**,
previously dormant) with all three direct use-phase methods, per the boss's decision
(Sep 2026): energy-consuming products, fuels sold, and gas-containing products, with
**per-country factor selection** the way the Luqom reference workbook does it.


## Guides

- `use-of-sold-products-configuration-guide.md` — configuring a site by hand
  (Add Column Config) or with Smart Config (Auto-Generate), with the exact
  values, and a three-row verification.
- `emission-factor-sources.md` — where each factor comes from (free and paid
  sources, links), entry rules, and the ready-to-upload files in `factor-files/`.

## The three methods (GHG Protocol Technical Guidance pp. 113–121)

| Method (form dropdown) | Formula | Factor rows used |
|---|---|---|
| Product that uses energy | Units Sold × Energy per Use (kWh) × Lifetime Uses × grid factor | `Grid Mix <Country>` (kg CO2e/kWh) |
| Fuel sold to customers | Units Sold (= quantity of fuel, litres) × combustion factor | `<Fuel> - Combustion` (kg CO2e/litre) |
| Product containing gas | Units Sold × Gas per Product (kg) × % of Gas Released ÷ 100 × GWP | `<Gas> - GWP` (kg CO2e/kg) |

All three divide by 1000 at the end (factors are kg CO2e per unit; totals are stored
in tCO2e, rounded to 2 dp), same as every other category.

**Validated against the Luqom answer key** (sheet "Scope 3.11"): Lampenwelt
6,663,974 × 0.01 × 15,000 × 0.349 = 348,859.04 t; Brumberg 33,681.73 t;
Lampemesteren 1,352.99 t; QLF 214,424.66 t; category total 598,318.42 t — all
reproduced exactly by the API.

## How it works — the calculation spec

The engine everywhere computed **one** activity value × factor, discovered by a
name/magnitude heuristic. Category 11 needs a **product of several fields**, so
`column_config` gained a nullable jsonb column `calculation`:

```json
{
  "mode": "per_method",
  "method_column": "Method",
  "identity_columns": ["Product Name"],
  "methods": {
    "Product that uses energy": {
      "multiply": ["Units Sold", "Energy per Use (kWh)", "Lifetime Uses"],
      "activity_unit": "kWh"
    },
    "Fuel sold to customers": { "multiply": ["Units Sold"], "activity_unit": "litre" },
    "Product containing gas": {
      "multiply": ["Units Sold", "Gas per Product (kg)", "% of Gas Released"],
      "percent": ["% of Gas Released"],
      "activity_unit": "kg"
    }
  }
}
```

- `methods` keys are the **option ids** of the method dropdown (we use id = label).
- `multiply` lists the column names whose values multiply together; every listed
  field must be a number > 0 or the request is a 400 with a plain-language message
  (the heuristic never runs as a fallback — it would silently pick one field).
- `percent` fields are entered as percentages (80 = 80%) and divided by 100;
  values over 100 are rejected.
- `identity_columns` join the duplicate-entry identity: for category 20 a
  duplicate is site+category+date+emission_category **+ Product Name**
  (trim/case-insensitive), because the emission_category is the country/fuel/gas
  and two different products in the same country are not duplicates.
- `activity_unit` preselects the row's unit on the entry form when the method
  is chosen.

Backend implementation:

- `src/services/calculationSpec.ts` — spec loading (configs[0] by config_name,
  mirroring the frontend), product computation, duplicate identity.
- `src/controllers/emission.controller.ts` — spec branch in **all three**
  recalculation paths (createEmission, updateEmission, managerUpdateEmission),
  spec-aware duplicate check, and a FERA guard: **FERA twins never spawn for
  spec categories** (their emission_category is a country/gas name, not a fuel
  the company burned; a same-named FERA factor would have created a phantom twin).
- `src/entities/ColumnConfig.ts` — `calculation` column + `CalculationSpec` types.
- `src/controllers/columnConfig.controller.ts` — `calculation` accepted on
  create/update (absent = keep stored value; explicit null clears).

Frontend (`ESG-lite_FE`): the data-entry page loads the spec with the rest of the
config, mirrors the product in the live preview, shows/hides numeric fields per
method, prefills percentage fields to 100 (guidance: assume 100% when unknown),
preselects the method's unit, and **hides Bulk Upload** for spec categories.

AI-service: the bulk-upload engine (`app/services/excel_parser.py`) reads the same
calculation spec (`_load_calculation_spec` / `_compute_spec_activity_value`) in both
`/v1/excel/preview` and `/v1/excel/import`, so spreadsheet imports multiply the
method's fields exactly like manual entry. Rows it cannot compute (missing field,
% > 100, unknown method, no factor, unit mismatch) get a `row_error` in the preview
and are **skipped** on import — never saved with a zero or one-field total. Legacy
categories keep the pre-existing one-value behavior bit-for-bit.

## Superadmin data (seeded)

`npx ts-node src/scripts/seedUseOfSoldProducts.ts [site_id ...]` (idempotent;
defaults to sites 27 Noida + 24 Chieron) creates:

- Global columns: Method (select), Product Name (text), Country / Fuel / Gas
  (select, depends on Method), Units Sold, Energy per Use (kWh), Lifetime Uses,
  Gas per Product (kg), % of Gas Released (numbers).
- Config "Use of Sold Products - Standard" with the cascading dropdown, the
  label-chain → factor-name mapping, and the calculation spec above.
- Units kWh / litre / kg; factors for years 2024 and 2025 (factor-year rule:
  data year N uses factors of N−1): Grid Mix Germany 0.349, Denmark 0.057,
  Netherlands 0.28 (IEA, from the Luqom reference), India 0.713 (IEA);
  Petrol 2.31, Diesel 2.68 (DEFRA); R134a 1430, R410A 2088 (IPCC AR4 GWP100).

The script does **not** assign category 20 to any site — that stays a deliberate
Superadmin action (Sites → edit → tick the category), which also grants it to the
site's users. To add a country later: add its option to the Country / Fuel / Gas
dependent options, a mapping row `"Product that uses energy|<Country>" → "Grid Mix
<Country>"`, and upload a `Grid Mix <Country>` factor for year N−1. No code change.

## Managing emission factors for this category (Superadmin)

**Where the numbers come from** (free public tables; record the table name in the
factor's Source field):

| Method | Factor kind | Source |
|---|---|---|
| Product that uses energy | Country grid factor, kg CO2e/kWh | IEA yearly emission-factor tables (or national grid authorities) |
| Fuel sold to customers | Fuel combustion factor, kg CO2e/litre | DEFRA GHG conversion factors (annual) |
| Product containing gas | GWP of the gas, kg CO2e/kg | IPCC Assessment Report GWP100 values — one edition company-wide (see GWP note below) |

**Adding a factor by hand:** Superadmin → Emission Factors → Add Emission Factor →
Site → Category `Use of sold products` → Year → Factor Value → Denominator Unit
(`kg CO2e/kWh` / `.../litre` / `.../kg`) → Source → Emission Category Name. Bulk
Upload / Smart Upload on the same page take whole spreadsheets.

**Two rules:** the Emission Category Name must byte-match the config's mapping
target (`Grid Mix Germany`, `Petrol - Combustion`, `R134a - GWP` naming scheme),
and factors are looked up at data-year minus 1 — upload year N−1 for year-N entries.

**Adding a new country/fuel/gas** is three admin steps, no code: dropdown option +
mapping line + factor row (see "Superadmin data" above).

## Getting these changes running (any environment)

Copy-paste steps for a team member pulling this branch — local machine or a
shared/public DB (each step is idempotent; skip what's already done):

```bash
# 1. Check out the branch in ALL THREE repos (backend, frontend, ai-service)
git fetch origin && git checkout feature/use-of-sold-products
```

```sql
-- 2. One-time DB column (run on the target database; safe, additive)
ALTER TABLE column_config ADD COLUMN IF NOT EXISTS calculation jsonb NULL;
```

```bash
# 3. Seed the category setup (columns, dropdowns, units, factors) for a site.
#    From the backend repo; repeatable; defaults to sites 27 (Noida) + 24 (Chieron):
npx ts-node src/scripts/seedUseOfSoldProducts.ts
# or for specific site id(s):
npx ts-node src/scripts/seedUseOfSoldProducts.ts 20
```

4. Assign the category to the site: Superadmin → Sites → edit the site → add
   **Use of sold products** to its Categories → Save (this also grants the
   site's users access).

5. Restart the backend and the ai-service so both pick up the new code
   (`npm run dev` / `uv run python main.py`). Then: Data Entry → the site →
   Use of sold products → a date in 2025/2026 → **Add New Entries**.

Sanity check: an energy entry of 1000 units × 0.01 kWh × 15000 uses, Germany,
must show **52.35 tCO2e**.

## Production deploy

Order: **DB → backend → frontend → ai-service** (each step is
backwards-compatible with the previous ones running).

1. DB (safe additive DDL; nothing else touches the column):

   ```sql
   ALTER TABLE column_config ADD COLUMN IF NOT EXISTS calculation jsonb NULL;
   ```

2. Deploy backend, then frontend, then ai-service.
3. Run the seed script against prod for the go-live sites (or configure by hand),
   then assign category 20 to the sites via the Superadmin UI.

Until a config's `calculation` is set, **nothing changes anywhere**: every
existing category has `calculation = NULL` and takes the exact pre-existing code
paths (verified by regression tests on Stationary Combustion incl. FERA twinning).

## Changes in this branch (`feature/use-of-sold-products`)

**Backend (this repo):**
- `src/entities/ColumnConfig.ts` — new nullable `calculation` jsonb column + types.
- `src/services/calculationSpec.ts` — new: spec loading, product computation,
  duplicate identity.
- `src/controllers/emission.controller.ts` — spec branch in createEmission,
  updateEmission, managerUpdateEmission; spec-aware duplicate check; FERA-twin
  guard for spec categories.
- `src/controllers/columnConfig.controller.ts` — `calculation` on create/update.
- `src/scripts/seedUseOfSoldProducts.ts` — new: idempotent category-20 setup.
- `docs/` — this file + `use-of-sold-products-testing.md`.

**Frontend (ESG-lite_FE):** spec-aware live preview (`useEmissionCalculation`),
per-method field visibility, percent prefill, unit preselect on the data-entry
page; types.

**AI service (python_AI_service):** spec-aware bulk upload in
`app/services/excel_parser.py` (preview + import; invalid rows skipped with
`row_error`), `fetch_column_config` reads `calculation` and orders by
config_name.

**Database (prod checklist):** one additive column —
`ALTER TABLE column_config ADD COLUMN IF NOT EXISTS calculation jsonb NULL;`

## Known limitations / follow-ups

- Bulk upload for spec categories is supported (added Sep 2026, second commit):
  the Python engine mirrors the spec. Note the spreadsheet's Method and
  Country/Fuel/Gas cells must use the exact option labels (e.g. "Product that
  uses energy", "Germany") and emission_category the exact factor name. Bulk
  import still bypasses the duplicate check and the yearly mode lock (both
  pre-existing engine-wide gaps, not specific to this category).
- The Superadmin UI has no editor for the `calculation` jsonb yet; it is set by
  the seed script or via the column-config API. Editing other parts of the config
  in the UI preserves the spec.
- Refrigerant GWPs in the seed are AR4 values (R134a 1430, R410A 2088), matching
  the GHG Protocol guidance PDF's era. Note the tool's existing Fugitive
  Emissions factors follow DEFRA, which switched from AR4 to AR5 in its 2023
  set (R-404A 3922 → 3943 in the data) — so AR5 (R134a 1300, R410A 1924) is
  likely the consistent choice for current years. Awaiting product decision
  before production factor upload; changing is a factor-value edit, no code.
- Country list is per-site config data (Germany/Denmark/Netherlands/India seeded);
  extending it is admin work, not code.
