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

## As built (2026-10-20, local branch `ds-3-brandkit` in ESG-lite and ESG-lite_FE)

### Backend (ESG-lite)
- `src/entities/Brand.ts` (`// DS-3` block): `font_heading`, `font_body` (varchar(40), null = template default), `voice` (text, not null, default `''`).
- `src/entities/BrandPalette.ts`: `brand_palette` (`company_id`, `name` varchar(60), `colors` jsonb, `sort`, timestamps; index `IDX_brand_palette_company`). Registered in `src/config/data-source.ts` (`// DS-3`).
- `src/scripts/migrateDs3BrandKit.ts`, `npm run migrate:ds-3-brand-kit`: idempotent (IF NOT EXISTS), statements match TypeORM; checked with `ci/schema-diff.cjs` (sync → drop DS-3 objects → migrate twice → "Nothing to migrate").
- `src/studio/contracts/brandkit.ts` (exported from `contracts/index.ts`, `// DS-3`): `BrandKit`, `BrandPaletteDto`, `PaletteContrast`, `BrandKitUpdateSchema` (zod), limits (voice 3,000; 10 colours per palette; 20 palettes; name 60), `AA_TEXT` 4.5 / `AA_UI` 3. No enum added, so `ci/studio-contracts.json` is unchanged.
- `src/studio/brandkit/contrast.ts`: port of FE `src/theme/color.ts` (parseHex, mix, luminance, contrast, ensureContrast) + `paletteContrast` (every pair, i < j).
- `src/studio/brandkit/fonts.ts`: R12 font names, `DEFAULT_PAIR` (Source Serif 4 / Source Sans 3), `ALT_PAIRS`.
- `src/studio/brandkit/styles.ts`: `buildStyles(src, kind)`, pure and deterministic: `brand` (primary palette → roles via `paletteRoles`, brand fonts), up to 3 `brand-alt-n` OFL pairs, `look-classic|light|night`, 2 neutral presets per kind (padding to 6 with a third), dedupe, cap 12. Filter: ink on surface ≥ 4.5:1.
- `src/studio/brandkit/service.ts` + `router.ts` (mounted in `src/studio/router.ts`, `// DS-3`):
  - `GET /studio/brand-kit` (R): logos and brand colours from `brand` (or the /brands defaults when no row), fonts, voice, palettes with contrast, `canEdit`, `brandControls` (reads `company.brand_controls` through `to_jsonb(c)`, so it works before DS-13 adds the column), `updatedAt`.
  - `PUT /studio/brand-kit` (M, `requireManager` + service check): fonts, voice, palettes (list replaces, order = sort, `id` keeps a palette; another company's id → 404). Creates the `brand` row with the /brands defaults when missing. One `audit_log` row (`brand_kit`, `update`; voice length only, never its text).
  - `GET /studio/styles?kind=` (R): `assertKind` (400 without kind, `DS_KIND_OFF` for sustainability with KPI off).
- Tests: `ci/unit/ds-3-brandkit.test.cjs` (contrast port, pair report, styles 6–12/deterministic/filter, PUT schema); `ci/api/tests/ds-3-brand-kit.test.cjs` (switch-off, DS_ROLE, Admin can't PUT, Manager and Superadmin can, validation, palette replace/reorder, audit, tenant isolation, styles + kind guard, migration twice).

### Frontend (ESG-lite_FE)
- `src/lib/studio/contracts.ts` (`// DS-3` block): `BrandKit` confirmed (replaces the DS-0 mock shape), `BrandPalette`, `PaletteContrast`, `BrandKitUpdate`, limits. `src/test/msw/studio.ts`: brand-kit mock with validation, DS_ROLE when `canEdit` is false, palette ids; 7 style presets; `setStudioMockBrandKit`, `studioMockBrandKit`.
- `src/lib/studio/styleOps.ts`: `applyStyle(doc, preset)` (styleId, theme colours + fonts; clears element colours and page backgrounds equal to the old role colours), `shuffleVariant` / `shuffleStyle(doc, preset, seed)` (seed → primary↔accent swap and/or dark openers; swaps skipped when they'd fail 3:1 / 4.5:1), `roleOf`.
- `src/lib/studio/brandOps.ts`: `insertLogo` (image element, asset ids `brand:logo` / `brand:logo-on-dark`, kind `logo`), `colourSelection` (swatch → selection, or the page background), `applyFonts`.
- `src/lib/studio/brandKit.ts`: font names/stacks, draft ↔ PUT body, `draftErrors` (backend limits), `paletteContrast` / `contrastSummary`, `allowedColours` / `allowedFonts` (brand controls).
- `src/features/studio/brand-kit/`: `Page.tsx` (`/studio/brand-kit`, swapped into `routes.tsx` with `// DS-3`), `api.ts` (calls + hooks), `components/` (LogosSection, FontsSection, VoiceSection, PaletteCard).
- `src/features/studio/panels/`: `BrandPanel.tsx`, `StylesPanel.tsx`, `types.ts` (`StudioPanelProps`: doc, pageId, selection, commit(next, label), preview), `useBrandControls.ts`.
- `src/features/brand-themes/components/BrandKitLink.tsx` + one line in `Page.tsx` (`// DS-3`): a callout linking to the kit while the studio is on.
- Tests: `styleOps.test.ts`, `brandKit.test.ts`, `brand-kit/Page.test.tsx`, `panels/BrandPanel.test.tsx` (apply, shuffle twice, undo ×3 back to the original through a snapshot-history harness), `e2e/ds-3-brand-kit.spec.ts`.

### Deviations
- `docOps.applyStyle` lives in `src/lib/studio/styleOps.ts` (and the drawer edits in `brandOps.ts`) because DS-6 owns `docOps.ts` and is built in parallel. DS-6 re-exports them from `docOps.ts` (`export { applyStyle, shuffleStyle } from "./styleOps"; // DS-3`).
- Panels take `StudioPanelProps` (`src/features/studio/panels/types.ts`); DS-6's `registerDrawer` should pass `doc`, `pageId`, `selection`, `commit`, `preview` (or adapt in one line).
- The DS-0 mock `BrandKit.logos.mark` became `logos.onDark` (matches `brand.logo_on_dark_url`); the kit also carries the brand colours, `defaultLook`, `canEdit`, `brandControls`, `updatedAt`.
- Contracts were extended in this module (`contracts/brandkit.ts` and the FE `// DS-3` block) rather than in a separate DS-0 follow-up, as both repos are worked in parallel.
- "Ask ESGLite support to change logos" is plain text for company users (the app has no support link); a Superadmin gets a link to `/clients/:id/brand`.

### Decisions
- Admins read the kit, only Managers/Superadmins PUT (KPI D11, as the spec says; Shyam may want Admins too).
- A Manager's first save creates the `brand` row with the /brands defaults and the company name (fonts and voice need a home). With local `brand-assets/<id>/` in development the DB row then wins, as for any saved brand.
- Shuffle is deterministic per press count (seed 0, 1, 2 …), never the plain preset first; dark openers = cover/opener/chapter pages (by layout id or name) get the primary background and surface-coloured text.
- Re-applying a style clears colours equal to its own roles (settles after one extra apply), matching "clears per-element colours that match the old palette roles".

### Not done
- Playwright on the editor path (apply a style, shuffle twice, undo; the PDF proof shows the new fonts): needs the DS-6 editor shell and the DS-11 proof. The same flow is covered by `BrandPanel.test.tsx` with a history harness; the Playwright spec covers the brand-kit page and the switch-off path.
- Mounting `BrandPanel` in the rail (`registerDrawer('brand', BrandPanel)`) and the toolbar pickers using `useBrandControls`: DS-6 / DS-7 when the shell exists.
- Hover preview renders through the DS-6 canvas (`preview(doc)`); the renderer's use of `theme.fonts` and the `brand:logo*` asset ids is DS-1/DS-4's.
- Font samples use the family name with a serif/sans fallback; the real OFL faces load once DS-1/DS-4 serve `/studio/fonts/*`.
- Brand voice "Try it" rewrite preview (05-ux S5) needs the DS-9 `apply_brand_voice` action; the page offers an example voice instead.
