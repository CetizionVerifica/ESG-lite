# IN-0 · Contracts, docs copy, per-client switch, MSW mocks, empty router, page shell and nav

> **Module spec**, lane L1. Copy to `ESG-lite/src/insights/contracts/CLAUDE.md`.
> **PR titles:** `[IN-0 k/m]`, three PRs:
> 1. BE: contracts, switch migration, guard, empty router, status endpoint, docs copy, root CLAUDE.md block;
> 2. FE: contracts mirror, switch, MSW mocks, page shell, route, nav, command, client toggle, Overview link;
> 3. FE: `PanelShell`, `api.ts` `usePanel`, `query.ts`, motion stubs.
>
> **Depends on:** — · **Owns:** `src/insights/contracts/*`, `router.ts`, `guard.ts`, `company.insights_enabled`, `docs/insights/*`, FE `src/lib/insights/{contracts,switch,query,motion}.ts`, `src/test/msw/insights.ts`, `src/features/insights/{routes,Page,api}.tsx`, `components/PanelShell.tsx`, `InsightsToggle`
> **Touches:** routes index, `Company.ts`, `company.controller.ts`, both root CLAUDE.md files, FE route registry, `shell/nav.ts`, `commands.ts`, `clients/DetailPage.tsx`, `overview/Page.tsx` (one link)

## Job to be done
Everything later modules need to build in parallel: the shapes, the switch, the page frame and mocks for every endpoint.

## Build
### Backend
1. **Contracts** exactly as `01-contracts` §1–§8: `enums.ts`, `schemas.ts` (zod `InsightsQuerySchema`, event bodies, scores body), `panels.ts` (TS types for each panel and `PanelResponse<T>`), `errors.ts`, `rules.ts` (RuleId list and params per rule).
2. **Switch:** `migrate:in-switch` adds `company.insights_enabled boolean not null default false` (idempotent). `company.controller.ts` accepts it in the Superadmin client update, like `kpi_tracking_enabled`.
3. **Guard:** `requireInsights` (403 `IN_OFF`), `insightsScope(req)` returning `{companyId, role, siteIds, kpiOn}`; Users → `IN_FORBIDDEN`.
4. **Router:** `src/insights/router.ts` mounted with one line `app.use('/insights', authenticate, insightsRouter) // IN-0`. `GET /insights/status` → `{enabled, kpi_tracking}` (before the switch).
5. **Docs:** copy `plans/insights/*` to `ESG-lite/docs/insights/`; copy layer and module files to their destinations; add the `02-root-claude-snippets` blocks.

### Frontend
1. `src/lib/insights/contracts.ts` mirror; `switch.ts` (`insightsOn(user)` from the session's company flags; `useInsights()`).
2. `src/test/msw/insights.ts`: a handler for every endpoint in `01-contracts` §4 with fixture data shaped like the artifact's example company (3 plants, 2021–2026). Include a `kpi_off` variant and an `IN_OFF` variant.
3. Route `/insights` (and `/insights/present` placeholder) in the route registry; nav item "Insights" under Overview (Manager, Admin; Superadmin with client picker); command palette entry; "See insights" link on Overview's header — all switch-aware.
4. `InsightsToggle` on the client detail Overview tab, next to the KPI toggle (Superadmin only).
5. `Page.tsx`: `PageHeader`, sites chips, E/S/G chips, CY/FY + year, compare segmented control, Present and Export buttons (disabled until IN-8), the layout grid from `05-ux` §3 with named slots filled from `panels/index.ts`.
6. `PanelShell`, `usePanel(panelId, query)` (TanStack Query, key = panel + query), `useInsightsQuery()` (URL ↔ query), `motion.ts` stubs returning static options.

## Tests
- **API:** switch-off for `/status` vs others; role matrix on a dummy panel route; tenant isolation of `company_id`; migration twice.
- **Unit:** zod schemas (valid and invalid queries, sites parsing).
- **Playwright:** nav hidden when off; deep link shows the off state; toggle by Superadmin shows the nav item; page renders slots on mocks at 1280 and 390.

## Done when
Contracts exist in both repos, the switch works end to end, the page shell renders on mocks with every slot in its state, and later lanes can start.
