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

## As built (2026-10-20, branches `ds-2-sources` in ESG-lite and ESG-lite_FE, local only)

### Files
- **Backend `src/studio/sources/`:**
  - `types.ts` ResolvedBinding / ResolveResponse / ResolveContext, `UNAVAILABLE_REASONS`;
  - `resolve.ts` the dispatcher by `source`, token measures (`resolveToken`), site checks, the request schema, the 60 s cache;
  - `ghg.ts` GhgMetric × GhgBreakdown on `computeGhgTables`, `computeScope3`, `computeGhgByFuelType`, `baseYearSummary` and `reporting/intensity.ts`, with a per-request `GhgLoader` memo; `ghg/rows.ts` months, gases, biogenic CO₂, coverage, GWP sets and newest approval from the same approved rows and filters;
  - `kpi.ts` the RS-2 port (`figureDefs`, `loadValues`/`figureOf`, `HEADLINES`, `convert`, `progress`), `kpiYearValue` for prefill;
  - `inputs.ts` prefill (§2.1), `effectiveInputs`, `applyInputPatch` (per-key zod), `inputDisplay`, `exclusionFor`, and the `report_doc.inputs` read/write;
  - `derived.ts` (change, share, progress, intensity; null + reason), `format.ts` (the one rounding place), `hash.ts` (`dataHash`, `bindingsHash`, `elementHash`);
  - `catalog.ts` the Data drawer list; `materiality.ts` scores + routes; `doc.ts` `collectTokens`, `docBindings`, `resolveDoc`; `router.ts`.
- **Backend elsewhere:** `src/reporting/intensity.ts` (extracted EDE join; `emission.controller.ts` calls `loadIntensityMonthly`), `src/studio/router.ts` (one `router.use`, `// DS-2`), `src/entities/CompanyMaterialTopic.ts` (two columns, `// DS-2`), `src/scripts/migrateDs2MaterialityScores.ts` + `migrate:ds-2-materiality-scores`.
- **Tests:** `ci/unit/ds-2-sources.test.cjs` (13), `ci/api/tests/ds-2-sources.test.cjs` (10), golden `ci/golden/cases.json` + `fixture.sql` + `snapshot.json` (two EDE reports and production rows, recorded before the extraction in commit 1/7; unchanged after 2/7).
- **Frontend:** `src/lib/studio/contracts.ts` (ResolvedBinding/ResolveResponse confirmed; `InputPrefill`, `InputsPatch`, `InputsPrefillResponse`, `DataCatalogResponse`, `MaterialityResponse`), `src/services/studioService.ts` (DS-2 block), `src/test/msw/studio.ts` (+ tests), `src/features/studio/panels/{DataPanel,ReportDetailsForm}.tsx`, `panels/data/{api,logic}.ts` (+ tests), `src/features/kpi/setup/components/MaterialityScores.tsx` (+ test) and one line in `kpi/setup/Page.tsx` (`// DS-2`).

### Endpoints (all behind `requireDesignStudio`, role R)
| Route | Notes |
|---|---|
| `POST /studio/resolve` | `{kind, year, yearType, sites, bindings, tokens, docId?, inputs?}` → `{values, tokens, dataHash, unavailable[{bindingIdx, reason, token?}]}` |
| `GET /studio/docs/:id/inputs` · `PATCH` | `{rev, inputs, prefill}`; PATCH `{rev, inputs: {key: {value, source?} | null}}`, bumps `report_doc.rev`, 409 `DS_VERSION_CONFLICT` |
| `GET /studio/inputs/prefill?kind=&year=&yearType=&sites=` | **addition**: `{keys, prefill}` for the new-design flow before a doc exists |
| `GET /studio/data?kind=&year=&yearType=&sites=&q=&topic=&framework=` | **addition**: the Data drawer list `{groups: [{id, label, items: [{id, label, binding, resolved}]}]}` |
| `GET/PUT /studio/materiality` | **addition**: `{topics, points}`; sustainability kind (DS_KIND_OFF without KPI tracking) |

### Decisions and deviations
- **`report_doc` belongs to DS-5.** DS-2 reads/writes only `inputs` and `rev` with raw SQL (`id, company_id, kind, rev, year, year_type, draft, inputs, deleted_at, updated_by`, per RS §3 + DS §3). Until DS-5 ships the table, `/docs/:id/inputs` answers 404; the API test creates the table the §3 way (`CREATE TABLE IF NOT EXISTS`). DS-5's entity must keep those column names.
- **Per-gas metrics are tonnes of each gas** (`gas_kg` stores kg of CO₂, CH₄, N₂O), not CO₂e. **`gas_other` resolves `NOT_RECORDED`**: "total − the three" needs each factor's GWP values, which aren't stored, so it can't be derived honestly. The `gas` breakdown is tonnes of each gas. Rows without `gas_kg` → `NOT_TRACKED`.
- **Intensity numerator is total Scope 1+2+3** (as EDE). `intensity_output` uses the `output_units` input, else approved production of the doc's sites (the extracted EDE helper), with the production unit in the unit text.
- **Semantic binding errors are request errors** (422 `DS_BINDING_INVALID` with `details {bindingIdx, reason}`: `BREAKDOWN_UNSUPPORTED`, `KPI_NOT_SELECTED`, `UNIT_INVALID`); data that isn't there is per binding (`unavailable {reason}`), never an error. A KPI binding while KPI tracking is off is `KPI_TRACKING_OFF` (unavailable), so a GHG doc still renders.
- **Sites:** `'all'` = every company site and needs all-site access (`DS_SITES_SCOPE`); an id the caller can't read (another company's included) → 404. Binding sites are checked too.
- **Cache key** adds a data stamp (approved emission count + newest `updated_at` in range, KPI values, boundary, base year), so approvals and reopens show at once inside the 60 s.
- **Approval date** of GHG figures is `MAX(COALESCE(reviewed_at, updated_at))` (older approved rows have no `reviewed_at`).
- **KPI years** use the company's KPI year type (`company_kpi_settings.year_type`), as KPI-11 reports do; `value` is the first KPI's figure; a headline code sums its selected parts.
- **Exclusions** match a Scope 3 category by "Category n …" / "Cat. n" or its exact name; prefill writes `Category n · <name>` from `company_scope3_category` (excluded / not relevant).
- **Parity golden** runs in the API suite on the API fixture (both companies; CY 2024/2025, FY 2025/2026; totals and every split vs `POST /user/ghg/tables`), not in `ci/golden/run.cjs` (the DS seed companies are DS-4/DS-14's).
- The FE DataPanel inserts on click (`onInsert`); drag and drop onto the canvas is DS-6.

### Tests run
- `test-lane.sh ds-2-be`: build ok, unit ok, scope3-golden 32/32, calculation snapshot matches (23 entries, 6 reports), API 678 pass / 0 fail, workflow 50 + 29 pass, 0 fail.
- `test-lane.sh ds-2-fe`: typecheck ok, lint:new ok, vitest ok.

### Not done
- `revenue_ppp_rate` is stored and validated but no PPP-adjusted intensity metric exists in the contract; nothing reads it yet.
- Breakdowns for `scope3_category × site/month`, gases per site, and `dq_score`/`primary_data_pct` per category as series are not offered (BREAKDOWN_UNSUPPORTED).
- No Playwright spec: the panels have no route until the editor shell (DS-5/DS-6); component tests with MSW cover them.
- `elementHash` is provided for DS-13 drift but not wired anywhere yet.

## DS fix: flow tables filled server-side (2026-10-20, branch `ds-fix-flow-tables`)
- `flows.ts`: rows for `ghg_factor_table` and `scope3_categories` sections, by section id, as the renderer reads them (`RenderData.flow` / `.scope3`). The Scope 3 table is `computeScope3`'s 15 category rows (Unmapped left out): **reported** when the category has approved tCO₂e (computeScope3's figure, formatted once; method mix, DQ score), **excluded** when the report inputs exclude it (`exclusionFor`, with its reason), else **not addressed** with the boundary status as the reason. The factor table lists each approved row's factor snapshot (`ghg/rows.ts` `factorsUsed`, same filters as `approvedWhere`), one group per scope, one line per source category × factor (name, kgCO₂e per unit as stored, unit, source + version, GWP, entries), and notes rows without a snapshot. No figure is computed.
- `doc.ts` `resolveDocForRender` = `resolveDoc` + those rows in the same context; `jobs/inputs.ts` `renderInputs` uses it, so preview.html, version previews, proof, print, PNG, thumbnail and final all print the rows. A final's `data_snapshot` keeps `flow` and `scope3`. `dataHash` is unchanged (values + inputs only).
- `POST /resolve` takes optional `flows: [{id, flowType}]` and then returns `flow` / `scope3` by id (other flow types ignored; part of the cache key). Without `flows` the response is unchanged. The FE editor doesn't send it yet (FE follow-up).
- Tests: `ci/unit/ds-fx-flow-tables.test.cjs`, `ci/api/tests/ds-fx-flow-tables.test.cjs`.
