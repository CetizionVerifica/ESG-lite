# 00 · Insights plan

## 1. Goal and success test

A Superadmin switches **Insights** on for a client. The client's Managers and Admins open `/insights` and, in one page:
- see whether emissions are on the SBTi pathway and how intensity moved;
- see how ready their ESG data is (if KPI tracking is on);
- understand *why* the numbers moved (output, intensity, renewables, Scope 3);
- see which material topics are off target;
- act on what needs them, with every number linking to the rows behind it.

**The plan is done (milestone IN-M3) when all of these hold:**
1. **Switch off by default.** With `company.insights_enabled` off (the default), nothing about Insights is visible or reachable: no nav item, no route, and every `/insights` endpoint answers `IN_OFF`. Overview, Targets, `/kpi/dashboard` and `/kpi/esg` are unchanged.
2. **Works with or without KPI tracking.** With KPI tracking off, the page shows the emission, production and target panels only, with no empty KPI holes. With it on, the ESG ring, KPI targets and disclosure flow appear too.
3. **First paint under 2 seconds.** On a fixture of 3 sites × 5 years × 40 KPIs, the hero strip and first story panel render in under 2 s. Other panels load lazily and fail one at a time.
4. **Server numbers win.** Every figure, percentage, index, driver and coverage value comes from an `/insights` endpoint. The FE does no arithmetic on reported figures. Panels read **approved** emissions and **approved** KPI values only, and a banner counts the pending items that aren't included.
5. **Same figures as the source pages.** For the same filters, net tCO₂e and intensity match `/overview`; pathway figures match `/targets`; coverage matches `/kpi/esg`. An IN-10 golden checks this.
6. **Every number drills down.** Clicking a hero cell, a bar, a cell, a bubble or a link opens the filtered list or page that produced it.
7. **Insight cards are true.** Each card comes from a deterministic rule (`01-contracts` §6) with code-computed numbers. With AI wording on (IN-9), the AI only rewords; numbers stay tokens and the card reads the same values.
8. **Premium feel, accessible.** Morph transitions between linked views, count-up hero numbers and staged series entry, all off under `prefers-reduced-motion`. Every chart has a table view (`ChartFrame`), colour is never the only signal, and the page passes at 390 px in four app themes, light and dark.
9. **Export.** PNG per chart (existing `ChartFrame`) and a one-page PDF snapshot of the page through the existing Playwright printer.
10. **Release discipline.** Every new endpoint has tenant-isolation, role, site-scope and switch-off tests. Every new table or column ships as an idempotent `migrate:in-*` script.

## 2. Non-negotiables

1. **Same people, same access.** No new role.
   - Managers see their sites; Admins and Superadmins (with the client picker) see the company.
   - Users (contributors) don't see Insights (`IN_FORBIDDEN`).
   - Site scope follows `accessibleSiteIds`.
2. **One switch, plus KPI awareness.** Insights lives behind `requireInsights` (`company.insights_enabled`, default `false`, Superadmin only) in both the backend and the frontend. KPI-backed panels additionally need `company.kpi_tracking_enabled`; when it's off they answer `{available: false, reason: 'kpi_off'}` instead of an error, and the FE hides them.
3. **Read, never recompute, the source of truth.**
   - Emission totals come from the same functions `/manager/overview` uses; pathway figures from the same functions `/user/targets/*` use; KPI figures from `src/kpi/values/yearly.ts`, `targets/service.ts` and `esg/service.ts`.
   - Where those functions live inside a controller, IN-1 extracts them into a callable service in a refactor-only PR with existing tests unchanged. It never copies the logic.
   - Only genuinely new figures (index, drivers, flow widths, rule values) are computed in `src/insights/derive/`, and nowhere else.
4. **Approved only.** Pending emissions and KPI values never count (KPI D14). Each panel response carries `pending_not_in`.
5. **No new chart library.** ECharts 6 through `echarts-for-react` and `ChartFrame`, themed by `useChartTheme()`. Scope colours `--t-s1/2/3`, pillar colours `--t-pillar-e/s/g`, heat ramp `--t-heat-1…5`, and status colours stay fixed across brand packs; only the brand colour changes per client.
6. **Contracts first.** Enums, panel shapes, rule ids and error codes live only in:
   - `ESG-lite/src/insights/contracts/`;
   - its mirror `ESG-lite_FE/src/lib/insights/contracts.ts`.

   Change them there first, as an IN-0 follow-up.
7. **Additive only.** No change to the behaviour of Overview, Targets, KPI dashboard, ESG dashboard, GHG report or KPI-11 exports. New tables and columns ship as idempotent `migrate:in-*` scripts that CI runs twice, and the schema-diff stays clean.
8. **AI suggests wording only.** AI never produces a number, a rule, or a chart. Its output is validated JSON with `{{v:…}}` value tokens, logged and budgeted (I13, I14).
9. **Redesign rules in the FE.** Shared components from `src/ui`, tokens, the four app themes, loading/empty/error per panel, keyboard paths, 1280 / 1024 / 768 / 390 widths. `05-ux.md` is binding.

## 3. Where the work lands

| Repo | New code | Changed code |
|---|---|---|
| ESG-lite | `src/insights/` (contracts, router, guard, scope, cache, sources, derive, panels, rules, events, ai), `src/entities/InsightEvent.ts`, `src/scripts/migrateIn*.ts`, `ci/api/tests/in-*.test.cjs`, `ci/unit/in-*.test.cjs`, `ci/golden/in/` | `src/index.ts` or the routes index (one `app.use('/insights', …)`), `Company.ts` (+switch), `company.controller.ts` (switch update), `managerOverview.controller.ts` and the targets controller (refactor-only extraction, IN-1), `CompanyMaterialTopic.ts` (+scores, IN-7, shared with RS-2), `package.json` scripts |
| ESG-lite_FE | `src/features/insights/` (page, panels, cards, present mode), `src/lib/insights/` (contracts, switch, motion, format helpers), `src/test/msw/insights.ts`, `e2e/insights-*.spec.ts` | `routes/pageRegistry.ts` or `newUiRoutes.tsx` (one entry), `shell/nav.ts` + `commands.ts` (switch-aware item), `clients/DetailPage.tsx` (+`InsightsToggle`), `overview` (one "See insights" link), `kpi/setup` (materiality scores block, IN-7, shared with RS-2) |
| python_AI_service | none | none |

## 4. Modules, dependencies and file ownership

| Id | Depends on | Owns | Touches |
|---|---|---|---|
| IN-0 | — | `src/insights/contracts/*`, `router.ts`, `guard.ts` (`requireInsights`, `insightsScope`), `company.insights_enabled`, `docs/insights/*`, FE `src/lib/insights/contracts.ts`, `switch.ts`, `src/test/msw/insights.ts`, `src/features/insights/Page.tsx` (shell with header and filters), `InsightsToggle` | routes index, `Company.ts`, `company.controller.ts`, root CLAUDE.md files, FE route registry, `shell/nav.ts`, `commands.ts`, `clients/DetailPage.tsx` |
| IN-1 | IN-0 | `src/insights/scope.ts`, `cache.ts`, `sources/*` (emissions, production, targets, kpi readers), `panels/summary.ts`, `GET /insights/summary`, FE `components/HeroStrip.tsx`, `PendingBanner.tsx` | `managerOverview.controller.ts`, targets controller (extract only; behaviour and tests unchanged) |
| IN-2 | IN-1 | `panels/esgRing.ts`, `panels/decoupling.ts`, `panels/targetWall.ts`, `derive/index.ts`, FE `panels/EsgRing.tsx`, `Decoupling.tsx`, `TargetWall.tsx` | — |
| IN-3 | IN-2 | `rules/*` (engine, rule files, thresholds), `GET /insights/cards`, FE `components/InsightCards.tsx`, `src/lib/insights/cardCopy.ts` | — |
| IN-4 | IN-1 | `insight_event` table, `src/entities/InsightEvent.ts`, `events/*`, `panels/pathway.ts`, `panels/completeness.ts`, FE `panels/Pathway.tsx`, `Completeness.tsx`, `components/EventsDrawer.tsx` | — |
| IN-5 | IN-1, IN-4 (events for annotations) | `derive/lmdi.ts`, `panels/bridge.ts`, FE `panels/Bridge.tsx` | — |
| IN-6 | IN-1 | `panels/flow.ts`, FE `panels/DisclosureFlow.tsx` | reads `KpiDisclosureMap`, `kpi/auto/adapters.ts` (no edits) |
| IN-7 | IN-2 | `panels/materiality.ts`, scores on `company_material_topic` (shared spec with RS-2, I10), FE `panels/MaterialityMatrix.tsx`, scores block in `kpi/setup` | `CompanyMaterialTopic.ts`, `kpi/setup` materiality step (append-only) |
| IN-8 | IN-2, IN-4 | FE `src/lib/insights/motion.ts`, `components/Stripes.tsx`, `present/*`, `GET /insights/snapshot.pdf` (BE, existing printer), `panels/stripes.ts` | `src/reporting/print.ts` (read-only reuse) |
| IN-9 | IN-3 | `insight_ai_call`, `src/insights/ai/*`, FE AI toggle on cards (`AiLabel`) | moves nothing; imports the OpenRouter helper (if RS-8 extracted it, use that; otherwise wrap `ai-narrative.ts`'s client without changing it) |
| IN-10 | IN-0 (draft), all (final) | `ci/golden/in/*`, `ci/workflow` IN steps, `audit/harness/in-probes.cjs`, `e2e/insights-*.spec.ts` main path | — |

## 5. Waves

| Wave | Modules | Needs merged |
|---|---|---|
| 0 | IN-0 | — |
| 1 | IN-1, IN-10 draft, FE panels on mocks | IN-0 |
| 2 | IN-2, IN-4, IN-6 | IN-1 |
| 3 | IN-3, IN-5, IN-7 | IN-2, IN-4 |
| 4 | IN-8, IN-9 | IN-3, IN-4 |
| 5 | IN-10 final | all |

## 6. Milestones

- **IN-M1, one story** (IN-0, IN-1, IN-2, IN-3):
  - Switch on; hero strip; ESG ring, decoupling, target wall; rule-based insight cards.
  - Already a sellable "executive view". Uses only data the client already has.
- **IN-M2, why it moved** (IN-4, IN-5, IN-6, IN-7):
  - Pathway with levers and annotations, completeness calendar, emissions bridge, disclosure flow, materiality × performance.
- **IN-M3, premium and presentable** (IN-8, IN-9, IN-10 final):
  - Morph transitions, stripes, present mode, PDF snapshot, AI wording. Full verification. This is the §1 success test.

## 7. Definition of done (every module)

1. Its spec's "Done when" holds, and the module spec copy has an "As built" section listing files, deviations and decisions.
2. **Backend:**
   - tenant-isolation, role, site-scope and switch-off (`IN_OFF`, and `kpi_off` availability for KPI panels) tests for every new endpoint;
   - migrations run twice and the schema-diff is clean;
   - the full lane is green: build, unit, goldens unchanged except its own, API, workflow;
   - any extraction from a controller keeps that controller's existing API tests and goldens byte-identical.
3. **FE:**
   - the redesign definition of done (four app themes, light and dark, states, keyboard, 390 px);
   - every chart inside `ChartFrame` with a table view and an aria label;
   - `05-ux.md` copy rules;
   - unit tests for any logic in `src/lib/insights/` and the module's `logic.ts`;
   - a Playwright check of its main path and of the switch-off path.
4. The last PR body has "Workflow test: N passed, M skipped" and `Completes: IN-<n>`.

## 8. Working rules for parallel lanes

- Branch from `production`. Open the first PR as a draft at once; the draft is the claim.
- **Shared files** are append-only blocks with a `// IN-n` comment:
  - the routes index (one `app.use('/insights', insightsRouter)`, IN-0);
  - `src/insights/router.ts` (one `router.use` per module);
  - `Company.ts`, `CompanyMaterialTopic.ts`;
  - `package.json` `migrate:in-*` lines;
  - `src/features/insights/panels/index.ts` (one entry per panel);
  - `shell/nav.ts`.
- **Backend before FE.** The FE of a module merges after its backend. While waiting, build against `01-contracts.md` with MSW mocks (`src/test/msw/insights.ts`).
- **Contract changes** are an IN-0 follow-up PR first.
- **Report studio overlap.** If RS-2 has merged, IN-7 uses its materiality score columns; if not, IN-7 ships the identical migration (`migrate:rs-materiality-scores`, same name and columns) and RS-2 becomes a no-op for that part (I10).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Insights shows a different total than Overview or Targets | Read through the same functions (extracted, not copied). IN-10 golden compares `/insights/summary` with `/manager/overview` and `/user/targets/tables` on the fixture. |
| Page is slow because it composes many sources | One endpoint per panel, lazy-loaded below the fold; per-panel cache keyed by (company, sites, year, data stamp); hero and first story panel only on first paint. |
| Bridge drivers look like magic or don't add up | LMDI decomposition: drivers sum exactly to the change, zero residual. A "How this is calculated" drawer shows the formula and the inputs (I8). |
| Decoupling misleads when production units differ between sites | Index per site's own unit, then combine by weight of base-year emissions; when units can't be combined, show "Combined index" with a note, as Overview does for intensity (I7). |
| Sankey implies tonnes flow into disclosures | Right half (KPI → disclosure) uses count-width links in a distinct muted style with its own legend (I9). |
| Too much animation feels gimmicky | One orchestrated entrance per panel, morph only between linked views, all motion off under reduced motion (`05-ux` §6). |
| AI wording drifts from the numbers | Values only as tokens; the guard rejects any digit outside tokens; deterministic text is always the fallback (IN-9). |
| Empty or thin data for new clients | Each panel has a designed empty state saying what data it needs and where to add it; the hero strip still works with one year of data. |
| Scope creep into a BI tool | Out of scope: custom layouts, drag-drop dashboards, peer benchmarks, user-defined rules, scheduled email digests (I15). |
