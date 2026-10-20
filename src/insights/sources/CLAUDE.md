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
