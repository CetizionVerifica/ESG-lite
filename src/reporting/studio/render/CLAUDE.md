# DS-1 · Renderer v2: formats, bleed, new elements, FE mirror

> **Module spec**, lane L1, wave 1. Copy to `ESG-lite/src/reporting/studio/render/CLAUDE.md`.
> **PR titles:** `[DS-1 k/m]`, five PRs:
> 1. formats + sheet + theme;
> 2. elements (RS set);
> 3. new elements (frame, grid, line, big_number, progress, callout, qr);
> 4. flow sections + pagination;
> 5. print.ts (pdf screen and print, png) + sync script + FE mirror.
>
> **Depends on:** DS-0 · **Owns:** `src/reporting/studio/render/*`, `src/reporting/studio/print.ts`, `fonts/`, `scripts/sync-studio-render.mjs`, FE `src/lib/studio/render/*`
> **Base:** RS-1 (`docs/design-studio/rs-base/modules/RS-1-renderer/CLAUDE.md`). Keep everything there. Changes are below.

## Changes from RS-1
1. **Formats** (`formats.ts`):

   | Format | Size (mm) |
   |---|---|
   | `a4` | 210×297 |
   | `a4_landscape` | 297×210 |
   | `letter` | 215.9×279.4 |
   | `a5` | 148×210 |
   | `slide_16_9` | 338.7×190.5 (1280×720 px at 96 dpi) |
   | `square` | 285.75×285.75 (1080 px) |
   | `social_191` | 317.5×166.1 (1200×628) |

   Each format has a safe margin and a bleed (3 mm for print formats, 0 for screen formats). `@page` size comes from the format.
2. **Modes:** `sheet` (editor), `paged` (Page view), `present` (full-screen slides with notes hidden), `print` (bleed + optional crop marks).
3. **New elements:**
   - `frame`: an image clipped by a mask (rect, rounded, circle, arch, blob), with crop in the frame's coordinates;
   - `grid`: n frames with a gap;
   - `line`: start and end points, arrowheads, dash;
   - `big_number`: a bound value + label + delta;
   - `progress`: a ring or bar from a `progress` measure;
   - `callout`: an icon + text in a tinted box;
   - `qr`: a URL → SVG QR, generated in pure TS.
4. **Unavailable values** render "Not reported" (RS rule 4).
5. **PNG:** `print.ts renderPng(doc, pages, scale)` screenshots each page element at the given device scale.
6. **Charts:** the RS chart kinds. GHG kinds come in DS-8, with an extension point (`charts/registry.ts`).
7. **Flow types:** add `ghgp_index`, `iso_index`, `ghg_factor_table` and `scope3_categories` (a table of all 15 with reported / excluded and the reason).

## Tests
- Snapshot goldens per element, per format, and per mode.
- Pagination goldens for a 300-row table.
- `__measure` reports overflow and safe-area breaches.
- The proof PDF text positions equal the final's.
- The mirror hash check passes in both repos.

## Done when
A ReportDoc v2 fixture renders identically in the FE shadow root, in Page view and in both PDFs for every format; PNG export works; the FE mirror is in sync.

## As built (DS-1, 2026-10-20)

Local branches `ds-1-renderer` in ESG-lite and ESG-lite_FE (from `ds/local`). RENDER_HASH `e6b60db3bc686ab897d91fde98f08c7310bfd3cf102ddcba4c758d1458ce25b2`.

### Files
- **Pure renderer** (`src/reporting/studio/render/`, mirrored):
  - `index.ts`: `renderDocument(doc, data, opts, brand?, style?)`, `renderSheet(page, doc, …)`, `renderFlow(section, doc, …)`, each returning `{html, css, pageIds}`; re-exports the helpers below.
  - `types.ts`: the renderer's structural input types (`RenderDoc`, `RenderElement`, …) and the resolved-data side of `/studio/resolve` (`RenderValue`, `RenderData`, `FlowTable`, `Scope3CategoryRow`).
  - `formats.ts` (sizes, safe margin, bleed, flow margins; `formatPx`, `bleedFor`), `theme.ts` (look → brand → style → doc overrides, CSS variables, contrast helpers), `fonts.ts` (FontId → family, files, stacks), `textStyles.ts` (nine styles, per-format type scale), `format.ts` (axis and typed-data numbers only), `data.ts` (`bindingKey`, `tokenKey`, `renderData()` to zip a `/resolve` response, "Not reported" + `data-reason`, data marks), `text.ts` (TextDoc → HTML, data chips), `sheet.ts`, `css.ts`, `measure.ts` (`MEASURE_JS` + `Measurement`), `qr.ts`, `icons.ts` (own-drawn icons, SDG colours and our labels), `util.ts`, `context.ts`, `hash.ts`.
  - `elements/`: `text`, `kpiTile`, `bigNumber`, `progress`, `callout`, `chart`, `table`, `media` (image, frame, grid), `shapes` (shape, line, divider, icon), `misc` (sdg, page_number, placeholder, qr), `values` (figure + delta), `index` (type → renderer for all 18 ElementTypes).
  - `charts/`: `scale`, `axis`, `svg` (shared pieces, `ChartInput`), `bars` (bar, stacked_bar), `line` (line, sparkline), `donut` (donut, share_bar, dot_grid), `waterfall`, `sankey`, `targetBars`, `matrix`, `registry.ts` (the DS-8 extension point: `registerChart(kind, fn)`).
  - `flow/index.ts`: toc, narrative, data_tables, methodology, glossary, gri/brsr/esrs/ghgp/iso indexes, ghg_factor_table, scope3_categories.
- **Node only** (not mirrored): `src/reporting/studio/html.ts` (full document: fonts as URLs or inlined, Paged.js + repeating table header handler, present shell, `__ready`, `__pageCount`, `__measure`), `print.ts` (`renderPdf(doc, data, 'screen'|'print', opts)`, `renderPng(doc, data, pages, scale, opts)`, `loadDocument`), `fonts/files.ts`, `fonts/route.ts` (`GET /studio/fonts/:file`), `fonts/LICENSES.md`, `contractsCheck.ts` (compile-time: contracts `ReportDoc` is a `RenderDoc`; element types and formats agree).
- **Shared files touched**: `src/studio/router.ts` (one `router.use("/fonts", …) // DS-1` line), `package.json` (`sync:studio-render`, `check:studio-render`, six `@fontsource/*@5.3.0` deps, `jsqr@1.4.0` dev dep).
- **Mirror**: `scripts/sync-studio-render.mjs` (identical in both repos). BE: hash + copy to `--fe=<dir>` / `STUDIO_FE_DIR` / `../ESG-lite_FE`, plus the goldens to FE `src/test/fixtures/studio-render/`. FE: copy from `--be` / `STUDIO_BE_DIR` / `../ESG-lite`, then check.
- **FE**: `src/lib/studio/render/` (generated), `src/lib/studio/renderHost.ts` (`mountSheet`, `mountFlow` into an open shadow root; `measureSheet`; `ensureStudioFonts` fetches the faces with the session token into `document.fonts`), tests `render.test.ts`, `renderHost.test.ts`.
- **Tests**: `ci/unit/ds-1-render.test.cjs` (23, pure), `ci/unit/ds-1-print.test.cjs` (10, Playwright; skipped when Chromium can't launch, as in GitHub CI), `ci/api/tests/ds-1-fonts.test.cjs` (switch off, roles, allow-list, tenant isolation), goldens `ci/golden/ds/render/{fixture.cjs,golden.cjs,snapshots.json,fixture-a4.json}` (per element HTML; per format and per mode sha256). FE `render.test.ts` reproduces every golden byte for byte.

### Decisions
- **Renderer types are structural copies**, not imports: the contracts live at different paths in the two repos, and the mirror must be byte-identical. `contractsCheck.ts` (BE build) and `render.test.ts` (FE typecheck) fail when the contracts drift from them.
- **Resolved data** (`RenderValue`) follows the FE mock `ResolvedBinding` (`display`, `value`, `unit`, `series: {label, values: {key, value}[]}[]`, `approvedAt`, `source`) plus optional `unavailable {reason}`, `delta {display, direction, good}`, `progress` (0..1), `target`, `points` (matrix), `links` (sankey), `table` (pre-formatted). Lookup is by `bindingKey(binding)` (stable JSON), not by index, so a single sheet renders without the whole doc. `renderData(bindings, tokens, response, {flow, scope3})` builds it from a `/resolve` response. **DS-2 should return these optional fields**; until it does, the elements that need them show "Not reported".
- **Numbers**: reported figures print `display` only. The renderer formats only chart axis ticks, chart value labels and series cells in tables (`format.ts`), never a headline figure. Unavailable → "Not reported" (muted) + `data-reason` (`NOT_RECORDED`, `NOT_RESOLVED`, `NO_VALUE`, `NO_PROGRESS`, `NO_ROWS`).
- **Crop** on image/frame/grid cells is the image box (x, y, w, h in mm) inside the frame.
- **Dark page colours**: when the page colour fails 4.5:1 against the theme ink, the sheet switches `--ink`, `--muted`, `--primary`, `--border`, `--surface`, `--good`, `--bad` for that page (deterministic).
- **Paged modes** use Paged.js (already a dependency). Free-form sheets are 1 px shorter than the page box in paged modes (sub-pixel rounding otherwise spilled a sliver onto a new page); a 1 px box-shadow carries the page colour to the edge, and print mode's bleed fill covers it. Page numbers on sheets (`.ds-pn`) and the watermark on paginated pages are filled by html.ts after pagination; the contents page and index refs use `target-counter()`.
- **Print**: `@page { bleed: 3mm; marks: crop }` on print formats (marks only with `cropMarks`); screen formats print without bleed. PDFs are tagged with bookmarks (`outline: true`) from per-page hidden `h1` bookmarks and flow titles.
- **PNG** screenshots each paginated page box (`.pagedjs_page`), so PNG pages equal PDF pages (flow sections included).
- **Fonts**: R12 faces from pinned `@fontsource/*@5.3.0` packages (Latin subset WOFF2), served from `node_modules` rather than copied into `fonts/`; Noto Sans is the fallback in every stack. Behind the studio guard, so the FE loads them with `ensureStudioFonts` (token header) instead of @font-face URLs.
- **Icons** are drawn by us (21 names; unknown → `dot`); SDG tiles use the published goal colours with our own short labels, not the UN icons. Lucide can be added by DS-4 with its licence.
- **QR**: byte mode, level M, versions 1–40, mask by penalty rules 1, 2 and 4 (rule 3 omitted; any mask decodes). Verified with jsQR up to version 38.
- File grouping: several element renderers share a file (`media`, `shapes`, `misc`) instead of one file per type.

### Not done
- GHG chart kinds (`scope_split` … `treemap`): DS-8, through `charts/registry.ts`; they render a muted "Chart not available" box with `data-chart-unsupported` until then.
- `render/checks/number.ts` (the typed-number matcher): DS-12 owns it.
- `preview.html`, render jobs, queues and R2: DS-11 (they call `html.ts` / `print.ts`).
- Devanagari (Noto Sans Devanagari) is not bundled; glyphs outside the Latin subsets fall back to the generic family.
- The PDF checks read the PDF bytes (MediaBox, FontFile, StructTreeRoot, Outlines, ToUnicode); poppler isn't installed here, so text extraction itself (`pdftotext`) isn't run. Text positions are compared through `__measure` in the browser that prints the PDF (proof vs final vs print are equal).
- The Playwright PDF/PNG tests skip in GitHub CI (no Chromium there: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`); they run locally and wherever Chromium is installed.

## #209 follow-up: tCO₂e at 3 decimals (2026-10-29)
- `format.ts`: `formatNumber(v, format, unit?)`. On `auto`, a tonnes-CO₂e unit (`isTonnesCo2e`: "tCO₂e", "tCO2e", "TCO2E", "t CO2e", "tonnes CO₂e", "tCO2-e", "tCO2eq"; not kg, kt, Mt, a single gas or an intensity) prints exactly `TONNES_DP` (3) decimals, as `src/services/emissionWrite/round.ts`. Any other unit, or none (custom data), keeps `auto`; a format someone picked wins. Axis ticks (`tickLabel`) keep `auto`. `src/studio/sources/format.ts` uses the same `isTonnesCo2e`, so `display` and the renderer's own labels agree.
- Callers pass the bound value's unit: value labels of `bar`/`stacked_bar`, `waterfall`, `target_bars`, the donut's fallback total, every GHG kind (`category_bars`, `site_bars`, `gas_split`, `monthly_stack`, `base_year_waterfall`, `intensity_line`, `treemap`), the `scope_split` legend; bound table cells built from `series` (`tableFromValue` returns the unit; a source's pre-formatted `table` has none); flow table cells by `FlowRow.unit` (new, optional). `gas_split` follows the binding's unit like a table of the same binding would.
- Longer labels stay inside the chart: `charts/svg.ts` `labelWidth` (numeric-aware estimate), `insideX` (a centred label at the first or last band moves in), `fitBarEnds` (horizontal bars narrow just enough for the label after the longest bar). A treemap tile too narrow for "value · share" puts the share on a third line when it is tall enough. Labels that fitted before stay where they were.
