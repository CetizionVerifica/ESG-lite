# Emission factors — where they come from and how to enter them

Applies to **Use of Sold Products** (category 20) and **Upstream / Downstream
transportation and distribution** (categories 13 / 18). Ready-to-upload
spreadsheets are in `docs/factor-files/`.

## Rules that apply to every factor in the tool

| Rule | Detail |
|---|---|
| Year N−1 | An entry dated 2026 uses the factor saved under year **2025**. Upload year N−1 for year-N data (the transport file carries 2024 and 2025). |
| Exact name | The factor's *Emission Category Name* must equal the config's mapping value letter for letter (`Grid Mix Germany`, `Road - Van - Diesel [tonne.km]`). |
| Bare unit | *Denominator Unit* is the bare activity unit (`kWh`, `litre`, `kg`, `km`, `tonne.km`), not "kg CO2e/kWh". It is compared with the unit picked on the entry form (case-insensitive). |
| One row per name per year | Two rows with the same name and year leave the tool guessing. Edit the existing row instead of adding a second. |
| Source field | Always record table + year (`DEFRA 2025 Fuels tab`, `IPCC AR5 GWP100`, `Ember 2024`). Auditors ask. |

Superadmin → Emission Factors → **Add Emission Factor** (one) or **Bulk Upload**
(spreadsheet with columns `Year, Factor Value, Denominator Unit, Source,
Emission Category Name`; site and category are chosen in the popup; only the
**first sheet** of the workbook is read).

## Use of Sold Products (three methods, three factor kinds)

| Method | Factor kind (unit) | Free source | Paid alternative |
|---|---|---|---|
| Product that uses energy | Country grid factor (kg CO2e/kWh) | [Ember yearly electricity data](https://ember-energy.org/data/yearly-electricity-data/) (gCO2/kWh ÷ 1000); India: [CEA CO2 Baseline Database v21](https://cea.nic.in/wp-content/uploads/baseline/2025/12/User_Guide_V_21.0.pdf) (FY2024-25 weighted average 0.710 tCO2/MWh) | [IEA Emissions Factors](https://www.iea.org/data-and-statistics/data-product/emissions-factors-2025) — what the Luqom workbook used. DEFRA **no longer** publishes overseas electricity factors (its tab just points to IEA/national sources). |
| Fuel sold to customers | Combustion factor (kg CO2e/litre) | [DEFRA/DESNZ conversion factors](https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting), full set, **Fuels** tab, Liquid fuels. 2025: Petrol avg blend 2.06916, Diesel avg blend 2.57082 (100 % mineral: 2.33984 / 2.66155). | — |
| Product containing gas | GWP (kg CO2e/kg) | [GHG Protocol GWP values (Aug 2024)](https://ghgprotocol.org/sites/default/files/2024-08/Global-Warming-Potential-Values%20(August%202024).pdf) — AR4/AR5/AR6 side by side; DEFRA **Refrigerant & other** tab (AR5). R134a: 1430 (AR4) / 1300 (AR5) / 1530 (AR6). R410A: 2088 / 1924 / 2256. | — |

Naming scheme used by the manual config: `Grid Mix <Country>`,
`<Fuel> - Combustion`, `<Gas> - GWP`. Naming scheme used by the Smart Config
route: `<Method> - <Choice>` (e.g. `Product that uses energy - Germany`).
One scheme per site.

Decisions still open for the product owner:

1. Grid factors: free Ember/CEA values (in the files) or the Luqom IEA values
   (Denmark differs a lot: 0.057 Luqom vs 0.132 Ember 2024).
2. GWP edition: AR5 is consistent with DEFRA and the tool's fugitive-emission
   factors; the seed originally used AR4.

Files: `docs/factor-files/UPLOAD-manual-factors-2025.xlsx` (8 rows, manual
naming), `UPLOAD-smart-factors-2025.xlsx` (same values, smart naming),
`ember-grid-intensity-selected.csv` (2022-2025 grid intensity for ~35
countries, for adding new countries).

## Transportation (freight factors)

Source: DEFRA/DESNZ conversion factors, **Freighting goods** tab plus
**WTT- delivery vehs & freight** (well-to-tank), summed. Units: `tonne.km` for
tonne-kilometre rows (HGV, van, rail, air, sea), `km` for per-vehicle-km rows.

**From Scope 3 (S3-7, decision D6):** these summed factors count well-to-tank
(WTT) inside Category 4/9, while the FERA twin can count it again in
Category 3. ESGLite now flags such rows (`WTT_ALREADY_IN_FACTOR`) and keeps
their totals as they are. Upload **new** freight factors as two factors
instead:

- the Freighting goods value alone, `factor_type` `life_cycle`,
  `includes_wtt` off, in the transport category (Upstream or Downstream);
- the WTT value, `factor_type` `wtt`, in the site's FERA category under the
  same name, so the WTT part lands in Category 3 (upstream of fuels).

Old summed factors keep `includes_wtt` on (the S3-2 backfill set it from the
source text) and old rows are not recalculated.

The production template (Chieron) holds 22 names × years 2021–2025:

```
Road - Van - {Petrol|Diesel|CNG|LPG|Unknown|Plug in Hybrid electric vehicle|Battery electric vehicle} [tonne.km] / [km]
Road - HGV (all diesel) - All rigids [tonne.km] / [km]
Road - HGV refrigerated (all diesel) - All rigids [tonne.km] / [km]
Rail - Freight train - Rail freight [tonne.km]      (was "Road - Rail" on the old sites)
Air - flight - Domestic | International
Sea - Cargo ship - General Cargo
```

`docs/factor-files/UPLOAD-transport-factors.xlsx` carries the 2024 and 2025
rows (44 rows) ready for Bulk Upload; upload it once per category (Upstream,
Downstream) per site.

Known data issues to resolve with DEFRA's published table:

- `Road - Van - LPG [km]` 2024 = 0.7166 looks mistyped (neighbouring years ≈ 0.29).
- Plug-in hybrid van factors exist only for 2024–2025.

Refresh every June when DEFRA publishes, uploading under the new year.

## Category 3 (FERA) factors (S3-7)

The site's FERA category holds the Category 3 factors. Each FERA twin records
its sub-activity in `emission.scope3_sub`:

| Sub-activity | Parent row | FERA factor |
|---|---|---|
| 3a upstream of fuels | a fuel row (Scope 1, or no scope) | `wtt`, same name as the fuel factor |
| 3b upstream of electricity | a Scope 2 row | `wtt`, same name as the electricity factor |
| 3c T&D losses | a Scope 2 row | `td_loss`, name or global name = the electricity factor's name |

- Upstream (`wtt`) factors exclude combustion: life-cycle factor minus the
  combustion factor (guidance formulas 3.1 and 3.2).
- A `td_loss` factor is uploaded **per kWh consumed**: the life-cycle grid
  factor × the grid's T&D loss rate (formula 3.3). Example: 0.8 kgCO₂e/kWh at
  a 10 % loss rate is 0.08. Name it, for example, `Grid electricity T&D
  losses` with global name `Grid electricity`, since a FERA category can hold
  only one factor per name and year. No `td_loss` factor, no 3c row.
- A FERA factor typed anything other than `wtt` or `td_loss` still makes its
  twin, with the warning `FACTOR_TYPE_MISMATCH`.
- 3d (energy bought and resold) is not supported: no client sells energy.
