# Upstream / Downstream transportation — configuring a site (Superadmin)

Categories 13 (Upstream) and 18 (Downstream) share one setup; do it once per
category per site. Everything is done through the Superadmin screens; the
`repairTransportConfigs.ts` script remains in the repo as optional automation
but is not needed. Factor sources: `emission-factor-sources.md`.

## What the finished setup contains

| Piece | Value |
|---|---|
| Columns | Travel Mode, Vehicle Type, Fuel Type/Class (select) · Shipment Ref (text) · Weight (tonne), Distance travelled (number) |
| Units | `km`, `tonne.km` only (no kg / g.km / kg.km) |
| Factors | the 22 DEFRA freight names, years 2024 + 2025 (`factor-files/UPLOAD-transport-factors.xlsx`, 44 rows) |
| Dependencies | Vehicle Type ← Travel Mode; Fuel Type/Class ← Vehicle Type |
| Mappings | three-level keys `Road\|Van\|Diesel [tonne.km]` → factor name `Road - Van - Diesel [tonne.km]` |
| Calculation rule | **Per unit**: `tonne.km` → Weight (tonne) × Distance travelled; `km` → Distance travelled; old-entries field *Distance travelled*; unique field *Shipment Ref* |

Why per unit: `[tonne.km]` options need weight × distance, `[km]` options need
distance only, and the row's unit says which. Shipment Ref lets two shipments
on the same route in the same month coexist (previously "duplicate", and
Replace hard-deleted the first). The old-entries field keeps rows saved before
the rule (single stored product) computing unchanged.

## Route B first — Smart Config (recommended for transport)

Freight factor names are already three-level, so Auto-Generate builds the whole
dropdown tree and all 22 mappings.

1. **Emission Factors → Bulk Upload** `UPLOAD-transport-factors.xlsx` for the
   site + category (44 rows).
2. **Manage Columns**: make sure `Shipment Ref` (text) and `Weight (tonne)`
   (number) exist (global, once).
3. **Column Config** → page filters site + category → **Auto-Generate Config**:
   name (e.g. `Transport - Smart - Upstream`); tick both unit groups (`km` 9
   factors, `tonne.km` 13 factors), 3 dimensions each; Columns tab names must
   be `Travel Mode` / `Vehicle Type` / `Fuel Type/Class` and the number column
   `Distance travelled` (rename if the AI proposed others — an existing name is
   reused); Mappings must show **22**; keep *create missing units* → **Create Config**.
4. **Edit → Columns**: *+ Add existing column…* `Shipment Ref`, `Weight (tonne)`.
5. **Edit → Calculation**: Mode *Per unit*; add units `tonne.km` and `km`;
   tonne.km row → tick Weight (tonne) + Distance travelled; km row → Distance
   travelled; Old-entries field *Distance travelled*; unique *Shipment Ref* →
   **Save Changes**.

Repeat 1, 3, 4, 5 for the other category.

## Route A — manual (Add Column Config), starter set of 10 routes

Only worth doing to learn what Smart Config generates.

1. Factors and units as above (Manage Units → `km`, `tonne.km`).
2. **Add Column Config** with the six columns.
3. **Options**: Travel Mode → `Road`, `Rail`, `Air`, `Sea`.
4. **Dependencies**: Vehicle Type ← Travel Mode; Fuel Type/Class ← Vehicle Type.
   Dependent options (ID = Label):
   Road → Van, HGV (all diesel) · Rail → Freight train · Air → flight · Sea → Cargo ship ·
   Van → Diesel [km], Diesel [tonne.km], Petrol [km], Petrol [tonne.km] ·
   HGV (all diesel) → All rigids [km], All rigids [tonne.km] ·
   Freight train → Rail freight [tonne.km] · flight → Domestic, International ·
   Cargo ship → General Cargo.
5. **Mappings** — type by hand (do **not** use *Generate from Dependencies*:
   it only builds two-level keys):

   | Key | Value |
   |---|---|
   | Road\|Van\|Diesel [km] | Road - Van - Diesel [km] |
   | Road\|Van\|Diesel [tonne.km] | Road - Van - Diesel [tonne.km] |
   | Road\|Van\|Petrol [km] | Road - Van - Petrol [km] |
   | Road\|Van\|Petrol [tonne.km] | Road - Van - Petrol [tonne.km] |
   | Road\|HGV (all diesel)\|All rigids [km] | Road - HGV (all diesel) - All rigids [km] |
   | Road\|HGV (all diesel)\|All rigids [tonne.km] | Road - HGV (all diesel) - All rigids [tonne.km] |
   | Rail\|Freight train\|Rail freight [tonne.km] | Rail - Freight train - Rail freight [tonne.km] |
   | Air\|flight\|Domestic | Air - flight - Domestic |
   | Air\|flight\|International | Air - flight - International |
   | Sea\|Cargo ship\|General Cargo | Sea - Cargo ship - General Cargo |

6. **Calculation**: as Route B step 5 → Save Changes.

## Existing production sites (Chieron, Glochem, Noida, Hyderabad)

They already have Auto-Generated configs and factors (rail named `Road - Rail`,
key `Road|Rail`). Do **not** run Auto-Generate again (it would add a second
config; the form uses the first by name). Instead, per site and category:
Edit → Columns add Shipment Ref and Weight (tonne) → Calculation tab as above →
Save; Manage Units: delete stray `kg` (Noida Upstream) and `g.km` / `kg.km`
(Hyderabad). Existing rows keep their totals through the old-entries field.

## Verifying (user login)

Data Entry → site → category → Monthly → April 2026 → Add New Entries, factors
of year 2025:

| Row | Inputs | Expected |
|---|---|---|
| Road → Van → Diesel [tonne.km], SHP-001 | 5 t × 120 km, tonne.km | EF 0.7823 · **0.47** |
| same route, SHP-002 | 8 t × 120 km | **0.75**, no duplicate popup |
| Road → Van → Diesel [km], SHP-003 | 250 km, km (Weight box hidden) | EF 0.3169 · **0.08** |
| Rail → Freight train → Rail freight [tonne.km], SHP-004 | 20 t × 1500 km | EF 0.0347 · **1.04** |
| SHP-001 again, same route | | duplicate popup naming the Shipment Ref |
| tonne.km with empty Weight | | "Enter Weight (tonne) (a number greater than 0)" |

Bulk upload (`test/transport-bulk-sample.xlsx` layout: Date, Emission
Category, Travel Mode, Vehicle Type, Fuel Type/Class, Shipment Ref, Weight
(tonne), Distance travelled, Unit): 5 × 1200 → 1.44, 2 × 500 "tonne km" → 0.24
(unit tidied), no-weight row skipped with a reason, 1000 km van → 0.32.
