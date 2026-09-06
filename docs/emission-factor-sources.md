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
