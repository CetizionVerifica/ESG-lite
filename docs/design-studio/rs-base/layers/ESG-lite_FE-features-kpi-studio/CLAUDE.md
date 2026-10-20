# src/features/kpi/studio (ESG-lite_FE): report studio frontend layer

> **Layer spec.** Goes to `ESG-lite_FE/src/features/kpi/studio/CLAUDE.md`.
> **Read it** after the root CLAUDE.md, `docs/report-studio/00-plan.md`, `01-contracts.md`, `04-decisions.md` and **`05-ux.md`**, and the KPI FE layer `src/features/kpi/CLAUDE.md`, then your module's CLAUDE.md.

## Shape
```
src/lib/report-studio/
  contracts.ts     mirror of ESG-lite src/kpi/studio/contracts (RS-0)
  switch.ts        reportStudioOn(user), useReportStudio() (RS-0)
  render/          GENERATED mirror of ESG-lite src/reporting/studio/render (RS-1). Do not edit.
  history.ts       undo/redo command stack over ReportDoc (RS-6)
  snapping.ts      snap targets, guides, equal spacing (RS-6)
  geometry.ts      mm ↔ px at zoom, rotation maths, hit testing (RS-6)
  docOps.ts        pure doc edits: add/move/resize/group/reorder/duplicate/lock (RS-6)
src/features/kpi/studio/
  CLAUDE.md        this file
  routes.tsx       one entry per page (RS-0 creates)
  home/            S1 readiness + list (RS-4)
  wizard/          S2 new report (RS-4)
  editor/          S3 shell, Canvas, Sheet, SelectionLayer, PagesPanel, LayersPanel, InsertBar, Inspector/*, ContextMenu (RS-6)
  editor/text/     TipTap editor, KpiChip node, KpiPicker, TextStyleMenu, overflow measure (RS-7)
  preview/         Page view iframe, PDF proof (pdf.js) (RS-5)
  ai/              SuggestionCard, DiffView, GhostPreview, AiMenu, FindingsPanel, BudgetMeter (RS-8)
  checks/          ChecksPanel, inline markers, FinalDialog (RS-9)
  review/          comments, review bar, drift review (RS-10)
  versions/        S6 (RS-5, RS-10)
  api.ts           TanStack Query hooks per endpoint
src/test/msw/reportStudio.ts   mocks for every 01-contracts §4 endpoint (RS-0), kept in step by each module
```
The module layout follows `src/features/README.md`. Pages don't import from other feature folders, except `kpi/components` (FrameworkBadges) through its index.

## Rules
1. **Switch everywhere.** `kpiTrackingOn && reportStudioOn` gates nav, routes, commands and deep links. When off, show `EmptyState` with "The report studio isn't turned on for your company."
2. **The sheet is the renderer.**
   - The canvas draws each free-form page with `render/renderSheet()` inside a shadow root holding the report CSS and fonts. App CSS never reaches into it.
   - Interaction (selection boxes, handles, guides, chips' hover cards) is a separate layer above the sheet, positioned with `geometry.ts`.
   - Never re-implement an element's look in React.
3. **The doc is the state.**
   - The editor state is one `ReportDoc` plus the selection, zoom and `rev`.
   - Every change is a `docOps` command pushed to `history` (undo and redo).
   - Autosave sends `PATCH {rev, doc}` 1 s after the last change. A `RS_VERSION_CONFLICT` shows the reload / keep-mine dialog (R15).
   - Never mutate in place.
4. **Numbers.** Values for tiles, charts, tables and chips come from `POST /resolve` (cached per `rev` and `dataHash`). The FE never computes a reported figure; the formatting is the renderer's.
5. **Performance.**
   - Only the visible pages ±2 render as full sheets; the rest are thumbnails.
   - Transforms run on the overlay with CSS transforms and commit on pointer-up.
   - Page view is debounced (1.5 s) and runs in a sandboxed iframe of `preview.html?mode=paged`.
   - Aim for 60 fps while dragging on a 50-page doc.
6. **AI** is always a `SuggestionCard` with Accept / Try again / Discard. An accepted suggestion is one history step, so it can be undone.
7. **Accessibility of the editor.**
   - Every element is reachable from the Layers list by keyboard.
   - Arrow keys move the selection; Enter edits; Esc goes up.
   - The inspector uses `src/ui` fields with labels, and icon buttons have `aria-label`.
8. **Tests.**
   - Unit tests for `history`, `docOps`, `snapping` and `geometry`.
   - Component tests with MSW.
   - Playwright e2e per module (`e2e/rs-*.spec.ts`), plus the switch-off path.
