# 02 · Always-on rules for each repo's root CLAUDE.md

KPI-0 adds one block per repo, under a `## KPI tracking — see docs/kpi/` heading, in its first PR. Keep them short: the plan files carry the detail.

## ESG-lite

```md
## KPI tracking (GRI, BRSR, ESRS) — see docs/kpi/
- One per-client switch: `company.kpi_tracking_enabled` (default off, Superadmin only). Every `/kpi` route sits behind `requireKpiTracking` (403 `KPI_TRACKING_OFF`); new KPI endpoints, MCP tools and exports check it too.
- Same people as emissions: Superadmin / Admin / Manager / User with the existing site scope (`accessibleSiteIds`) and guards. No new role. Contributors enter, Managers approve (Admins don't), Admins set up.
- KPI enums, framework codes, error codes and check ids live only in `src/kpi/contracts/`. Change them there first (KPI-0 follow-up), then use them.
- A KPI is defined once in the library (`kpi_definition`) and mapped to framework disclosures (`kpi_disclosure_map`). Never store a value twice to satisfy two frameworks.
- GHG and energy KPIs are read (KPI-5) from approved rows through the reporting layer. Never recompute an emission total in `src/kpi/`; never change `src/reporting/ghg*.ts` or `emissionWrite` for KPIs.
- New tables and columns ship as idempotent `migrate:kpi-*` scripts; every new endpoint gets tenant-isolation, role and switch-off tests.
- Standards text: codes, our own wording and a source link only. No copied paragraphs.
```

## ESG-lite_FE

```md
## KPI tracking — see docs/kpi/ (in ESG-lite)
- Pages live in `src/features/kpi/` (setup, my-kpis, review, dashboard, reports, library); shared logic in `src/lib/kpi/`. Labels, framework names and units come from `src/lib/kpi/` only.
- Nothing KPI is visible unless `kpiTrackingOn(user)` (`src/lib/kpi/switch.ts`): nav, routes, command palette, My month card, Approvals tab. Deep links to KPI routes when off land on a friendly "not available" state.
- `docs/kpi/05-ux.md` is binding: plain questions (not disclosure codes) for contributors, one KPI at a time, framework badges, auto values read-only with "From your data", drafts save as you type, progress always visible.
- The FE never calculates a reported figure; previews (unit conversion, formula) mirror `src/lib/kpi/` and the server's numbers win.
```

## python_AI_service

```md
## KPI tracking — see docs/kpi/ (in ESG-lite)
- `app/kpi/` suggests only: KPI values read from documents (value, unit, period, page, confidence) and mappings for custom KPIs. It never writes values, never approves, and never calculates a reported total.
- Inputs are scoped by the caller's company (the backend passes `company_id`, the selected KPI codes and the document); log ids, never document contents.
```
