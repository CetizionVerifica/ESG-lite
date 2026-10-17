# src/features/kpi (ESG-lite_FE) — KPI tracking frontend layer

> Layer spec. Goes to `ESG-lite_FE/src/features/kpi/CLAUDE.md`. Read it after the root CLAUDE.md, `docs/kpi/00-plan.md`, `01-contracts.md`, `04-decisions.md` and **`05-ux.md`**, and before your module's CLAUDE.md.

## Shape
```
src/lib/kpi/
  contracts.ts   enums, types, error codes (KPI-0; mirrors ESG-lite src/kpi/contracts)
  labels.ts      plain names for topics, frameworks, statuses, value types (KPI-0)
  switch.ts      kpiTrackingOn(user, siteId?), useKpiTracking() (KPI-1)
  units.ts       allowed units, conversion preview (KPI-4)
  formula.ts     formula preview and dependency display (KPI-6)
src/features/kpi/
  CLAUDE.md      this file
  routes.tsx     one page entry per module (KPI-0 creates it)
  setup/         Admin setup wizard and settings (KPI-3)
  my-kpis/       contributor to-do list, entry card, table view, template upload (KPI-7)
  review/        Approvals → KPIs tab content (KPI-8)
  targets/       targets (KPI-9)
  dashboard/     coverage rings, KPI cards, gaps (KPI-10)
  reports/       framework reports and downloads (KPI-11)
  library/       Superadmin KPI library (KPI-2)
  components/    KPI-only shared pieces: FrameworkBadges, KpiQuestionCard, ProgressByFramework, FromYourDataChip
src/test/msw/kpi.ts   API mocks for every §3 endpoint (KPI-0), kept in step by each module
```
Module layout per `src/features/README.md`: `Page.tsx`, `components/`, `hooks/`, `api.ts` (TanStack Query). Pages don't import from other feature folders. Pieces shared with the rest of the app move to `src/ui`.

## Rules
1. **Switch everywhere.**
   - `kpiTrackingOn` gates nav items (`shell/nav.ts` `navFor`), routes (`routeMap.ts`), command palette entries (`shell/commands.ts`), the My month "KPIs due" card and the Approvals "KPIs" tab.
   - A deep link while off shows `EmptyState`: "KPI tracking isn't turned on for your company."
   - A server `KPI_TRACKING_OFF` response gets the same state.
2. **`05-ux.md` is binding.**
   - Contributors see plain questions, never disclosure codes as titles.
   - Framework badges go through `FrameworkBadges`, with a tooltip for each code.
   - Auto values are read-only and show `FromYourDataChip`, linking to the source rows.
3. **One entry component.** Every value is entered through `KpiQuestionCard`, which provides:
   - the value input with its unit (`UnitInput`);
   - last period's value;
   - an optional breakdown, evidence (`FileDrop`), comment and estimate flag.

   The card is used by My KPIs, the table view's row drawer and the review drawer's edit mode.
4. **Never lose work.** Drafts save on blur and after 1 s idle (`PUT /kpi/values`). `useUnsavedGuard` covers anything still unsaved. Optimistic updates roll back on error with a toast.
5. **Server numbers win.** Unit and formula previews come from `src/lib/kpi/`. A total, intensity or framework figure shown on a report or dashboard comes from the API, never from FE arithmetic.
6. **Design system.**
   - `src/ui` components and tokens only: no hex, no `isDark`.
   - Four themes; widths 1280 / 1024 / 768 / 390.
   - Loading, empty and error states on every page; keyboard paths; dialogs trap focus.
   - Status words follow the redesign plan.
7. **Tests every module adds:**
   - unit tests for any logic in `src/lib/kpi/` and its own `logic.ts`;
   - a Playwright check of its main path;
   - a Playwright check that the page is hidden when the switch is off;
   - MSW handlers updated with its endpoints.
