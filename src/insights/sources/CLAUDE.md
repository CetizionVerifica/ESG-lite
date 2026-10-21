# IN-1 · Insights backend core: scope, cache, sources, summary (hero strip)

> **Module spec**, lane L1. Copy to `ESG-lite/src/insights/sources/CLAUDE.md`.
> **PR titles:** `[IN-1 k/m]`, three PRs:
> 1. refactor-only extraction of the Overview and Targets computations into services (no behaviour change);
> 2. `scope.ts`, `cache.ts`, `sources/*`, `GET /insights/summary`;
> 3. FE `HeroStrip`, `PendingBanner`.
>
> **Depends on:** IN-0 · **Owns:** `src/insights/{scope,cache}.ts`, `sources/*`, `panels/summary.ts`, `src/services/managerOverview.service.ts`, `src/services/sbtiTargets.service.ts`, FE `components/HeroStrip.tsx`, `PendingBanner.tsx`
> **Touches:** `controllers/managerOverview.controller.ts`, the targets controller behind `/user/targets/*` (extract only)

## Job to be done
One trustworthy way for every panel to read emissions, production, targets and KPI data, plus the hero strip that answers "are we on track?" in one glance.

## Today
- `managerOverview.controller.ts` exports `parseOverviewPeriod`, `lastYearPeriod`, `lastYearComparison`; the totals are computed inside `getManagerOverview`.
- SBTi tables and long-term chart are computed in the controller behind `POST /user/targets/tables` and `/long-term-chart`.
- `src/kpi/esg/service.ts` already composes pillars, trends, sites, movers and `pending_not_in`.

## Build
1. **Extraction PR (first, alone).**
   - Move the body of `getManagerOverview` into `computeManagerOverview(caller, query)` in `src/services/managerOverview.service.ts`; the controller calls it. Same for the SBTi computations → `computeNearTermTables(…)`, `computeLongTermChart(…)` in `src/services/sbtiTargets.service.ts`.
   - No logic change. Existing API tests and goldens must pass byte-identical. The PR body lists every moved function.
2. **`scope.ts`:** parse `InsightsQuerySchema`, resolve `siteIds` against `accessibleSiteIds` (404 `IN_SITE_NOT_FOUND`), compute period start/end for CY/FY, `kpiOn` from the company.
3. **`sources/`:**
   - `emissions.ts`: `netGross(scope)`, `monthly(scope, months)`, `byScope`, `bySite`, `byCategory`, `pendingCount` — all via `computeManagerOverview`.
   - `production.ts`: `outputByYear(scope, years)`, `intensity(scope)` via the production intensity functions.
   - `targets.ts`: `sbtiStatus(scope)` via `sbtiTargets.service.ts`; `kpiTargets(scope)` via `kpi/targets/service.ts` `targetsWithProgress`.
   - `kpi.ts`: `esg(scope)` via `kpi/esg/service.ts`; `coverage(scope)` and `gaps(scope)` via `kpi/dashboard/service.ts`.
   - `stamp.ts`: the cache stamp (layer rule 7).
4. **`cache.ts`:** `cached(panel, scope, extras, fn)` with the key and TTL from I11; ETag/304.
5. **`GET /insights/summary`** → `Summary` (`01-contracts` §3):
   - `net` and `intensity` exactly as Overview for the same period and sites; `good` from direction (down is good).
   - `pathway` from `sbtiStatus` with I6 thresholds; `null` when no base year is set.
   - `readiness` from `/kpi/esg` pillars (null when KPI off).
   - `attention` items: approvals (pending emissions + production + KPI values), KPI gaps count, off-track targets, missing submitters this month, categories above threshold — each with a link.
6. **FE `HeroStrip`** in `KpiStrip`: four cells per `05-ux` §4, count-up via `motion.countUp`, mini tri-ring (three tiny ECharts gauges or an SVG arc trio from `useChartTheme().pillars`), attention `Menu`. When KPI off, cell 3 shows renewable share from `summary` (add `renewable_share_pct` to `Summary` via an IN-0 follow-up if needed).
7. **FE `PendingBanner`** from the summary's `pending_not_in`.

## Golden cases (`ci/golden/in/summary/`)
Fixture: 3 sites, 5 years, approved and pending rows, an SBTi base year, 40 KPIs with targets.
- net and intensity equal `/manager/overview` for CY and FY, one site and all;
- pathway status on_track / at_risk / off_track at the three threshold edges;
- pending items excluded and counted;
- readiness equals `/kpi/esg` coverage.

## Tests
- **API:** roles, site scope, tenant isolation, switch-off, `kpi_off` (readiness null, still 200), 304 on matching ETag, cache busts after an approval.
- **Unit:** scope period maths (FY crossing years), stamp.
- **Playwright:** hero renders, attention menu links, banner link.

## Done when
The extraction is merged with no test change, `/insights/summary` matches Overview and Targets on the fixture, and the hero strip renders in all states.

## IN-1 as built (backend)
- **Extraction (refactor only, commit `[IN-1 1/3]`):** `computeManagerOverview({period, siteIds, managed, categoryIds})` (`src/services/managerOverview.service.ts`, with `parseOverviewPeriod`, `lastYearPeriod`, `lastYearComparison`, re-exported by the controller); `computeNearTermTables(body)`, `computeLongTermChart(body)` (`src/services/sbtiTargets.service.ts`; bad input throws `SbtiInputError`, the controllers answer the same 400 `{message}`); `emissionIntensityComparison(siteIds, {startDate, endDate})` (`src/services/emissionIntensity.service.ts`, the per-site loop of `GET /user/emission-intensity/comparison`). Existing API tests and goldens unchanged.
- **`scope.ts`:** `resolveScope(req, schema)` (zod → `IN_VALIDATION`; `sites` outside the caller's → 404 `IN_SITE_NOT_FOUND`), `periodRange` (CY Jan–Dec; **FY N = Apr N−1 – Mar N**, the KPI convention, so `year=2026&yearType=FY` is Overview's `FY2025-26`), `overviewKey`, `periodMonths`, `periodLabel` ("CY 2026 · All sites" / site name / "n sites"), `once(scope, key, load)` (per-request memo), `kpiCallerOf(scope)` (a `KpiCaller` with `sites` = the scope's sites).
- **`panel.ts`** (added): `panelRoute(panelId, build, {schema, extras, kpi})` is every panel's GET handler: scope → `kpi_off` for KPI panels while off → stamp → `ETag: "in-<stamp>"`, `If-None-Match` equal → 304 → cached envelope (`PanelResponse<T>`). `panelResponse(...)` builds the same envelope without HTTP (the cards engine reads other panels through it). `build` returns `{data, links}` or `{availability, reason}`.
- **`cache.ts`:** in-process `Map`, key `(panel, company, sites, CY/FY, year, pillar, compare, extras, stamp)`, TTL 10 min, a failed load is dropped, swept past 500 entries; `emptyCache()` loops (never `.clear()`, which the data-safety check reads as a table wipe).
- **`sources/stamp.ts`:** sha1 (16 hex) over counts, approved tCO₂e/quantity and max `updated_at` of emission and production rows on the scope's sites, KPI values, targets, selection, frameworks, material topics (incl. scores), base year, the KPI switch, `insight_event` once it exists, salted with company, sites, kpiOn and **today's UTC date** (expected progress moves with the calendar).
- **`sources/`:** `emissions.ts` (overview, netGross, byScope, bySite, byCategory, monthly, pendingCount, netByYear, scopesByYear — fields of `computeManagerOverview`), `production.ts` (intensityBySite, productionUnits, outputBySiteYear, pendingProduction), `energy.ts` (added: electricity kWh and renewable kWh per year from approved Scope 2 + no-scope renewable rows, KPI-5's `rowGj` / `isRenewable` unchanged), `targets.ts` (sbtiSetup: base year from `company_base_year`, near-term target year = 2030 kept 5–10 years from the base, 4.2 %/yr; sbtiNearTerm, sbtiLongTerm, sbtiStatus, kpiTargets, kpiTargetStatuses), `kpi.ts` (esg, dashboard, coverage, gaps; null when KPI off or not set up), `pending.ts` (added: `pending_not_in` = Overview's `pending_review_count` + `/kpi/esg` `pending_not_in.count`, cached per stamp).
- **`derive/index.ts`** (created here, extended by IN-2): changePct, goodWhenDown, share, pathwayStatus (I6 +5 %), expectedProgress, targetStatus (I6 10 pp), combinedIntensity, readinessOf, countAbove.
- **`GET /insights/summary`** (`panels/summary.ts`). Deviations / decisions:
  - IN-0 follow-up in `contracts/panels.ts` and `01-contracts.md`: `readiness.by_pillar` values are `number | null` (a pillar with nothing counted is null, not 0) and `Summary.renewable_share_pct: number | null` (hero cell 3 when KPI is off). The FE mirror needs the same two lines.
  - intensity = Σ approved scoped emissions ÷ Σ approved production over the sites with production (the comparison endpoint's per-site figures, combined); `combined: true` and unit "mixed units" when units differ; change only when both years have the same unit.
  - pathway: a period year outside base…target, or without actual data, is `no_data`.
  - attention: approvals = pending entries (Overview) + pending production + pending KPI values; kpi_gaps = `/kpi/dashboard` gaps; off_track = KPI targets off track (I6) + 1 when the SBTi pathway is off track; missing_submitters = Overview `submission.missing`; threshold = categories whose tCO₂e moved more than `emission_threshold` (default 5 %) against Overview's last-year comparison. Only items with a count are listed.
- **Tests:** `ci/api/tests/in-1-summary.test.cjs` (parity with `/manager/overview` for CY/FY × all/one site, intensity vs the comparison endpoint by hand, pathway vs `/user/targets/tables` at on/at-risk/off-track, roles, site scope, tenant, switch-off, ETag 304, cache bust after an approval, readiness vs `/kpi/esg`); `ci/unit/in-1-core.test.cjs`; shared helpers appended to `ci/api/tests/in-lib.cjs`.
