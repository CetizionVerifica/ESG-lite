# src/features/studio (ESG-lite_FE): Design Studio frontend layer

> **Layer spec.** Goes to `ESG-lite_FE/src/features/studio/CLAUDE.md`.
> **Read it** after the root CLAUDE.md and `docs/design-studio/00-plan.md`, `01-contracts.md`, `04-decisions.md` and **`05-ux.md`**, then your module's CLAUDE.md.
> **Base:** `docs/design-studio/rs-base/layers/ESG-lite_FE-features-kpi-studio/CLAUDE.md`. Its rules hold, with paths moved and the editor layout replaced by `05-ux.md`.

## Shape
```
src/lib/studio/
  contracts.ts   mirror of ESG-lite src/studio/contracts (DS-0)
  switch.ts      designStudioOn(user), kindEnabled(user, kind), useDesignStudio() (DS-0)
  render/        GENERATED mirror of ESG-lite src/reporting/studio/render (DS-1). Do not edit.
  geometry.ts    mm ↔ px at zoom, rotation, hit testing (DS-6)
  docOps.ts      pure doc edits (DS-6), applyTemplate / applyStyle (DS-3, DS-4)
  history.ts     undo/redo command stack (DS-6)
  snapping.ts    snap targets, guides, equal spacing, rulers (DS-6)
  resize.ts      client preview of a resize mapping (DS-10)
src/features/studio/
  CLAUDE.md      this file
  routes.tsx     one entry per page (DS-0 creates)
  home/          S1 (DS-5)
  new/           S2 template → scope → details → words → build (DS-5)
  editor/        shell: TopBar, SideRail, Drawer, ContextToolbar, Canvas, Sheet, SelectionLayer, Rulers,
                 PageStrip, GridView, PositionPanel, StatusBar, shortcuts (DS-6)
  editor/text/   TipTap, DataChip, DataPicker, TextPresets, footnotes, overflow measure (DS-7)
  editor/charts/ ChartToolbar, ChartKindPicker, CustomDataGrid (DS-8)
  editor/tables/ TableToolbar, TableEditor (DS-8)
  panels/        TemplatesPanel, ElementsPanel, TextPanel (DS-4/7), BrandPanel + StylesPanel (DS-3),
                 UploadsPanel (DS-4), DataPanel + ReportDetailsForm (DS-2 FE, DS-8), ChartsPanel (DS-8), PagesPanel (DS-6)
  ai/            AiPanel (chat), SuggestionCard, DiffView, GhostPreview, BriefDialog, BudgetMeter (DS-9)
  resize/        ResizeDialog, LinkedSourceChip (DS-10)
  preview/       Page view iframe, PDF proof (pdf.js) (DS-11)
  present/       Present mode (DS-11)
  share/         ShareMenu, DownloadMenu, ViewLinkDialog, public viewer page (DS-11)
  checks/        ChecksPanel, inline markers, FinalDialog (DS-12)
  review/        comments, mentions, tasks, ApprovalBar, VersionHistory, drift review (DS-13)
  brand-kit/     /studio/brand-kit page (DS-3)
  api.ts         TanStack Query hooks per endpoint
src/test/msw/studio.ts   mocks for every 01-contracts §4 endpoint (DS-0), kept in step by each module
```

## Rules
1. **Switch everywhere.** `designStudioOn` gates nav, routes, commands and deep links. `kindEnabled(user, 'sustainability')` also needs KPI tracking. Off → `EmptyState` with the `05-ux` S10 copy.
2. **The sheet is the renderer.** Pages are drawn with `render/renderSheet()` into a shadow root. Selection, handles, guides, rulers and data hover cards are a separate overlay positioned with `geometry.ts`. Never re-create an element's look in React.
3. **The doc is the state.** Editor state is one `ReportDoc` plus the selection, zoom, view mode, open drawer and `rev`. Every change goes through `docOps` + `history`. Autosave PATCHes 1 s after idle; a 409 opens the RS conflict dialog.
4. **Canva-style chrome, our tokens.** Rail, drawers and toolbar use `src/ui` components and app tokens in all four app themes. Icons come from `lucide-react`. No Canva names, icons or look.
5. **Numbers only from the server.** Values come from `/studio/resolve`. The FE formats nothing that is reported; it shows `display` strings. The Data drawer shows values and approval dates from the same call.
6. **AI is a card.** Every AI result renders as a `SuggestionCard`, and a doc change happens only in its Accept handler.
7. **Performance.** Only visible pages ±2 render as live sheets; the page strip and grid view use cached thumbnails. Dragging stays at 60 fps on a 50-page doc.
8. **Width gate.** Below 1280 px: read-only canvas, comments and downloads (RS R16).
9. **Tests:** unit tests for `src/lib/studio/*`; component tests with MSW for each panel; Playwright `e2e/ds-*.spec.ts` for the main path of each module and the switch-off path.
