# RS-1 · Renderer v2: page model → HTML, free-form sheets + flow sections, SVG charts, FE mirror

> **Module spec**, lane L1. Copy to `ESG-lite/src/reporting/studio/CLAUDE.md` (beside the layer file, as `RS-1.CLAUDE.md`).
> **PR titles:** `[RS-1 k/m]`, four PRs:
> 1. core: sheet, flow, text, theme;
> 2. charts;
> 3. `html.ts`, Paged.js, measure, print smoke;
> 4. FE mirror sync.
>
> **Depends on:** RS-0 · **Owns:** `src/reporting/studio/**`, `scripts/sync-studio-render.mjs`, FE `src/lib/report-studio/render/**` (generated) · **Touches:** `package.json` scripts

## Job to be done
One renderer turns a ReportDoc and its resolved values into print-quality HTML. The editor, the Page view, the proof and the final all use it, so what people edit is what they get.

## Today
`src/reporting/` renders the GHG report from `Block[]`:
- `blocks.ts` / `render.ts`, with ECharts inlined and Paged.js;
- `svgcharts.ts` for a few static SVG charts;
- `print.ts` for Playwright.

The fonts Source Serif 4 and Source Sans 3 are inlined. Reuse the ideas; don't import or change these files.

## Build
1. **`render/index.ts`:**
   - `renderDocument(doc, resolved, theme, {mode: 'sheet'|'paged', watermark?: 'DRAFT'})` returns `{html, css}`.
   - `renderSheet(page, resolved, theme)` returns the HTML of one free-form page, used by the editor.
   - Both are deterministic and pure (see the layer rules).
2. **Free-form sheets (`sheet.ts`):**
   - A4 210 × 297 mm. Elements are absolutely positioned in mm with rotation and z-order.
   - Page backgrounds are a colour or an image (cover/contain).
   - Elements may bleed past the edge (images and shapes only). `data-page-id` / `data-el-id` on everything.
3. **Elements (`elements/*`), one file per type.** Notes:
   - **Text:** TextDoc → HTML, with `kpi` tokens rendered as formatted values (`format.ts`) wrapped in `<span class="kpi" data-kpi=…>`. Missing values become a "No approved value" chip.
   - **KPI tile:** variants plain / card / band, the ▲/▼ delta coloured by good direction (KPI `DIRECTION_GOOD` via resolved data), and an optional sparkline.
   - **Table:** lined / zebra / minimal styles, tabular numbers, a total row.
   - **Image:** `object-fit` and a crop window.
   - **Page number:** a counter (sheet) or `counter(page)` (paged).
4. **Charts (`charts/*`), static SVG.** Every chart takes `(resolvedBinding, frameMm, theme, options)` and returns SVG that scales to its frame:
   - stacked and grouped bars (prior years grey, latest highlighted);
   - line, donut, share bar;
   - **waterfall** (base → drivers → current);
   - **sankey** (sources → uses);
   - **target bars** (baseline, current, target markers, status);
   - **dot grid** (100 units);
   - **materiality matrix** (2×2, threshold lines, labelled points);
   - **sparkline**.

   Shared: `scale.ts` (nice ticks, bars start at zero), `axis.ts`, label collision avoidance (simple: drop labels under 4 % share).
5. **Flow sections (`flow.ts`):**
   - `toc` (with `target-counter`), `narrative` (TextDoc, 1 or 2 columns);
   - `data_tables` (multi-year by pillar/topic, repeated headers, `break-inside: avoid` per row);
   - `gri_index` / `brsr_index` / `esrs_index` from the KPI-11 model rows passed in `resolved.frameworkRows` (codes, our titles, page refs via `target-counter` to `data-kpi` anchors, BRSR Core ◆, evidence counts);
   - `methodology`, `glossary`.
6. **Theme and styles:**
   - `theme.ts` produces CSS variables from `Brand` (primary, accent, cover, logo, look, fonts) + design theme + doc overrides, with contrast helpers.
   - `textStyles.ts` gives per-design type scales for the nine `TextStyleId`s.
7. **`html.ts` (Node):** the full document with:
   - `@font-face` from `fonts/`;
   - CSS;
   - Paged.js (paged mode only), with named pages `freeform` (no margins, no running heads) and `flow` (margins, running header and footer);
   - `window.__ready` after fonts and images load;
   - `window.__measure()` returning `Measurement[]` (overflow per text element, out-of-safe-area, smallest font, contrast samples).
8. **Fonts:** the R12 set as subset WOFF2 in `src/reporting/studio/fonts/`, with licences in `fonts/LICENSES.md`. They are served at `GET /kpi/studio/fonts/:file`, cacheable and under the same auth as preview.
9. **Mirror:**
   - `scripts/sync-studio-render.mjs` hashes `render/**` into `RENDER_HASH` and copies to `../ESG-lite_FE/src/lib/report-studio/render/` when that path exists.
   - `npm run sync:studio-render` and `npm run check:studio-render` exist in both repos; the FE copy of the script only checks.

## Golden cases (`ci/golden/rs/render/`)
- One fixture doc per design containing every element type and chart kind gives one HTML snapshot each.
- Number formats: int, 1dp, pct, compact, indian (1,23,45,678).
- A missing value renders the placeholder.
- A 2-column narrative plus a data table that spans 3 pages.

## Tests
- **Unit:** scales and ticks, formats, sankey layout sums, waterfall start/end equal the resolved values, text escaping (script tags, links).
- **Playwright smoke** (prints a fixture through `print.ts` settings + `tagged`/`outline`):
  - the page count is as expected;
  - fonts are embedded (pdffonts);
  - text is extractable;
  - bookmarks exist;
  - free-form elements land within 0.5 mm of their frames (`__measure`).

## Out of scope
Editing (RS-6/7), data resolution (RS-2), designs and layouts content (RS-3), queues (RS-5).

## Done when
- A fixture ReportDoc renders identically in Node and in the browser (same HTML string).
- It prints to a tagged, vector PDF with bookmarks and a correct contents page.
- The FE mirror hash matches in CI.
