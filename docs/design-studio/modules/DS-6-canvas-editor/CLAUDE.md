# DS-6 · Canvas editor with Canva-style chrome

> **Module spec**, lane L4, waves 1–2. Copy to `ESG-lite_FE/src/features/studio/editor/CLAUDE.md`.
> **PR titles:** `[DS-6 k/m]`, six PRs:
> 1. geometry, docOps, history, snapping (pure + tests);
> 2. canvas, selection, transforms;
> 3. side rail + drawers framework + Pages drawer;
> 4. contextual toolbar + Position panel (Arrange, Layers);
> 5. page strip, grid view, zoom, rulers and guides;
> 6. shortcuts, context menu, polish.
>
> **Depends on:** DS-0 (mocks), DS-1, DS-5 · **Owns:** FE `studio/editor/*` (except `text/`, `charts/`, `tables/`), `src/lib/studio/geometry.ts`, `docOps.ts`, `history.ts`, `snapping.ts`
> **Base:** RS-6 (`rs-base/modules/RS-6-freeform-editor/CLAUDE.md`): its pure core, canvas, transforms, snapping, performance and width gate are kept. What changes is the chrome: the RS insert bar and right inspector are replaced by the Canva-style rail, drawers, contextual toolbar and Position panel from `05-ux`.

## Build (in addition to RS-6)
1. **Side rail + drawer framework:**
   - 72 px rail, 340 px drawer, keyboard reachable (rail is a `tablist`);
   - the drawer remembers its scroll per tab;
   - drawers are registered by modules (`registerDrawer('data', DataPanel)`), so DS-2, DS-3, DS-4, DS-8 and DS-9 plug in without touching the shell.
2. **Contextual toolbar:**
   - a per-type toolbar registry (`registerToolbar('chart', ChartToolbar)`), with the common tail (Position, Transparency, Link mark, Lock, ⋯);
   - "Nothing selected" shows page Background and Layout;
   - the toolbar wraps into a ⋯ overflow below 1440 px.
3. **Position panel** in the drawer area: an **Arrange** tab and a **Layers** tab (RS layers list).
   - Arrange: order, align to page or to the selection, **Tidy up** (equal spacing on the dominant axis), X/Y/W/H/rotation in mm.
4. **Page views:**
   - scroll view (default), page strip in the status bar, and grid view (full canvas area, grouped by chapter, multi-select actions);
   - Alt+⌘+1/2/3;
   - page titles editable above each page; the "+" between pages opens layouts.
5. **Rulers and guides:**
   - rulers in mm on the top and left;
   - drag out a guide (stored in `page.guides`, never rendered in print);
   - show margins and bleed toggles;
   - guides take part in snapping.
6. **Frames and grids:** drop an image on a frame to fill it; double-click to crop inside the frame.
7. **Copy style / paste style** (⌥⌘C / ⌥⌘V).
8. **Comments hook:** C plus a click drops a comment pin (the DS-13 thread UI; until then a stub).

## Tests
- **Unit:** RS tests, plus tidy-up spacing, guide snapping, and the toolbar registry.
- **Component (MSW):** the drawer switches; the toolbar changes with the selection; Position align to page.
- **Playwright:** add a frame from Elements, drop an image into it, crop, align centre, tidy three tiles, reorder pages in grid view, add a guide, undo the lot.

## Done when
A Canva user can find every action where they expect it, and every RS-6 "Done when" still holds.
