# B4-TREND claim

Module: B4-TREND (redesign track, phase 0 / M0). Spec: `docs/redesign/00-entity-map.md` (B4) and ESG-lite_FE `docs/redesign/pages/P06-overview/CLAUDE.md` (KPI delta vs last year, monthly trend, by-site "vs LY").

Plan (additive only, `GET /manager/overview`):
- `trend`: net/gross/saved per month for the trend chart. Month and quarter periods get the 6 months ending with the period's last month; CY/FY get the period's 12 months; all time gets the last 6 months ending with the latest month that has approved data. Monthly entries only, like `by_month`.
- `last_year`: the same period one year earlier (`2025-09` -> `2024-09`, `2025-Q3` -> `2024-Q3`, `2025` -> `2024`, `FY2025-26` -> `FY2024-25`; `null` for all time), computed with the same rules as the KPIs (approved only, yearly batches only for a whole year of their type), with its KPIs and per-site gross/saved/net. While the period is still running, last year is cut to the same due months (year to date; data for month M is due in M+1), `status` says `complete`, `year_to_date` or `not_due`, and no % change is given when nothing is due yet (decided by Shyam on 2026-10-09).
- `kpis.net_vs_last_year_pct` and `by_site[].net_vs_last_year_pct`: percent change of net vs last year, `null` when last year's net is 0 or there is no last year.
- Golden test in `ci/api/tests/b4-trend.test.cjs` against fixed fixture values.
