# DS-2 · Data sources: GHG resolver, KPI resolver, report inputs, data hash

> **Module spec**, lane L2, wave 1. Copy to `ESG-lite/src/studio/sources/CLAUDE.md`.
> **PR titles:** `[DS-2 k/m]`, five PRs:
> 1. resolve dispatcher + hash + KPI source (RS-2 port);
> 2. GHG source (scopes, categories, sites, months, gases, biogenic, base year);
> 3. intensity helper extraction + intensity metrics;
> 4. report inputs + prefill + endpoints;
> 5. FE ReportDetailsForm + Data drawer list API.
>
> **Depends on:** DS-0 · **Owns:** `src/studio/sources/*`, `src/reporting/intensity.ts` (extracted), `POST /studio/resolve`, `GET/PATCH /studio/docs/:id/inputs`, materiality scores (RS-2), FE `panels/DataPanel` data hooks, `ReportDetailsForm`
> **Base:** RS-2 (KPI resolver, tokens, derived, hash, materiality scores). Kept and moved under `sources/kpi.ts`.

## Job to be done
Every number on a page comes from approved data through one resolver, whichever report kind it belongs to. Things the data can't know (boundaries, policies, statements) are captured once as report inputs, so that checks can name what is missing.

## Build
1. **`resolve.ts`:** dispatches each binding by `source`. It returns `ResolvedBinding { display, value, unit, series?, approvedAt?, evidenceCount?, unavailable?: {reason} }` plus `dataHash`. Results are cached per `(companyId, kind, period, sites, bindingsHash)` for 60 s.
2. **`ghg.ts`:**
   - Build the filters exactly as `report.controller.ts:18-91` does, from `{year, yearType, compareYear, sites}`.
   - Call:
     - `computeGhgTables` for totals per scope, compare year and by site;
     - `computeScope3` for categories 1–15, DQ, primary-data %, GWP sets and biogenic;
     - `computeGhgByFuelType`;
     - the base-year service.
   - Map `GhgMetric` × `GhgBreakdown` to values and series.
   - Gases come from the per-gas kg columns on `Emission` (CO₂, CH₄, N₂O; anything else becomes `gas_other` = total − the three).
   - `scope2_market` always resolves `unavailable: {reason: 'NOT_RECORDED'}` (D7).
   - Never re-implement a total. If a breakdown isn't available from those functions, add a pure helper in `sources/ghg/` that reads approved rows with the same filters, and prove it with a golden.
3. **Intensity:**
   - Move the EDE intensity calculation (`emission.controller.ts` around lines 2388–2493) into `src/reporting/intensity.ts`, unchanged, and have the controller call it. A golden shows EDE output is byte-identical.
   - `intensity_revenue`, `intensity_output` and `intensity_employee` use report inputs (`revenue`, `output_units`, `employees`), or KPI values when KPI tracking is on.
4. **`inputs.ts`:**
   - Prefill per `01-contracts` §2.1.
   - `PATCH` validates per key.
   - `InputBinding` resolves to the value text.
   - A Scope 3 category with `exclusions[]` entry resolves to "Excluded: <reason>".
5. **Derived:** change vs prior and base, share of total, per-site share, intensity. All numbers are rounded by the doc's `NumberFormat` in one place.
6. **FE:**
   - `DataPanel` lists, per kind:
     - GHG: Scope 1/2/3, Scope 3 categories with values, sites, months, gases, intensity, base year;
     - sustainability: KPI search (RS-6 picker).
   - Each row shows its value and approval date.
   - `ReportDetailsForm` edits the inputs, with prefill source labels.

## Tests
- **Unit:** each GhgMetric × breakdown on the seed fixtures; hash stability; inputs prefill.
- **Golden:** for the 3 seed companies, DS-2 Scope 1/2/3 totals equal `POST /user/ghg/tables` for CY and FY; EDE output is unchanged after the intensity extraction.
- **API:** tenant isolation on `/resolve` (sites of another company → 404), role and switch-off; `scope2_market` → unavailable.

## Done when
Any GHG or KPI binding in `01-contracts` §2 resolves to approved values that match the existing GHG report screen, and report inputs are stored and prefilled.
