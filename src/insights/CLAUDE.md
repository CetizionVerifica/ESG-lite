# src/insights (ESG-lite): Insights backend layer

> **Layer spec.** Goes to `ESG-lite/src/insights/CLAUDE.md`.
> **Read it** after the root CLAUDE.md, `docs/insights/00-plan.md`, `01-contracts.md`, `04-decisions.md` and (for KPI panels) `src/kpi/CLAUDE.md`, and before your module's CLAUDE.md.

## Shape
```
src/insights/
  CLAUDE.md        this file
  contracts/       enums.ts schemas.ts panels.ts errors.ts rules.ts               (IN-0)
  router.ts        mounted at /insights; requireInsights; one router.use per module (IN-0)
  guard.ts         requireInsights, insightsScope (company, sites, role M/A/S)   (IN-0)
  scope.ts         resolve query → { companyId, siteIds, period, kpiOn }          (IN-1)
  cache.ts         per-panel cache keyed by (company, sites, period, stamp)       (IN-1)
  sources/         emissions.ts production.ts targets.ts kpi.ts stamp.ts          (IN-1)
  derive/          index.ts (indexing, shares, status) lmdi.ts (IN-5)            (IN-2, IN-5)
  panels/          summary.ts (IN-1) esgRing.ts decoupling.ts targetWall.ts (IN-2) pathway.ts completeness.ts (IN-4)
                   bridge.ts (IN-5) flow.ts (IN-6) materiality.ts (IN-7) stripes.ts snapshot.ts (IN-8)
  rules/           engine.ts thresholds.ts <ruleId>.ts                            (IN-3)
  events/          crud.ts                                                        (IN-4)
  ai/              reword.ts guard.ts budget.ts prompts/card.md                   (IN-9)
```
- **Entities:** `src/entities/InsightEvent.ts` (IN-4), `InsightAiCall.ts` (IN-9).
- **Migrations:** `src/scripts/migrateIn<Thing>.ts` → `migrate:in-<thing>`.
- **Tests:** `ci/api/tests/in-<n>-*.test.cjs`, `ci/unit/in-*.test.cjs`, `ci/golden/in/`.

## Rules
1. **Switch and roles first.**
   - Every route runs `authenticate` → `requireInsights` (403 `IN_OFF`), except `GET /insights/status`.
   - Users get `IN_FORBIDDEN`. Managers are limited to `accessibleSiteIds`; a site outside scope → 404 `IN_SITE_NOT_FOUND`. A Superadmin passes `company_id`.
   - KPI panels check `kpiOn` from `scope.ts` and return `availability: 'kpi_off'` with `data: null` and HTTP 200.
2. **Sources only read.** `sources/*` are thin adapters over existing code:
   - `emissions.ts` → the functions behind `GET /manager/overview` (extracted by IN-1 into `src/services/managerOverview.service.ts`, behaviour unchanged).
   - `targets.ts` → the functions behind `POST /user/targets/tables` and `/long-term-chart` (extracted the same way), plus `src/kpi/targets/service.ts` (`targetsWithProgress`).
   - `kpi.ts` → `src/kpi/esg/service.ts`, `kpi/dashboard/service.ts`, `kpi/values/yearly.ts`. Never re-query `kpi_value` with your own aggregation.
   - `production.ts` → the functions behind the production intensity endpoints.
   - If a function you need isn't exported, extract it in a refactor-only PR with the original controller's tests unchanged. Never copy logic.
3. **Approved only.** Every source call passes the approved filter its owner uses. `pending_not_in` comes from the same pending counts Overview and `/kpi/esg` show.
4. **New figures only in `derive/`.** Index series, shares, expected progress, status, LMDI drivers and flow widths are pure functions in `derive/` with unit tests. Panels assemble; they don't calculate.
5. **Envelope always.** Every panel returns `PanelResponse<T>` (`01-contracts` §2): availability, period label, `pending_not_in`, `stamp`, `links`. `null` means no data, never 0.
6. **Company scoping in SQL.** Every query filters by `company_id`. Events: Managers may write only for their sites or company-level (`site_id null`) when they reach all sites.
7. **Cache.** `cache.ts` wraps each panel: key (panel, company, sites, period, query extras, stamp). `stamp` = `sources/stamp.ts` (max approved_at of emissions and KPI values in scope, max `insight_event.updated_at`). TTL 10 min. Send `ETag: stamp`; answer 304 on match.
8. **Performance budget.** `summary` ≤ 400 ms p95 on the IN-10 fixture; other panels ≤ 800 ms p95. Use the existing aggregate queries; no N+1 per site or per KPI.
9. **AI** (IN-9): only through `ai/reword.ts`, budgeted (`ai/budget.ts`, I14), logged in `insight_ai_call`, guarded (`ai/guard.ts`, `01-contracts` §8). Prompts contain rule params and company display name only.
10. **Tests every module adds:** tenant isolation, the role matrix, site scope, switch-off, `kpi_off` availability for KPI panels, every new error code, migrations run twice, and its golden cases switched from `skip` to `run`.
