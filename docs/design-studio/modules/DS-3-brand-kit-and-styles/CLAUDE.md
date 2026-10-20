# DS-3 · Brand kit and Styles

> **Module spec**, lane L3, wave 1. Copy to `ESG-lite/src/studio/brandkit/CLAUDE.md`.
> **PR titles:** `[DS-3 k/m]`, three PRs:
> 1. BE: brand columns, palettes, brand-kit and styles endpoints;
> 2. FE: brand-kit page;
> 3. FE: Brand drawer + Styles (apply, shuffle) in the editor.
>
> **Depends on:** DS-0 · **Owns:** `brand_palette`, `brand.font_heading`, `brand.font_body`, `brand.voice`, `src/studio/brandkit/*`, FE `studio/brand-kit/*`, `panels/BrandPanel`, `panels/StylesPanel`, `docOps.applyStyle`
> **Base:** RS-3 brand-font part (RS R12 font set).

## Job to be done
Canva's Brand Kit + Styles: a company's logos, colours, fonts and voice in one place, applied to a whole report in one click.

## Build
1. `migrate:ds-3-brand-kit`: brand font and voice columns; the `brand_palette` table.
2. **Endpoints:**
   - `GET /studio/brand-kit` returns logos from `brand`, palettes, fonts and voice.
   - `PUT /studio/brand-kit` (Manager) saves palettes, fonts and voice. Logos stay Superadmin-only via the existing `/brands` routes.
   - Every palette colour pair gets a contrast report (reuse the FE theme engine rules: a port of `color.ts` contrast to the BE in `brandkit/contrast.ts`).
3. **`GET /studio/styles?kind=`:** 6–12 `StylePreset`s:
   - the brand's primary palette with its fonts;
   - the brand palette with 2–3 alternative OFL pairs;
   - the Classic / Light / Night looks;
   - neutral presets.

   Presets that fail contrast for body text are dropped.
4. **FE brand-kit page** (`/studio/brand-kit`): `05-ux` S5. Logos read-only for Managers, with a link "Ask ESGLite support to change logos".
5. **Brand drawer:**
   - logos (click to insert as an image element);
   - palettes (click a swatch to colour the selection);
   - fonts;
   - Styles cards with hover preview on the current page.

   **Apply to all pages** runs `docOps.applyStyle(doc, preset)`, which writes `design.styleId` + `theme` overrides and clears per-element colours that match the old palette roles.
6. **Shuffle:** rotates role assignments (primary ↔ accent, light ↔ dark backgrounds on openers) within the preset; it is undoable.
7. **Brand controls hook:** when `company.brand_controls` (DS-13) is on, colour pickers show brand palettes only, and fonts are the brand pair only.

## Tests
- **Unit:** `applyStyle` is pure and undoable; shuffle is deterministic per seed; the contrast filter.
- **API:** a Manager can PUT and an Admin can't (as KPI D11; tell Shyam if this should change); tenant isolation.
- **Playwright:** apply a style, shuffle twice, undo; the PDF proof shows the new fonts.

## Done when
A Manager sets palettes, fonts and voice once, and anyone editing a report can apply a brand style to every page and shuffle it, with undo.
