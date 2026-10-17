# KPI-10 · KPI dashboard and framework coverage

> Module spec. Lane L4. Copy to `ESG-lite/src/kpi/dashboard/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/dashboard/CLAUDE.md`. PR titles `[KPI-10 k/m]`.
> Depends on: KPI-3, KPI-4, KPI-9 (KPI-5/6 values appear when merged) · Owns: `src/kpi/dashboard/*`, FE `kpi/dashboard` · Touches: `overview` (two KPI tiles)

## Job to be done
A Manager or Admin sees in ten seconds:
- how ready each framework is for the year;
- what's missing and who owes it;
- how each KPI is trending, including against its target.

## Today
- **Overview** (`managerOverview.controller.ts`, FE `overview`) shows emission KPI tiles with `KpiStrip`, `ScopeBar` and `ChartFrame`.
- **Report filters:** `ReportFilters` / `reportFilterModel`.

## Build
### Backend
1. `GET /kpi/dashboard?year=&framework=&site=&topic=` returns:
   - **`coverage`:** per enabled framework, `{required, approved, pending, missing, percent, core:{done,total} (BRSR)}`.
     - A disclosure counts as covered when every KPI mapped to it with `fit` exact or partial has an approved value for the year, at the level it needs.
     - Disclosures excluded with a reason are listed separately and don't count as missing.
   - **`gaps`:** `[{kpi, site, periods_missing, owner, link}]`.
   - **`cards`:** per selected KPI, the year value (aggregated), last year, % change, a 12-period series, and target progress (KPI-9).
   - **`pending_not_in`:** emissions or KPI values pending review that would change the figures (D14).
2. `POST /kpi/dashboard/remind` `{kpi, site}` (Manager+): sends `kpi_due` to the owner, at most once a day per item.

### Frontend (05-ux S5)
1. `/kpi/dashboard`:
   - a ring per framework, with a click filtering the gaps;
   - KPI cards by topic (value, change, sparkline, target bar, status dot);
   - a gaps list with "Remind" and "Open" actions;
   - filters (year, site, topic);
   - a banner "3 values pending review aren't counted yet", linked to them.
2. Overview: two tiles, "KPI readiness 78 %" and "KPIs due this month 9", shown only when `kpiTrackingOn`.

## Tests
- **Unit:** coverage counting (exact, partial and derived fits; excluded with a reason; BRSR Core).
- **API:** gaps scoped to the caller's sites; remind limited to once a day; tenant isolation; switch off.
- **Playwright:** rings filter the gaps; remind; 390 px.

## Out of scope
Benchmarking against peers. Custom dashboard layouts.

## Done when
The dashboard shows true coverage per framework, every gap with its owner, and each KPI's trend and target. The Overview links to it when the switch is on.
