# src/reporting/studio (ESG-lite): the one renderer

> **Layer spec.** Goes to `ESG-lite/src/reporting/studio/CLAUDE.md`. The FE mirror at `ESG-lite_FE/src/lib/studio/render/` is generated from it.
> **Read it** after the root CLAUDE.md and `docs/design-studio/00-plan.md`, `01-contracts.md` and `04-decisions.md`, then your module's CLAUDE.md.
> **Base:** `docs/design-studio/rs-base/layers/ESG-lite-src-reporting-studio/CLAUDE.md`. Its rules hold; this file adds formats, new elements and GHG charts.

## Shape
```
src/reporting/studio/
  CLAUDE.md          this file
  render/            PURE TS, mirrored to the FE byte for byte (RENDER_HASH)
    index.ts         renderSheet(page, resolved, theme, format) · renderFlow(section, …) · renderDocument(doc, resolved, mode)
    formats.ts       PageFormat → {wMm, hMm, safeMm, bleedMm}; the only place sizes live (DS-1)
    theme.ts         ThemeOverrides + StylePreset + Brand → CSS variables (DS-1, DS-3)
    elements/        one file per ElementType: text, kpi_tile, big_number, progress, callout, chart, table,
                     image, frame, grid, shape, line, icon, sdg, divider, page_number, qr, placeholder
    charts/          static SVG charts (RS kinds) + charts/ghg/ (scope_split, category_bars, gas_split,
                     site_bars, monthly_stack, base_year_waterfall, intensity_line, treemap) (DS-8)
    flow/            toc, narrative, data_tables, indexes (gri, brsr, esrs, ghgp, iso), methodology, glossary,
                     ghg_factor_table, scope3_categories
    measure.ts       window.__measure(): overflow, safe area, bleed, contrast samples
    checks/number.ts typed-number matcher shared with DS-12
    hash.ts          RENDER_HASH (bumped by the sync script)
  fonts/             WOFF2 subsets (OFL), served by GET /studio/fonts/:file
  print.ts           Playwright wrapper: pdf (screen, print), png pages; reuses ../print.ts patterns
```

## Rules
1. **Pure.** `render/` imports nothing from Node, the DB, React or the app. Its input is `(doc, resolved values, theme)` and its output is an HTML string. No `Date.now()` and no randomness (a seed comes in the input).
2. **One output for every surface.** The editor sheet, Page view, Present, PNG and both PDFs call the same functions. The only differences are `mode` flags (`sheet | paged | present | print`) that toggle guides, bleed and crop marks, never the layout.
3. **Millimetres everywhere.** Frames are in mm on the doc's format. `formats.ts` is the only table of sizes.
4. **Numbers arrive formatted.** The renderer never computes a reported figure. It prints `ResolvedBinding.display` and draws charts from `ResolvedBinding.series`. When a value is unavailable, it shows "Not reported" in the theme's muted style, plus the reason in a `data-reason` attribute (D7).
5. **Data marks.** Every bound element gets `data-el-id`, `data-binding-hash` and `data-source="ghg|kpi|input|custom"` so the editor overlay and the checks can find it.
6. **Fonts and assets** are referenced by URL, inlined only by `print.ts` for jobs. No system fonts.
7. **Charts are static SVG** with explicit fills, labelled to scale, using the brand series colours and Scope 1/2/3 colours from the theme (`--s1/--s2/--s3`, as the app's tokens). No ECharts in the studio renderer.
8. **Do not modify** `src/reporting/render.ts`, `blocks.ts`, `svgcharts.ts`, `charts.ts`, `ghg*.ts` or `print.ts`. Copy a pattern if it helps, and cite where it came from.
9. Every change updates the snapshot goldens (`ci/golden/ds/render/*`) on purpose and bumps `RENDER_HASH`. Then run `npm run sync:studio-render` in the FE.
