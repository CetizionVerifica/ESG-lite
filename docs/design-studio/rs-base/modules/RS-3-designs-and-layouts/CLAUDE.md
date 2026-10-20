# RS-3 · Designs, page layouts, brand fonts, report assets

> **Module spec**, lane L3. Copy to `ESG-lite/src/kpi/studio/designs/CLAUDE.md`.
> **PR titles:** `[RS-3 k/m]`, four PRs:
> 1. tables, the designs API and assets;
> 2. the Editorial layouts;
> 3. the Night and Minimal layouts;
> 4. brand fonts (BE + FE `brand-themes`).
>
> **Depends on:** RS-0, RS-1 · **Owns:** `report_design`, `report_layout`, `report_asset`, `src/kpi/studio/designs/*`, `assets/*`, `data/report-studio/*` · **Touches:** `Brand.ts` (+font columns), FE `brand-themes` (font pickers)

## Job to be done
Give clients three professional starting designs, each with a full set of page layouts that already look finished with their brand and data. Let them bring their own photos.

## Today
- **Brand:** `Brand` holds primary, accent, cover_from/to, logo_url, logo_on_dark_url, default_look (classic/light/night) and scope3_colour, and `brands.ts` `getBrandTheme()` reads it.
- **Mockups:** the three designs (rows A–C in `canvas/`) show the target look: Editorial (A), Night (B) and Minimal (C).

## Build
1. **Tables:** migrations `migrate:rs-designs` (`report_design`, `report_layout`) and `migrate:rs-assets` (`report_asset`) per `01-contracts` §3.
2. **Seeds** (`data/report-studio/designs/<design>/`): `design.json` (theme defaults, text styles, safe margin, look) and `layouts/*.json`, which are FreeformPages with placeholder elements and bindings expressed as roles (e.g. `{"kpis": ["$headline:E:0"]}` resolved at build time).
   - **Editorial**, from the mockups A1–A4: cover ×3, contents, leadership, about, highlights ×3, chapter opener ×3, data page ×4 (one hero chart; two charts; chart and text; tiles and text), targets, materiality (matrix / list), people, quote, back cover.
   - **Night:** the same kinds, built on the B1–B3 look.
   - **Minimal:** the same kinds, built on the C1–C2 look.
   - Each layout is checked against the RS-9 layout rules (safe area, minimum font, contrast) with the default brand and two real client brands.
   - `seed.ts` upserts system designs idempotently (`migrate:rs-designs` runs it) and bumps `version` when a layout changes.
3. **API:** `GET /designs`, `GET /designs/:id/layouts?kind=`.
   - Thumbnails are rendered once per (layout, version) by the RS-5 worker with the default brand and stored in R2.
   - Until RS-5 lands, they are generated at seed time in CI.
4. **Brand fonts:** migration `migrate:rs-brand-fonts` adds `brand.font_heading` and `brand.font_body` (FontId, null = the design default).
   - **FE `brand-themes`:** two pickers (heading and body) with live samples from the R12 set, shown in the existing preview panel.
5. **Assets:** `POST /assets` (multipart).
   - **Validation:** jpg, png and webp re-encoded with `sharp` (a new dependency, not in ESG-lite today; add it in this PR); svg sanitised (no script, foreignObject, external refs, event attributes); ≤ 10 MB; EXIF stripped.
   - **Storage:** stored in R2 with w, h and sha256. Duplicates (same sha) return the existing asset.
   - **Other endpoints:** `GET /assets`, and `DELETE /assets/:id` (refused while any draft uses the asset; finals keep their copy).
   - **AI cover art:** `imagery.ts` output is saved as `kind: 'ai_image'`.

## Golden cases (`ci/golden/rs/layouts/`)
- Every system layout validates against `ReportDocSchema`.
- Every layout renders (RS-1) without `OUTSIDE_SAFE_AREA`, `FONT_TOO_SMALL` or `LOW_CONTRAST` errors for the default brand and the Midal brand.

## Tests
- **API:** designs are visible to all R-role users; assets are tenant-isolated; svg sanitising (script, onload, external href rejected); size and type errors; dedupe.
- **FE:** font pickers save and the preview updates.

## Out of scope
Client-made designs and layouts (RS-10). A stock-photo library (R13). Client font uploads (R12).

## Done when
- Three system designs with about 13 layout kinds each are seeded.
- They render cleanly with any client brand and pass the layout checks.
- Clients can upload images and pick brand fonts.
