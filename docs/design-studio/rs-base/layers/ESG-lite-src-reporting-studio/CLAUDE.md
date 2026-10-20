# src/reporting/studio (ESG-lite): report studio renderer layer

> **Layer spec.** Goes to `ESG-lite/src/reporting/studio/CLAUDE.md`.
> **Read it** after the root CLAUDE.md, `docs/report-studio/00-plan.md`, `01-contracts.md` and `04-decisions.md`, and before your module's CLAUDE.md.
> **Mirrored** byte for byte into `ESG-lite_FE/src/lib/report-studio/render/`, so it must run in both Node and the browser.

## Shape
```
src/reporting/studio/
  CLAUDE.md           this file
  render/             PURE (mirrored to the FE)
    index.ts          renderDocument(doc, resolved, theme, opts) → { html, css }   renderSheet(page, …) → html
    sheet.ts          free-form page: @page sheet, absolutely positioned elements in mm, background, bleed
    flow.ts           flow sections → Block-style HTML for Paged.js (toc, narrative, data tables, indexes, methodology)
    elements/         one file per ElementType: text.ts (TextDoc → HTML, kpi chips → formatted values), kpiTile.ts, chart.ts, table.ts, image.ts, shape.ts, icon.ts, sdg.ts, pageNumber.ts
    charts/           static SVG: bars.ts, stacked.ts, line.ts, donut.ts, shareBar.ts, waterfall.ts, sankey.ts, targetBars.ts, dotGrid.ts, matrix.ts, sparkline.ts, axis.ts, scale.ts
    theme.ts          Theme from Brand + design + overrides → CSS variables; contrast helpers
    textStyles.ts     TextStyleId → font, size, leading, tracking per design
    format.ts         number formats (int, 1dp, pct, compact, indian lakh/crore), units, ▲/▼ with good/bad colour
    measure.ts        browser-only helpers exported as strings for window.__measure (overflow, safe area, min font, contrast samples)
    checks/number.ts  extract numbers+units from TextDoc; match against resolved values with tolerance (shared with RS-9)
    ids.ts            data-el-id / data-page-id attributes, bookmark ids
    RENDER_HASH       sha256 of render/**; updated by `npm run sync:studio-render`
  fonts/              self-hosted subset WOFF2 (R12) + fonts.ts (FontId → @font-face); NOT mirrored, served at /kpi/studio/fonts/*
  html.ts             Node-only: wraps renderDocument output with fonts, Paged.js polyfill (paged mode) and window.__ready / __measure
```

## Rules
1. **Pure and deterministic.**
   - `render/` imports nothing from Node (no `fs`, `path`, DB, `process`) and nothing from the app. Its only dependency is the contracts types.
   - It uses no `Date.now()` and no randomness. The same input gives the same HTML.
   - Variety comes from explicit layout choices, never from a seed at render time.
2. **Input is resolved data, not queries.**
   - Every number arrives in `resolved` from RS-2 (`ResolvedBinding`, `ResolvedToken`).
   - If a value is missing, render a visible "No approved value" placeholder chip. Never 0, never blank.
3. **mm in, CSS out.** Free-form frames are mm on A4. Emit `position:absolute; left:Xmm; top:Ymm; width:Wmm; height:Hmm; transform: rotate()`. Every element carries `data-el-id` and every page `data-page-id`, which the editor and click-to-select rely on.
4. **Flow and free-form in one document.**
   - Free-form sheets are `<section class="sheet" style="page: freeform">` with a fixed size and `break-after: page`.
   - Flow sections are normal content that Paged.js paginates with named pages (running header and footer, page numbers).
   - The contents page uses `target-counter`.
5. **Charts are static SVG.**
   - No ECharts or canvas in studio output, so print never waits on JS and the PDF stays vector.
   - Every chart has `role="img"` and an `aria-label` that states its takeaway, and follows `research.md` §2: prior years grey, shared axes, takeaway titles, no truncated axes (bars start at zero), labels on totals and the largest parts.
6. **Theme via CSS variables only.** Colours and fonts come from `theme.ts` (Brand → design → overrides). Elements never hard-code brand colours. Contrast helpers here are shared with the `LOW_CONTRAST` check.
7. **Escaping.** All text goes through one `esc()`. TextDoc rendering allows only the nodes and marks listed in `01-contracts` §2. Links must be `https:` or `mailto:`. SVG uploads are already sanitised (RS-3) and are referenced by URL only.
8. **Don't touch the GHG renderer.** `src/reporting/render.ts`, `blocks.ts`, `svgcharts.ts`, `charts.ts` and `ghg*.ts` stay as they are. Copy and adapt ideas, don't import from them, so the GHG report can't change by accident.
9. **The mirror.**
   - After any change under `render/`, run `npm run sync:studio-render`. It writes `RENDER_HASH` here and copies the files to `../ESG-lite_FE/src/lib/report-studio/render/`, or prints the command for the FE repo.
   - `npm run check:studio-render` fails CI in both repos when the hashes differ.
10. **Tests.**
    - HTML snapshot goldens per element type and per layout (`ci/golden/rs/render/`).
    - Unit tests for scales, formats and number extraction.
    - A Playwright smoke test that prints a fixture doc and asserts page count, embedded fonts, extractable text and bookmarks.
