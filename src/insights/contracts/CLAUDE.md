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

## As built (IN-0, 2026-10-20, local branches `in-0-contracts` in ESG-lite and ESG-lite_FE)

### Backend (ESG-lite)
- **Contracts** `src/insights/contracts/`: `enums.ts` (§1, plus `KPI_PANELS`, `TARGET_STATUS_ORDER`, `CARD_SEVERITY_RANK`, `ATTENTION_KINDS`, `INSIGHTS_ROLES`, limits), `schemas.ts` (`InsightsQuerySchema` with `sites` → `'all' | number[]` sorted and unique, `DecouplingQuerySchema`, `CardsQuerySchema`, `EventsQuerySchema`, `EventCreateSchema`, `EventPatchSchema`, `MaterialityScoresBodySchema`), `panels.ts` (`PanelResponse<T>`, every §3 shape, `PanelDataMap`, `PANEL_PATHS`, `InsightsStatus`, `InsightsSites`), `rules.ts` (`RULE_IDS`, `RULES` = severities + params per rule, `AI_TEXT_MAX`, `VALUE_TOKEN`), `errors.ts` (`IN_ERRORS`, `InError`), `snapshot.ts` + `index.ts`.
- **FE reference** `ci/insights-contracts.json` (written by `npm run insights:contracts` = `scripts/insights-contracts-snapshot.cjs`; `--check` and `--diff` like the studio one). The FE keeps a copy.
- **Switch** `company.insights_enabled` (`Company.ts`, `// IN-0`), `migrate:in-switch` → `src/scripts/migrateInSwitch.ts` (idempotent). `company.controller.ts` accepts it (boolean, else 400 `FIELD_INVALID`), audited in the same transaction (`src/insights/switch.ts`, `audit_log.entity_type = 'insights'`, action `switch`). No notification (I2 names none).
- **Guard** `src/insights/guard.ts`: `insightsCompanyFor` (wraps `kpiCompanyFor`), `requireInsights` (403 `IN_OFF`, then 403 `IN_FORBIDDEN` for Users), `insightsScope(req)` → `{companyId, userId, role, siteIds, allSites, kpiOn}` (siteIds = the company's sites the caller may read, sorted), `insightsStatus`, `insightsSites`. `src/insights/http.ts`: `handle`, `parse` (→ `IN_VALIDATION` or a named code), `routeId`.
- **Router** `src/insights/router.ts`, mounted in `src/index.ts` (`app.use("/insights", authenticate, insightsRouter); // IN-0`): `GET /status` before the guard; `GET /sites` after it.
- **Docs**: `docs/insights/` = the plan folder; layer specs at `src/insights/CLAUDE.md` and FE `src/features/insights/CLAUDE.md`; every module spec copied to its destination; root CLAUDE.md blocks appended in both repos.
- **Tests**: `ci/unit/in-0-contracts.test.cjs` (enums, rules, errors, zod valid/invalid incl. sites parsing, snapshot current); `ci/api/tests/in-0-switch.test.cjs` (column default, status per role while off, tenant isolation on status and every gated route, Superadmin-only switch + audit rows, role matrix on every §4 route, `/sites` per role and Manager site scope, switch-off on every route and unknown paths, three switches in one request, migration twice); shared helpers `ci/api/tests/in-lib.cjs` (`setInsights`, `setKpi`, `INSIGHTS_CONTRACT_ROUTES`, `gatedInsightsRoutes`, `callAs`) — later modules append routes outside §4 there.

### Frontend (ESG-lite_FE)
- `src/lib/insights/contracts.ts` (mirror; `contracts.test.ts` compares it with `contracts.snapshot.json`, a copy of the backend file; `npm run check:insights-contracts` diffs the two repos), `switch.ts` (`insightsOn(user)`, `useInsights()`, `useInsightsNavOn()`, `useInsightsNeedsClient()`, `isInsightsOff()`, `useInsightsCompanyId()`), `query.ts` (`readInsightsQuery` / `writeInsightsQuery` / `useInsightsQuery`, `queryKeyPart`), `motion.ts` (static stubs: `entrance`, `countUp`, `morph`, `pulse`, `panelFade`, `prefersReducedMotion`), `InsightsGate.tsx` (not-turned-on and choose-a-client states).
- `src/services/insightsService.ts` (`getInsightsStatus`, `getInsightsSites`, `getInsightsPanel`, `panelParams`).
- `src/test/msw/insights.ts` + `insightsData.ts`: every §4 endpoint (three plants, 2021–2026), variants `setInsightsMockEnabled` (IN_OFF), `setInsightsMockKpi` (kpi_off), `setInsightsMockRole` (IN_FORBIDDEN), `setInsightsMockPanel` (no_data / setup_incomplete / 500), `setInsightsMockScored`; stateful events. Registered first in `src/test/msw/index.ts`.
- Shell: `routeMap.ts` requirement `"insights"` and routes `insights`, `insights-present`; `nav.ts` "Insights" second for Managers (under Overview), first for Admins (they have no Overview), in the Superadmin's Reports group; `commands.ts` keywords; `AppShell.tsx` flag; `pages.tsx` `RoleGuard` → `InsightsGate`.
- `src/features/insights/`: `routes.tsx` (lazy page; present placeholder), `Page.tsx` (PageHeader, `components/InsightsFilters.tsx` = site chips, E/S/G chips (KPI on only), CY/FY + year, Last year / Base year; Present and Export disabled until IN-8; stripes band, hero, 8/4 + 6/6 story grid, cards, lazy tabs that become a select below 640 px; a server `IN_OFF` swaps the page to the off state), `logic.ts` (slots, `tabsFor`, `slotForPanel`, `shellState`), `api.ts` (`usePanel`, `useInsightsSites`; 4xx not retried), `components/PanelShell.tsx` (loading / error + Retry / kpi_off hidden / empty with reason / placeholder naming the module / `?panel=` pulse; previous data dimmed while refetching), `panels/index.ts` (registry: each module appends one entry with `definePanel`), `present/PresentPlaceholder.tsx`.
- `clients/components/InsightsToggle.tsx` on the client Overview tab (after Design Studio, which sits next to KPI tracking), with inline confirm before turning off; `clients/logic.ts` `insights_enabled`.
- `overview/Page.tsx`: one "See insights →" link in the header description, switch-aware.
- Tests: `src/lib/insights/*.test.ts`, `src/test/msw/insights.test.ts`, `src/features/insights/{logic,Page}.test.ts(x)`, shell `routeMap/nav/commands` tests, `e2e/in-0-switch.spec.ts` (nav hidden when off, deep link off state, palette, Overview link, page slots at 1280 and 390, kpi_off hiding, server switch wins, Users never, Superadmin toggle shows the nav item and confirms before off). The spec reads `E2E_PORT` (default 4173) so a lane can run it on its own dev server.

### Deviations
- **Contract addition** `GET /insights/sites` → `{sites:[{site_id, name}]}` (behind the guard; added to `docs/insights/01-contracts.md` §4 and the snapshot's `otherPaths`). The header's site chips need names and the page must work without KPI tracking (the KPI lookup needs it), so IN-0 owns this read.
- Error plumbing codes `IN_VALIDATION` (400) and `IN_COMPANY_REQUIRED` (400) added, as KPI-0 and DS-0 did. A company that isn't the caller's answers 404 `IN_SITE_NOT_FOUND` (the contract's only 404 for scope).
- Materiality scores (I10): DS-2 already ships the columns (`migrate:ds-2-materiality-scores`) and `PUT /studio/materiality`. IN-0 only defines `MaterialityScoresBodySchema`; IN-7 reuses the DS-2 columns (no new migration) and decides whether `PUT /kpi/setup/materiality-scores` is needed or the DS-2 route is enough. The MSW mock answers the contract path for now.
- No PRs (local build): BE commits `[IN-0 1/3]`, `[IN-0 2/3]` (+ fix), FE `[IN-0 3/3]`.
- The 05-ux "Without KPI tracking, Story 2 becomes By scope and site" alternative is IN-2's; the IN-0 shell hides the ring slot on `kpi_off`.

### Not done
- `PendingBanner` (IN-1) is a marked spot in `Page.tsx`; the hero strip and every panel component are their modules' (`panels/index.ts` entries).
- Motion helpers are static stubs until IN-8.
