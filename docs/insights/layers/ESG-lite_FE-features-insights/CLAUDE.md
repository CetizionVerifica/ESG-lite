# src/features/insights (ESG-lite_FE): Insights frontend layer

> **Layer spec.** Goes to `ESG-lite_FE/src/features/insights/CLAUDE.md`.
> **Read it** after the root CLAUDE.md, `docs/insights/00-plan.md`, `01-contracts.md`, `04-decisions.md` and **`05-ux.md`**, and before your module's CLAUDE.md.

## Shape
```
src/lib/insights/
  contracts.ts     enums, panel types, rule ids, error codes (IN-0; mirrors ESG-lite src/insights/contracts)
  switch.ts        insightsOn(user), useInsights()                                 (IN-0)
  query.ts         useInsightsQuery(): URL state ↔ query object                    (IN-0)
  motion.ts        entrance, countUp, morph, pulse; reduced-motion aware            (IN-8, stubs in IN-0)
  cardCopy.ts      RuleId → copy template                                          (IN-3)
src/features/insights/
  CLAUDE.md        this file
  routes.tsx       /insights, /insights/present
  Page.tsx         header, filters, PendingBanner, layout grid                      (IN-0)
  api.ts           one TanStack Query hook per panel: usePanel(panelId, query)       (IN-0)
  panels/          index.ts (registry) EsgRing Decoupling TargetWall (IN-2) Pathway Completeness (IN-4)
                   Bridge (IN-5) DisclosureFlow (IN-6) MaterialityMatrix (IN-7)
  components/      HeroStrip PendingBanner (IN-1) InsightCards (IN-3) EventsDrawer (IN-4)
                   CalcDrawer (IN-5) Stripes (IN-8) PanelShell
  present/         PresentPage.tsx slides.ts                                        (IN-8)
src/test/msw/insights.ts   mocks for every endpoint in 01-contracts §4 (IN-0), kept in step by each module
```
Module layout per `src/features/README.md`. Pages don't import from other feature folders; shared pieces move to `src/ui`.

## Rules
1. **Switch everywhere.** `insightsOn` gates the nav item (`shell/nav.ts`), the route, the command palette entry, the Overview "See insights" link and the client toggle. A deep link while off shows `EmptyState`: "Insights isn't turned on for your company." A server `IN_OFF` gets the same state.
2. **One shell per panel.** Every panel renders inside `components/PanelShell.tsx`, which handles `availability` (`kpi_off` → render nothing; `no_data` / `setup_incomplete` → `EmptyState` with the `reason` and a link), loading skeleton, error with Retry, and the `?panel=` pulse. Inside it, the chart is a `ChartFrame` with `table` and `exportName`.
3. **Server numbers win.** Panels map response fields to ECharts options and format with `src/ui/format.ts`. No sums, shares, indexes, deltas or statuses are computed in the FE. `logic.ts` files only shape options and tables.
4. **Theme.** `useChartTheme()` for every colour: `t.scopes`, `t.pillars`, heat ramp, status colours. No hex, no `isDark`. Check all four packs in light and dark.
5. **Lazy below the fold.** Hero and stories load on mount; tabs load when opened. Each panel's query key includes the full URL query; `keepPreviousData` keeps the old chart dimmed while refetching.
6. **Motion.** Only through `src/lib/insights/motion.ts`. No CSS keyframes in panels. Reduced motion → static.
7. **Drill-down.** Every clickable mark navigates using `links` from the response or the documented route in `05-ux.md` §4. Never build an ID-based URL the server didn't give, except the fixed routes listed there.
8. **Accessibility.** Each `ChartFrame` has an aria label summarising the chart in one sentence; table view on Enter; focus visible; present mode traps focus and restores it on exit.
9. **Tests every module adds:**
   - unit tests for its `logic.ts` (option shaping, table rows) and any `src/lib/insights/` code;
   - MSW handlers updated with its endpoints;
   - Playwright: its main path, its `kpi_off` behaviour (hidden), switch-off (page hidden), and 390 px.
