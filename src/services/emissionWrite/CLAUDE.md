# IM1 · Emission write service (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/services/emissionWrite/CLAUDE.md`.
> Depends on: IM0. Blocks: IM2 part 2, IM8, IM11. Lane L1.

## Outcome
One function set computes and saves an emission entry. Typed entries (`createEmission`) and every import path use it, so a row gives the same total whether it was typed, uploaded or sent by Claude, for **every category**.

## Why
Today the calculation for a typed entry lives inside `emission.controller.ts` `createEmission` (~line 423 to 780: period validation, mode lock, factor lookup via `utils/findEmissionFactor.ts`, calc spec via `services/calculationSpec.ts` and `activityValue.ts`, unit conversion, FERA twin, duplicate check). The AI service has a second copy for imports (`excel_parser._import_claimed_document`). Copies drift (see P23 notes, FE #130/#134).

## Build
`src/services/emissionWrite/`
- `resolve.ts`: activity name → factor (order: plan match, client mapping P23, exact factor name, exact `global_category_name`, trimmed case-blind, as `findEmissionFactorForCategory`), year fallback, unit normalisation and conversion.
- `period.ts`: `ImportRow.period` → `date_of_reporting`, `reporting_period`, `year_type` (CY Dec 31, FY Mar 31), validation via `services/reportingPeriod.ts`.
- `checks.ts`: scope (site, category, User's own categories), mode lock (`findModeLockConflict`), duplicate existing (same month, emission_category and calc-spec identity columns), duplicate in plan (warning).
- `compute.ts`: single value, `per_method` / `per_unit` calc spec, FERA twin (categories that trigger it today), rounding exactly as now.
- `index.ts`: `EmissionWriter` implementation (`planRows`, `insertRows`) from IM0. `insertRows` writes source rows, FERA rows with `fera_linked_id` both ways, `upload_batch_id`, `emission_factor_snapshot`, `created_by`, status pending, and one audit row each ("Imported via <channel> by <name>", batch id).
- `createEmission` calls `planRows` + `insertRows` for its one row (inside its existing transaction). Response shape of `POST /user/emissions` unchanged.
- Batch-friendly: factors, mappings, specs and existing-month rows loaded once per (site, category, year), not per row.

## Must not
- Change any saved number. `ci/golden` must pass without `UPDATE_SNAPSHOT`.
- Change `updateEmission` in this module (follow-up only if needed).

## Own tests
- Parity first (before moving code): `ci/api/tests/im1-parity.test.cjs` saves one typed entry per fixture category (Scope 1 fuel, Scope 2 electricity, saving category, `per_method`, `per_unit`, FERA trigger, yearly CY and FY) and stores totals; after the refactor `planRows` returns the same totals and `createEmission` saves the same rows.
- `ci/unit/im1-*.test.cjs`: resolve order, year fallback warning, unit conversion, each row issue code IM1 owns, rounding of tiny totals (< 0.005 kept as a ready row, matching #23 behaviour).
- Golden snapshot unchanged.

## Audit rows
MCP-09, MCP-10, MCP-11, MCP-22 (golden).

## Acceptance
- Golden and parity tests green; `createEmission` diff is only the call into the service.
- 5,000 rows across 3 categories plan in under 10 s on the CI database.

## As built (IM1, 2026-10-12)
- Files: `units.ts` (the conversion table and `getConversionFactor` / `unitsMatchExact`, moved from the controller unchanged; the controller imports them), `resolve.ts` (`FactorIndex` resolves in memory with the six steps of `utils/findEmissionFactor.ts`; `MappingIndex` reads the column config's `emission_category_mapping` then the P23 table, site-specific first; `resolveActivity` order plan match → mapping → factor), `period.ts` (`toStoredPeriod`, `monthsCovered`), `context.ts` (`ContextCache`: one load per site × category of assignment, form, spec, select columns, factors, FERA category + factors, mappings), `checks.ts` (`CheckCache` for mode lock and existing rows, `findDuplicate`, `planIdentity`, `planModeConflicts`), `compute.ts` (`computeTotal`, `feraTwinFor`, `factorSnapshot`; the same expressions and rounding as before), `index.ts` (`prepareEntry`, `insertEntry`, `planRows`, `insertRows`, `emissionWriter`).
- `createEmission` keeps its own request validation, period check, mode lock and duplicate/replace responses, then calls `prepareEntry` (factor, total, twin) and `insertEntry` inside one transaction. Its 400 messages for no factor, unit mismatch and spec fields are produced by the service, unchanged (the golden snapshot checks them).
- Typed entries dedupe on the exact date (as before); imports dedupe by month (`duplicateScope: "month"`, the default of `planRows`). Yearly rows never dedupe against saved rows, as before.
- `NO_FORM` is raised for a value-less row when the site × category has no column config (fields, if any, can't be interpreted); a row with `activity_value` computes like a typed entry (categories without a form exist and work today). With a form but no value and no spec: `MISSING_VALUE`.
- `DISTANCE_REQUIRED` (D6): no `activity_value`, no spec, and a field name that looks like a place without one that looks like a distance.
- `insertRows` plans the ready rows again inside the caller's transaction, under the caller's `WriterContext`: scope (`IMPORT_FORBIDDEN` for a site or category outside it), mode lock, duplicates against saved rows and totals are checked against the database as it is at commit time, never trusted from an earlier plan. A row that no longer computes throws `IMPORT_PLAN_HAS_ISSUES` with its `row_ref`; a row whose factor id, total or twin total differs from the plan's result (a factor edited or a mapping moved meanwhile) throws the same code with `details.reason = "PLAN_STALE"`, so what the user confirmed is what gets stored; either error rolls the transaction back. The plan's activity resolution is kept (passed as plan matches), so a confirmed match never re-resolves differently. Imported rows store `extra_data.import = { channel, row_ref }` and `extra_data.notes`; each row (and its twin) gets an `audit_log` row, action `import`, reason "Imported via Claude | Bulk upload | API by <name> (batch <id>, <source>)".
- Deliberate change on the typed path: the parent and its FERA twin are written in one transaction. Every reason to skip the twin (no FERA category, no factor for the year, unconvertible unit, mode lock on the FERA category, no quantity) is decided in `prepareEntry` before anything is written, so the only twin failure left is a database fault during the save, which now rolls the parent back too instead of leaving a parent whose twin insert failed half-way (before: the twin was saved after the parent in its own try/catch).
- Edits (S3-4): `updateEmission`, `managerUpdateEmission` and the FERA twin recalculation use `prepareEntry` (factor, unit check, kgCO₂e, snapshot, warnings, twin); `getEmissionFactorForEmission` (a read for the factor panel) still calls `findEmissionFactorForCategory`.
- Tests: `ci/unit/im1-engine.test.cjs` (no database), `ci/api/tests/im1-parity.test.cjs` (typed vs planned totals, issues, `insertRows` on company 2 / site 3, cleaned up after). Golden snapshot unchanged.

## Scope 3 methods (S3)


> Layer spec. Appended by S3-0 to `ESG-lite/src/services/emissionWrite/CLAUDE.md` under a "## Scope 3 methods (S3)" heading. Read it before changing anything in this folder.

### After S3-0
- `compute.ts` only dispatches: `computeRow(ctx, row)` picks `methods/<method>.ts` (`01-contracts.md` §6). Today's behaviour is `methods/activity.ts` plus `methods/spec.ts` plus `methods/fera.ts`, moved without any change. The golden suite must stay byte-identical in the S3-0 PR.
- Each method file exports `compute(ctx, row): ComputedRow | EngineError` and is owned by exactly one module: activity/spec → S3-0, spend → S3-5, supplier/hybrid → S3-6, fera → S3-7, proxy → S3-12. Other modules (S3-8, S3-9, S3-10, S3-11) add units, specs and factor rows, not new method files, unless their spec says so.

### Rules
1. **Same path for every channel.** Typed entries, bulk upload, smart import, Claude/MCP and (after S3-4) the historical import go through `planRows → prepareEntry → insertRows`.
2. **The snapshot is the audit trail.** Every new row stores the full `FactorSnapshot` (§6), `method`, `dq`, `data_type`. A spend row also stores `fx`, and a supplier row stores `supplier_id` and the `supplier_factor` id in the snapshot.
3. **Totals:** `total_emission` is tCO₂e at 3 dp (`roundTonnes` in `round.ts`, #209 / D14). `total_kgco2e` is written beside it at 4 dp (D5). Never round before multiplying. Reports never add `total_emission`: they add the rows' kg and round once with `src/reporting/kgTotals.ts` (D14).
4. **Warnings never block** (`01-contracts.md` §7). Errors block the row only, never the whole batch, except for the existing all-or-nothing import plan rules.
5. **FE mirror:** when a method changes, update `ESG-lite_FE/src/lib/emissions/emissionCalc.ts` in the FE PR of the same module, so the preview matches. The FE never sends a total (`CLIENT_TOTAL_IGNORED` stays).
6. **Edits:** `updateEmission`, `managerUpdateEmission` and the FERA recalculation move onto `computeRow` in S3-4, so edits get methods and DQ too.

### As built (S3-0, 2026-10-15)
- `methods/activity.ts` (`compute`, `applyFactor`, `totalFor`), `methods/spec.ts` and `methods/fera.ts` (`feraTwinFor`) hold the old `compute.ts` bodies unchanged. `spend`, `supplier`, `hybrid` and `proxy` re-export activity's `compute` with a TODO naming their module.
- `compute.ts` keeps the types and `factorSnapshot`, adds `computeRow(ctx, row)` (spec category → spec; `row.proxy` → proxy; `row.method` spend_based / supplier_specific / hybrid → their file; else activity) and keeps `computeTotal` as a wrapper, so `index.ts` is unchanged. Rows carry no method yet; the form's `method_options[0]` fallback comes with S3-3.
- `Computed` gains optional `total_kgco2e`, `method`, `dq`, `data_type`, all unset. Golden snapshot byte-identical before and after (sha256 of the LF file `bd2f996f…`).
- Tests: `ci/unit/scope3-engine-split.test.cjs`.

### As built (S3-8, 2026-10-16)
- `methodFor` (compute.ts): row `method` → `@method` → **the first offered method whose `method_options` units hold the row's unit** (`methodForUnit`, unit keys via `normalizeUnitKey`; `context.ts` loads `method_units`) → `method_options[0]` → `average_data`. It only labels the row (method, DQ, data_type); `methodFileFor` and the spend default in index.ts are unchanged, so no total moves.
- `transportWarnings.ts`: `ESTIMATED_DISTANCE` and `TRANSPORT_PAID_BY_MISMATCH` (warnings, never block).


### As built (S3-6, 2026-10-16)
- `methods/supplier.ts`: quantity (converted with `units.ts`) × the supplier's `kgco2e_per_unit`. The figure is chosen before the engine runs by `pickSupplierFactor` (`src/scope3/suppliers/engineInput.ts`): the row's `supplier_factor_id`, else the newest figure up to the reporting year whose item matches the activity name, else the supplier's only item. Snapshot `{factor_type: "supplier", supplier_id, supplier_factor_id, item, factor_value, denominator_unit, boundary, reference_year, gwp_set, source}`.
- `methods/hybrid.ts`: the supplier's Scope 1+2 — from `energy` input lines when the row has any, else the facility data allocated by mass or economic value with `src/scope3/suppliers/allocate.ts` (the PCF rule) — plus the `extra_data.inputs[]` lines × factors of the same site × category. Snapshot `components[]`; the total is their sum.
- `compute.ts`: supplier-specific and hybrid rows dispatch before the spec check (§6 rule 2; no stored row carried either method, so nothing moved). `EngineRow.factor` may be null for them (the activity needs no factor of its own). A method may return `snapshot`, `supplier_id` and `quality` (the DQ inputs to read instead of the row factor; never stored). The supplier figure's evidence counts as the row's for reliability and `data_type`.
- `index.ts`: `EntryInput.supplier_id` / `supplier_factor_id`; `prepareSupplier` loads the supplier inside the site's company only (another company's id → `FIELD_INVALID`) and resolves the hybrid lines; `insertEntry` stores `emission.supplier_id` and the method's snapshot (`entryFactorSnapshot`). Edits of supplier and hybrid rows recalculate from the same supplier and figure.
- Imports: the row shape has no supplier field yet, so a supplier-specific or hybrid import row gets `FIELD_REQUIRED` (supplier_id); typed entries carry it.
