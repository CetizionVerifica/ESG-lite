# DS-4 · Template and element library

> **Module spec**, lane L3, wave 2. Copy to `ESG-lite/src/studio/library/CLAUDE.md`.
> **PR titles:** `[DS-4 k/m]`, six PRs:
> 1. tables + seeds loader + endpoints;
> 2. GHG Inventory template (3 looks) + layouts;
> 3. ISO, Board brief, Summary templates;
> 4. sustainability designs (RS-3 Editorial, Night, Minimal);
> 5. elements + icons + licences;
> 6. FE Templates, Elements and Uploads drawers.
>
> **Depends on:** DS-1, DS-3 · **Owns:** `report_template`, `report_layout`, `report_element`, `report_asset` (+folder), `src/studio/library/*`, `data/studio/**`, `data/studio/LICENSES.md`, FE `panels/TemplatesPanel`, `ElementsPanel`, `UploadsPanel`, `docOps.applyTemplate`, `addLayoutPage`
> **Base:** RS-3 (designs, layouts, assets, fonts). The sustainability designs come from it unchanged in content.

## Job to be done
Starting points worth using. A few deep templates per report kind, built from our own data elements, plus a searchable element library, so that a page can be built the way it would be in Canva.

## Build
1. **Seeds:** `data/studio/templates/<kind>/<slug>/{template.json, layouts/*.json, thumbs/}`. The loader upserts by `(slug, version)`, and a new version never changes existing docs.
2. **GHG templates (D9):**
   - **Inventory:** A4, about 20 pages, sections per `research.md` §3. It uses GhgBindings, InputBindings and flow sections (`ghgp_index`, `ghg_factor_table`, `scope3_categories`). Its layouts are: cover, compliance statement, contents, exec summary (4 big numbers + scope split + waterfall vs base year), boundary (site list + map placeholder), methodology, Scope 1 (by source + gas split), Scope 2 (location + market "Not reported" row), Scope 3 (category bars + category table), by site, intensity, trend and targets, data quality, initiatives, assurance, annex.
   - **ISO 14064-1:** the Inventory plus categories 1–6 mapping, an uncertainty page and conformance and verification pages.
   - **Board brief:** 16:9, 8–10 slides.
   - **One-page summary:** A4.
   - Each template comes in the Classic, Light and Night looks, driven by the brand.
3. **Sustainability:** port the RS-3 designs (Editorial, Night, Minimal) as `report_template` rows of kind `sustainability`, with their ~13 layouts each.
4. **Elements** (`data/studio/elements/`):
   - shapes;
   - lines and arrows;
   - frames (5 masks);
   - grids (2, 3, 4, 6);
   - icons: a Lucide subset of about 300, tagged ESG/industry/transport/energy;
   - SDG badges 1–17 (UN usage guidelines noted in LICENSES);
   - ESG graphics, drawn by us as editable groups of elements: the scope 1/2/3 value-chain diagram, a pillar trio, an "upstream / own operations / downstream" strip, the 15-category Scope 3 wheel;
   - data elements: big number, KPI tile, progress, callout, chart, table.
5. **Endpoints:** `/templates`, `/layouts`, `/elements` with `q` (name + tags), and `/assets` with folders. Thumbnails are rendered by DS-11 `thumbnail` jobs and cached in R2.
6. **FE drawers** (`05-ux` rail):
   - **Templates:** whole-template apply, with the confirm "Replace all pages? Your text edits on pages with the same layout are kept." `applyTemplate` maps by layout kind and keeps user elements. Plus layouts to add one page.
   - **Elements:** search and groups; click to add at the centre, or drag-drop at a point.
   - **Uploads:** drop zone, folders, and generate an image.

## Tests
- **Unit:** the seed loader is idempotent; `applyTemplate` keeps user text on matched layouts; every template validates against the schema for its format.
- **Golden:** each GHG template renders with the seed company in all three looks (snapshot), and its checks list is as expected (for example `SCOPE2_MARKET_MISSING` only).
- **Licences:** a script fails CI if an element file lacks a licence entry.

## Done when
Both kinds offer real templates that build with live data, and the Elements drawer can add every element type with search.
