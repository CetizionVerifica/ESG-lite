# RS-6 · Free-form editor: canvas, selection, transforms, snapping, undo, panels

> **Module spec**, lane L4. Copy to `ESG-lite_FE/src/features/kpi/studio/editor/CLAUDE.md`.
> **PR titles:** `[RS-6 k/m]`, five PRs:
> 1. geometry, docOps, history (pure + tests);
> 2. canvas, selection and transforms;
> 3. snapping, multi-select, group, align, layers;
> 4. inspector and insert bar;
> 5. context menu, shortcuts, polish.
>
> **Depends on:** RS-0 (mocks), RS-1 (renderer mirror), RS-4 (shell, autosave) · **Owns:** FE `studio/editor/*` (except `text/`), `src/lib/report-studio/history.ts`, `snapping.ts`, `geometry.ts`, `docOps.ts`

## Job to be done
Let people put anything anywhere on a page (move, resize, rotate, layer, align, add, delete) with the ease of Canva, while every number stays linked to data. This is decision R4.

## Today
Nothing like it in the FE. The closest pattern is `brand-themes` (editor plus live preview). `src/ui` has the fields, menus, popovers and tooltips. The editor shell (top bar, pages panel, read-only sheets) comes from RS-4.

## Build
1. **Pure core** (`src/lib/report-studio/`):
   - `geometry.ts`: mm↔px at zoom, rotated bounding boxes, hit testing, alignment maths.
   - `docOps.ts`, pure functions returning a new doc: `addElement`, `updateFrame`, `updateProps`, `remove`, `duplicate`, `group`/`ungroup` (elements sharing `groupId`; selecting one selects the group, double-click enters it), `reorderZ`, `lock`/`unlock`, `align` (left/centre/right/top/middle/bottom), `distribute`, `copyStyle`/`pasteStyle`, page ops (add from layout, duplicate, hide, delete, reorder, reset to layout).
   - `history.ts`: a command stack (100 steps), merging continuous drags into one step, serialisable to sessionStorage for reload safety.
   - `snapping.ts`: targets are the page edges, safe margin, centre lines, and other elements' edges and centres; equal-spacing detection; a 1.5 mm threshold at 100 % zoom (scaled); returns guides to draw.
2. **Canvas:**
   - **Sheet:** `Sheet` renders `render/renderSheet(page, resolved, theme)` into a shadow root with the report CSS and fonts (served by `/kpi/studio/fonts`).
   - **Overlay:** `SelectionLayer` sits above it, with hover outline, selection box, 8 resize handles, rotate handle and guides.
   - **Libraries:** `react-moveable` + `react-selecto` (R5). Confirm the MIT licence and React 19 compatibility in PR 2; if either fails, implement transforms on pointer events using `geometry.ts`.
   - **Interactions:** transforms preview with CSS transforms on the overlay and commit one `updateFrame` on pointer-up.
   - **Locks:** locked elements can be selected but not transformed. Template-locked ones (RS-10) can't be selected except from Layers.
3. **Panels:**
   - **Insert bar:** Text (RS-7 makes it editable), KPI tile, Chart, Table, Image (asset picker + upload from RS-3), Shape, Icon/SDG, Ask AI (RS-8 hook). Elements drop at the page centre, or at the drop point when dragged in.
   - **Inspector:** the per-type panels from `05-ux` S3, with the KPI picker shared with RS-7 (search, topic groups, framework badges via `kpi/components`), X/Y/W/H/rotation in mm, and the "Linked to data" badge (approval date and evidence count from `/resolve`).
   - **Layers panel:** reading order = list order (R17); drag to reorder; eye and lock toggles.
   - **Pages panel:** from RS-4, plus "Add page" → layout gallery (RS-3) filtered by kind.
4. **Keyboard and menus:** the full shortcut set and context menu from `05-ux` S3, and a ⌘/ help sheet. Focus management keeps typing inside inputs from triggering shortcuts.
5. **Performance:**
   - Only visible pages ±2 render as sheets. Thumbnails are cached image snapshots of sheets (html-to-image on idle) or server thumbnails.
   - Drag runs at 60 fps on a 50-page doc (Playwright trace in CI as informational).
6. **Width gate:** below 1280 px the canvas is read-only, with a notice (R16).

## Tests
- **Unit:** geometry (rotation boxes), docOps (each op, immutability), history (merge, undo/redo across page ops), snapping (edges, centres, equal spacing).
- **Component (MSW):** selecting and moving a chart updates its frame; a locked element doesn't move; align and distribute.
- **Playwright:** add a KPI tile, drag, resize with Shift, rotate, undo ×3, redo, group, reorder layers, reload (autosaved), duplicate a page.

## Out of scope
Text editing inside elements (RS-7). AI (RS-8). Checks UI (RS-9). Comments (RS-10). Real-time co-editing (R15).

## Done when
On every free-form page, a Manager can add, move, resize, rotate, layer, align, group, lock, copy and delete any element type with snapping and undo, and it prints exactly as placed (RS-5 proof).
