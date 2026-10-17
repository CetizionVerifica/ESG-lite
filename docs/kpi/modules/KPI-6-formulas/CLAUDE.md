# KPI-6 · Calculated KPIs: formulas, intensities, percentages

> Module spec. Lane L2. Copy to `ESG-lite/src/kpi/formulas/CLAUDE.md` and `ESG-lite_FE/src/lib/kpi/KPI-6.CLAUDE.md`. PR titles `[KPI-6 k/m]`.
> Depends on: KPI-4, KPI-2 · Owns: `src/kpi/formulas/*` (`parse.ts`, `graph.ts`, `evaluate.ts`, `recompute.ts`), FE `src/lib/kpi/formula.ts` · Touches: —

## Job to be done
Intensities and ratios calculate themselves from other KPIs and show their working. Examples: GHG per revenue, energy per tonne produced, water consumed as withdrawal minus discharge, women in the workforce in %.

## Build
### Backend
1. **Formula language:** a small, safe, non-`eval` grammar over KPI codes.
   - Supports `+ − × ÷`, parentheses, numbers, and `sum(CODE)` / `avg(CODE)` over sites.
   - Breakdown access is allowed (`WATER_WITHDRAWAL.groundwater`).
   - Units are checked dimensionally, e.g. `tCO2e / INR million` → `tCO2e/INR million`.
   - `parse.ts` returns an AST or `KPI_FORMULA_INVALID` with a position.
2. **`graph.ts`:** the dependency graph across library and custom KPIs. Cycles are refused at library or custom-KPI save time.
3. **`evaluate.ts`:**
   - Evaluates per site and period, and per company after aggregation (KPI-4).
   - A missing input gives no value with `missing: [codes]`, never a 0.
   - Division by zero gives no value with a reason.
4. **`recompute.ts`:** when an input value is approved or changes (or an auto value refreshes), recompute dependants.
   - Results are written with `source:'formula'`.
   - Status: `approved` when all inputs are approved, otherwise `pending` with "waiting for <inputs>".
5. Formula values are read-only (`KPI_AUTO_READ_ONLY`).

### Frontend
1. `src/lib/kpi/formula.ts`:
   - a preview evaluator for the entry card;
   - "How it's calculated" text ("Water consumed = withdrawn 1,200 m³ − discharged 840 m³ = 360 m³");
   - a parity unit test against backend fixtures.
2. A `FormulaExplainer` component used in My KPIs (for read-only formula values), review and the dashboard.

## Golden cases (`ci/golden/kpi/formulas.json`)
- GHG intensity per revenue.
- Energy intensity per tonne.
- Water consumption.
- Women in the workforce in %.
- A missing input gives no value.
- Division by zero.

## Tests
- **Parser:** valid, invalid, units and cycles.
- **Recompute:** on approval and on an auto refresh.
- **Read-only.**
- **FE preview parity.**

## Out of scope
User-written formulas outside custom KPIs. Conditional logic.

## Done when
Every calculated KPI in the library evaluates per site and company, explains itself, waits for missing inputs instead of showing 0, and updates when its inputs change.
