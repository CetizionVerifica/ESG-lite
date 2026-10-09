# E1 · PCF data model, calculation engine and API

> Blueprint spec. Repo **ESG-lite** (Express + TypeORM, Postgres). Read `../../00-pcf-plan.md` first.
> Everything here is proposed; nothing exists yet. Existing entities are referenced by their current names.

## Why this module exists
`getEmissionIntensity` (`src/controllers/productionData.controller.ts`) divides **all** site emissions by **all** production. That is a site intensity, not a product footprint: it ignores materials, mixes products and cannot be exchanged with buyers. E1 adds a product-level model that reuses approved plant data.

## New entities
```
Company 1─* PcfStudy *─1 Product            (Product gains: declared_unit, declared_unit_qty, mass_per_unit_kg, pcr_tag)
PcfStudy 1─* PcfInput        (one row per BOM line / transport leg / packaging / waste item)
PcfStudy 1─* PcfAllocation   (one row per site energy source allocated to this product)
PcfStudy 1─1 PcfResult       (frozen numbers + factor snapshot, written on "Calculate")
MaterialFactor (company-scoped or global) ─ used by PcfInput
SupplierRequest (phase 3) ─* PcfInput
AuditLog entity_type += 'pcf_study'
```

| Entity | Key fields | Status / enums |
|---|---|---|
| **PcfStudy** | company, product, site (producing plant), reference_start, reference_end, year_type, boundary (`cradle_to_gate` \| `cradle_to_grave`), standard (`iso14067`), pcr_tag, allocation_key (`mass` \| `machine_hours` \| `energy` \| `economic` \| `manual`), cut_off_rule_pct (default 1), version (int), parent_version_id, notes, created_by, reviewed_by/at, review_comment | **draft · in_review · approved · published · superseded** |
| **PcfInput** | study, stage (`A1` \| `A2` \| `A3_packaging` \| `A3_waste` \| `A4`…), name, material_factor_id or supplier_pcf, quantity, unit, recycled_share_pct, origin_country, supplier_name, transport: mode + distance_km + payload_t (A2), data_type (`primary` \| `secondary`), dqr_technology/geography/time (1–3), ai_suggested (bool), ai_confidence | — |
| **PcfAllocation** | study, source: category_id + scope (from `Category`), period_total_tco2e (sum of approved `Emission`), key_value_product, key_value_site_total, share_pct, allocated_kg_per_unit | — |
| **PcfResult** | study, total_kg_per_unit, by_stage jsonb, by_input jsonb, fossil, biogenic (reported separately), aircraft, luc, primary_data_share_pct, dqr_overall, factor_snapshot jsonb, emission_ids_used int[], production_ids_used int[], calculated_at, engine_version | — |
| **MaterialFactor** | company (null = global library), name, material_group (aluminium, copper, polymer, steel, packaging, chemical, energy, transport), geography, unit (kg, t, m², kWh, tonne.km, unit), value_kgco2e, gwp_set (AR6/AR5), source, source_year, dataset_ref, licence (`open` \| `ecoinvent` \| `supplier`), recycled_variant (bool), valid_from/to | — |

Transport (A2) reuses existing `EmissionFactor` rows named `Road - HGV …`, `Sea - …` (DEFRA freight + WTT) via a site lookup, and the AI sea-route service for distances.

## Calculation (pure function, unit-tested)
`computePcf(study, inputs, allocations, factors) → PcfResult`
1. **A1** = Σ over material inputs: qty_per_unit × factor. Recycled share splits the line: (1 − r)·virgin factor + r·recycled factor (cut-off).
2. **A2** = Σ legs: (mass_t × distance_km) × tonne.km factor.
3. **A3 energy** = Σ allocations: period_total_tco2e × 1000 × share ÷ product output in declared units, where share = key_value_product ÷ key_value_site_total. Only **approved** emissions of Scope 1 and Scope 2 at the study's site in the reference period; Scope 3 categories are excluded (they are covered by A1/A2 or out of boundary). Renewable/null-scope categories are excluded, but market-based Scope 2 with certificates follows the corporate inventory's own treatment.
4. **A3 packaging and waste** = inputs × factors; process losses (yield) increase A1 mass, not a separate line.
5. **Cut-off**: inputs below cut_off_rule_pct of total may be omitted, but the sum of omitted items must stay < 5%; the engine lists them.
6. **Primary data share** = emissions from primary-data inputs ÷ total. **DQR** = emission-weighted mean of the three DQR scores.
7. Round only at display; store full precision.

## API (manager routes, company-scoped; superadmin sees all)
| Method | Path | Purpose |
|---|---|---|
| GET | `/pcf/studies?productId=&status=&siteId=` | C01 list |
| POST | `/pcf/studies` | create draft (optionally copy from a previous version) |
| GET/PATCH/DELETE | `/pcf/studies/:id` | draft only for PATCH/DELETE |
| PUT | `/pcf/studies/:id/inputs` | replace inputs (builder autosave) |
| GET | `/pcf/studies/:id/allocation-preview` | live A3 from approved data for the chosen period and key |
| POST | `/pcf/studies/:id/calculate` | writes PcfResult (draft results allowed, marked draft) |
| POST | `/pcf/studies/:id/submit` · `/approve` · `/reject` · `/publish` | status flow; approve needs a different user than creator |
| GET | `/pcf/studies/:id/export?format=pdf-data\|csv\|pact` | C05 |
| GET | `/pcf/reconciliation?siteId=&period=` | Σ PCF × production vs plant S1+S2 |
| CRUD | `/pcf/material-factors` (+ `/import`) | C04 |

## Staleness
When an `Emission` or `ProductionData` row used by an approved study changes status or value (hook in the existing approve/edit controllers), mark the study `stale = true` and add a notification to the study owner. Published results are never recalculated silently; a new version is created.

## Acceptance
- Golden test: Midal pilot sheet (to be supplied in phase 0) reproduced within ±0.5%.
- Unit tests for each stage, cut-off, recycled split, allocation with 1 and many products.
- A PcfResult can be regenerated byte-identical from its factor_snapshot.
- Role guard: User role gets 403 on every `/pcf/*` route.
