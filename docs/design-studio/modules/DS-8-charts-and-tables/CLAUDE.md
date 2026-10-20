# DS-8 · Charts and tables editor

> **Module spec**, lane L4, wave 4. Copy to `ESG-lite_FE/src/features/studio/editor/charts/CLAUDE.md`.
> **PR titles:** `[DS-8 k/m]`, four PRs:
> 1. GHG chart renderers (in `render/charts/ghg`, with the L1 owner);
> 2. Charts drawer + chart toolbar + kind picker;
> 3. table editor;
> 4. custom-data grid.
>
> **Depends on:** DS-1, DS-2, DS-6 · **Owns:** `render/charts/ghg/*`, FE `studio/editor/charts/*`, `editor/tables/*`, `panels/ChartsPanel`, Data drawer drag-to-page

## Job to be done
Canva's "select chart → edit data" ease, except that the data is approved inventory data. A typed table is allowed only where it is clearly labelled.

## Build
1. **GHG chart renderers** (static SVG, theme colours, scope colours):

   | Kind | Shape |
   |---|---|
   | `scope_split` | 100 % bar or donut with 3 segments and an optional Scope 2 basis note |
   | `category_bars` | Scope 3 categories, sorted, top n + "Other" |
   | `gas_split` | Bars by gas |
   | `site_bars` | Bars by site |
   | `monthly_stack` | Months stacked by scope |
   | `base_year_waterfall` | Base → drivers by scope → current |
   | `intensity_line` | Intensity over the years |
   | `treemap` | Categories |

   Every kind labels totals and the biggest parts only (RS research §2).
2. **Charts drawer:** thumbnails of the kinds valid for the doc's kind and data (a kind is disabled with a tooltip when the data can't feed it); click or drag to add, bound to a sensible default (e.g. `category_bars` → Scope 3, current year, top 8).
3. **Chart toolbar:**
   - Edit data opens the Data drawer focused on this binding (metric, years, sites, breakdown, top n, compare);
   - Chart kind ▾ (valid kinds only);
   - Colours (brand series or scope colours);
   - Labels (values, legend);
   - Grey prior years;
   - AI "Suggest a title" (DS-9).
4. **Drag from the Data drawer:** dropping a metric on the page asks "Big number · Tile · Chart"; dropping onto an existing chart replaces its binding.
5. **Table editor:**
   - bound tables (columns chosen from the breakdown) or static tables;
   - style, total row, column widths, merge cells (static only);
   - a bound table taller than its frame offers "Move to a flow section".
6. **Custom-data chart:**
   - a grid editor (≤ 200 × 20), with paste from a spreadsheet (the `paste` event; TSV);
   - the element shows an "Unlinked data" badge in the editor only (never printed);
   - it is listed in checks as `UNLINKED_DATA`;
   - it can't use GHG or KPI metric names as series labels (a warning in the grid).

## Tests
- Renderer goldens per GHG kind with the seed data.
- **Unit:** kind validity per binding.
- **Playwright:** add Scope 3 category bars, switch to treemap, change top n, grey prior years; paste a custom table and see the badge.

## Done when
Any GHG or KPI figure can be shown as a chart or table and edited from the toolbar, and a typed chart is possible but always marked.
