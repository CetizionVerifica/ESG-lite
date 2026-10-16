# S3-6 · Suppliers: supplier-specific and hybrid methods (Cat 1, 2)

> Module spec. Lane L3. Copy it to `ESG-lite/src/scope3/suppliers/CLAUDE.md` and `ESG-lite_FE/src/features/scope3/suppliers/CLAUDE.md`. PR titles `[S3-6 k/m] …` (expect 3 to 4: tables and API, engine methods, FE pages, C06 link).
> Depends on (merged): S3-2, S3-3 · Owns: `src/scope3/suppliers/*`, `supplier`, `supplier_factor`, `supplier_facility_data`, `emission.supplier_id`, `emissionWrite/methods/supplier.ts` and `hybrid.ts`, FE `features/scope3/suppliers/*` · Touches: `supplierRequest.controller.ts` (accept), add-data Cat 1/2 forms

## Job to be done
Purchases of goods can be calculated with the supplier's own product footprint, or with the supplier's allocated energy plus the materials it bought (hybrid). The supplier figures already collected for product footprints (C06) count for the company inventory too. The report can then say what share of Scope 3 comes from supplier data.

## Guidance
- **Supplier-specific:** Σ (quantity of goods purchased × supplier-specific product emission factor), using the supplier's cradle-to-gate product data. Formula [1.1], L1745. Example 1.1, L1754.
- **Hybrid:** the supplier's Scope 1+2 allocated to the purchased goods, plus the material inputs × cradle-to-gate factors, plus upstream transport and waste. Formulas [1.2], L1832, and [1.3], L1942, with allocation by physical or economic keys (Scope 3 Standard ch. 8).
- **Data specificity hierarchy:** product → process → facility → business unit → corporate (Table IV, L1305–1321).
- **Combining methods:** the large suppliers get supplier data; the rest use average or spend data (the coffee example, L1183–1210).

## Today
- C06 accept writes a company `MaterialFactor` with licence `supplier` for PCF only (`ESG-lite/src/controllers/supplierRequest.controller.ts:414-480`). Neither `emissionWrite` nor `reporting` reads it.
- `supplier_name` is only an extra field (`src/utils/defaultExtraFields.ts:25`).
- PCF allocation exists in `src/pcf/engine/computePcf.ts:175-194`.

## Build
### Backend (ESG-lite)
1. `migrate:scope3-suppliers`: `supplier`, `supplier_factor`, `supplier_facility_data`, `emission.supplier_id` (`01-contracts.md` §4).
   - The backfill creates `supplier` rows from distinct `extra_data.supplier_name` per company (trimmed, case-folded) and from `supplier_request.supplier_name/email`.
   - It links emission rows by name and writes the matches to a review list. It never merges two names automatically.
2. API: `GET/POST/PUT /suppliers` and `GET/POST /suppliers/:id/factors` (Manager+ on own company). Also `POST /suppliers/:id/facility-data` for hybrid inputs.
   - A factor whose boundary isn't `cradle_to_gate` → `SUPPLIER_FACTOR_BOUNDARY`, unless `confirm_boundary: true` is sent (the same pattern as C06, `supplierRequest.controller.ts:418-429`).
3. **C06 link (D8):** on accept, also write a `supplier_factor` (source `supplier_request`, `material_factor_id` set, evidence = the uploaded file) and link or create the `supplier`. PCF behaviour is unchanged.
4. `methods/supplier.ts`:
   - Activity quantity × `supplier_factor.kgco2e_per_unit` (unit conversion via `units.ts`). The year rule is the supplier factor's `reference_year` ≤ the reporting year. Prefer the newest.
   - Snapshot: `factor_type supplier`, `supplier_factor_id`, `reference_year`, `gwp_set`.
   - DQ: auto, with reliability 1 when evidence is present.
5. `methods/hybrid.ts`:
   - Allocated supplier S1+2: `facility.scope12_tco2e × (purchased_qty / facility.output_qty)` with `allocation_key` (mass by default, or economic). This reuses the PCF allocation helper, extracted to `src/scope3/suppliers/allocate.ts`, without changing PCF results (run the PCF golden).
   - Plus material inputs: the `extra_data.inputs[]` rows × their cradle-to-gate factors.
   - Plus optional transport and waste lines.
   - Store each component in the snapshot as `components[]`. The total is their sum.
6. **Read model** `suppliers.coverage(company, period)`: the share of Cat 1/2 tCO₂e from the `supplier` and `hybrid` methods, and the top 20 suppliers by tCO₂e. S3-13 uses it.

### Frontend (ESG-lite_FE)
1. **Suppliers page** `/suppliers` (Manager+):
   - List: name, country, rows this year, tCO₂e, whether a supplier figure exists, and the last request.
   - Detail drawer: factors (item, unit, value, year, evidence), facility data, and "Request data" (opens the existing C06 request flow with the supplier prefilled).
   - Name-match review list from the backfill: Link / Not the same.
2. **Add data Cat 1/2:** a Supplier field (a combobox of suppliers, with create-new). With "Supplier's own figure" selected, show the matched supplier factor ("Gulf Smelter Co., P1020 ingot, 8.6 kgCO₂e/kg, 2025"). With none found, show the hint "No figure from this supplier yet. Request one or use an average." Hybrid shows the facility data and input lines.
3. Mirror the FE preview in `src/lib/emissions/emissionCalc.ts`.

### AI service
None. The C06 readers already exist.

## Golden cases
Run `1.1`, `1.2` and `1.3` from `cases.json`. Add a regression: the PCF golden is unchanged after the allocation helper is extracted.

## Tests
- API: tenant isolation on all supplier endpoints (company 2 can't read company 1's supplier factors), boundary confirm, C06 accept writes both records, hybrid allocation by mass and by economic value.
- Playwright: create a supplier, add a factor, enter Cat 1 with "Supplier's own figure", and the drawer shows the supplier and "Good".

## Out of scope
Supplier portal logins (suppliers keep using the tokenised C06 link), and extrapolating from a sample of suppliers (S3-12).

## Done when
- A Cat 1 row can be calculated from a supplier factor or by the hybrid method.
- C06 answers appear as supplier factors.
- The supplier coverage % is available to reports.
- Golden 1.1–1.3 pass.

## As built (S3-6, 2026-10-16)
- **Part 1** (`migrate:scope3-suppliers`): the three tables, `emission.supplier_id`, the backfill (exact case-folded names only).
- **Part 2** (engine): `emissionWrite/methods/supplier.ts` and `hybrid.ts`; `allocate.ts` (shared with PCF, which now calls it); `engineInput.ts` (what the engine gets on `EngineRow.supplier`, the figure and facility choice, the hybrid line parser); `entryInput.ts` (`supplier_id` / `supplier_factor_id` on `POST /user/emissions`). Golden 1.1–1.3 run.
- **Part 3** (API, `src/index.ts` mounts `/suppliers` behind `authenticate`, as §5 names it, the way S3-1 mounts `/company`):
  - `GET /suppliers?year=&year_type=` (rows and tCO₂e of the year, figure and facility flags, last C06 request), `POST /suppliers`, `GET/PUT /suppliers/:id` (detail: figures, facility data, requests).
  - `GET/POST /suppliers/:id/factors` (`SUPPLIER_FACTOR_BOUNDARY` 422 unless `confirm_boundary: true`; `evidence_document_id` must be a document of the company), `GET/POST /suppliers/:id/facility-data` (one row per supplier and year; a repeat replaces it, 200).
  - `GET/POST /suppliers/name-matches`: similar spellings (`nameMatch.ts`: legal-form words and punctuation ignored, or two typos in a long name) and unlinked `extra_data.supplier_name` rows. Link merges (rows, figures and facility data move, the other supplier row goes) or links rows; Not the same is remembered as an `audit_log` row (`scope3_supplier_match`), since §4 has no table for it.
  - `GET /suppliers/coverage?year=&year_type=&status=approved|all` and `coverage(companyId, {from, to}, {statuses, siteIds})` in `service.ts` for S3-13: Cat 1/2 tCO₂e by method, coverage %, top 20 suppliers. Approved rows by default; kg summed and rounded once (D5).
  - Roles: reads any role with access to the company (layer rule 3; contributors need the list for the add-data Supplier field); writes and the name-match list Manager, Admin, Superadmin. Another company's ids → 404.
  - Audit: `scope3_supplier` (create, update, merge, link_rows), `scope3_supplier_factor` (create, with the boundary confirmation), `scope3_supplier_facility`, `scope3_supplier_match`.
- **C06 link (D8)**: `acceptRequest` calls `linkC06Accept` inside its transaction: the supplier by case-folded name, then email, else created; a `supplier_factor` with source `supplier_request` and `material_factor_id`. The figure's evidence is the file the supplier sent, which stays on `supplier_request` (bytea), so `has_evidence` reads it through `material_factor_id` rather than `evidence_document_id`. A figure that isn't cradle-to-gate is written only with `confirm_boundary: true`. PCF's MaterialFactor and input line are untouched.
