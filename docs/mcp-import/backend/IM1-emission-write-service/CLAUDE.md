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
