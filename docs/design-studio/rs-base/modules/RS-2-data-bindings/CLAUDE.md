# RS-2 · Data bindings: resolver, KPI tokens, derived figures, data hash, materiality scores

> **Module spec**, lane L2. Copy to `ESG-lite/src/kpi/studio/bindings/CLAUDE.md`.
> **PR titles:** `[RS-2 k/m]`, three PRs:
> 1. resolver and derived figures;
> 2. tokens, hash and the `/resolve` endpoint;
> 3. materiality scores (BE + FE block).
>
> **Depends on:** RS-0 · **Owns:** `src/kpi/studio/bindings/*`, `POST /kpi/studio/resolve`, `company_material_topic.impact_score|financial_score`, FE scores block in `kpi/setup`
> **Touches:** reads `src/kpi/values/yearly.ts`, `values/units.ts`, `targets/progress.ts`, `esg/headlines.ts`, `reports/model.ts`, `review/lock.ts` (no edits)

## Job to be done
Every number on every page comes from one place: approved KPI values, converted, compared and formatted consistently. It also says when data changed since someone wrote about it.

## Today
- `values/yearly.ts` returns per-KPI yearly figures with `complete`, `missing_periods` and `missing_sites`. It never counts missing as 0.
- `targets/progress.ts` gives on_track / behind / no_data.
- `esg/headlines.ts` has headline codes, multi-part sums and `DIRECTION_GOOD`.
- `reports/model.ts` builds framework rows and omissions.

## Build
1. **`resolve.ts`:** `resolveBindings(companyId, {year, yearType, sites}, bindings[])` returns `ResolvedBinding[]`.
   - Each one is `{binding, series: {kpi, name, unit, years: {year, value|null, complete, approvedAt}[]}[], goodDirection, target?: {baseline, value, year, progress, status}, evidenceCount}`.
   - Approved values only (KPI D14). `HeadlineCode` expands to its parts and sums them (same rule as `headlines.ts`).
   - Units go through `values/units.ts`; an unconvertible unit gives `RS_BINDING_INVALID`.
   - A KPI not selected by the company also gives `RS_BINDING_INVALID`.
2. **`derived.ts`:** `change_abs`, `change_pct` (vs prior, or vs base year from the KPI target baseline), `share` (part of a binding's total), `progress` (base→target), and intensity pass-through.
   - Rounding happens only at format time.
   - Division by zero or a missing input gives `null` with a reason.
   - This is the ONLY place these are computed (RS-8 and RS-9 import it).
3. **`tokens.ts`:**
   - `resolveTokens(…, KpiToken[])` returns `ResolvedToken[]`: `{token, value, formatted, unit, sources}`.
   - Helpers `collectBindings(doc)` and `collectTokens(doc)` walk a ReportDoc (elements and TextDocs).
4. **`hash.ts`:**
   - `dataHash(resolved)` is a stable sha256 over (kpi, year, sites, value, approvedAt).
   - `elementHash(element, resolved)` is the hash of only the values that element uses, for `basedOnHash` and drift (RS-10).
5. **Framework rows:** `frameworkRows(companyId, year, frameworks)` wraps `reports/model.ts` for the index flow sections (RS-1 §5).
6. **Endpoint:** `POST /kpi/studio/resolve` with `{year, sites, bindings, tokens}` returns `{values, tokens, frameworkRows?, dataHash}`.
   - Cached per (company, year, sites, max(approved_at)), and invalidated by any approval or reopen in that year.
7. **Materiality scores:**
   - Migration `migrate:rs-materiality-scores` adds `impact_score` and `financial_score` (numeric(3,1), 0–10, null) to `company_material_topic`.
   - `materiality.ts` returns topic points for the matrix chart, or `null` when any material topic lacks a score (R9).
   - **FE:** an optional "Scores (for the report's materiality chart)" block in KPI setup's materiality step, with two sliders per topic. It is shown only when the studio switch is on and is append-only in `kpi/setup`.

## Golden cases (`ci/golden/rs/bindings/`)
For a fixture company with 3 years of approved values plus a target, worked by hand:
- Scope 1+2 headline sum;
- change_pct vs prior and vs base;
- share of Scope 3;
- progress 49 %;
- energy GJ → MWh;
- a missing site year (not 0, `complete: false`);
- pending values excluded;
- a stable data hash across runs, which changes when one approval changes.

## Tests
- **API:** roles, tenant isolation, switch-off, `RS_BINDING_INVALID` cases, caching invalidated on approval.
- **Unit:** derived edge cases (zero, negative, null), Indian formatting delegated to the renderer.

## Out of scope
Drawing anything (RS-1). Detecting drift in documents (RS-10 uses `elementHash`).

## Done when
- Every binding and token in the fixture doc resolves to the hand-worked goldens.
- Derived figures exist in one module.
- The hash changes exactly when the underlying approved data changes.
