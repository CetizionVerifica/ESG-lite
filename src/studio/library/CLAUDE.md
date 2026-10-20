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

## As built (2026-10-20, branch `ds-4-library` in both repos, local only)

### Files
**ESG-lite**
- Tables: `src/entities/StudioTemplate.ts` (`report_template`), `StudioLayout.ts` (`report_layout`), `StudioElement.ts` (`report_element`), `StudioAsset.ts` (`report_asset`, uuid id, + `folder`), registered in `src/config/data-source.ts` (`// DS-4`). Migration `src/scripts/migrateDs4Library.ts` = `npm run migrate:ds-4-library` (IF NOT EXISTS statements equal to TypeORM's, then the seed loader; `--no-seed` skips it). It runs on every start through `migrate:all`.
- Contracts: `src/studio/contracts/library.ts` (`ELEMENT_GROUPS`, `ReportTemplate`, `ReportTemplateDetail`, `ReportLayout`, `ElementTemplate`, `ElementPayload` / `ElementGroupPayload`, `StudioAsset`, query and body schemas, `ASSET_MAX_BYTES`), re-exported from `contracts/index.ts` (`// DS-4`).
- Library: `src/studio/library/`
  - `compose.ts` (pure): `composeTemplateDoc`, `pageFromLayout`, `instantiateTemplate(doc, {company, year, yearType, sites?, frameworks?, compareYear?, title?})` (fills `{{company}}`, `{{year}}`, `{{period}}`, `{{title}}`; narrows `sites: 'all'` bindings to the doc's sites), `periodLabel`, `layoutSlug`, `templateSlug`. **DS-5 builds docs with `templateDoc()` + `instantiateTemplate()`.**
  - `seed.ts`: `readLibrarySeeds()` (validates every template doc per look and every layout with `ReportDocSchema` for its format, every element with `ElementSchema`, every licence id against `data/studio/LICENSES.md`, unique slugs) and `loadLibrarySeeds()` (advisory lock; upsert by (slug, version) / slug; unchanged rows untouched; older versions and unseeded system slugs turn inactive).
  - `service.ts`: `listTemplates`, `getTemplate`, `templateDoc(caller, idOrSlug)`, `listLayouts`, `listElements`.
  - `assets.ts`: `sniff`, `svgProblem`, `cleanImage` (sharp re-encode, `.rotate()` then metadata dropped), upload with dedupe, list, patch, delete (refused while a `report_doc` draft references the id, once DS-5's table exists), file, generate.
  - `storage.ts`: R2 (`studio-assets/company_<id>/<uuid>.<ext>`) or `local-uploads/` without R2 (URL from `LOCAL_UPLOAD_BASE_URL`).
  - `router.ts`, mounted in `src/studio/router.ts` (`// DS-4`).
  - `seeds/`: the authoring kit (`kit.ts`), `ghg.ts`, `sustainability.ts`, `elements.ts`, `lucide.ts` (the icon subset by theme), `index.ts` (`seedFiles()`).
- Generator: `src/scripts/buildStudioSeeds.ts` = `npm run seeds:ds-4` (`-- --check` fails on stale files) writes `data/studio/templates/**`, `data/studio/elements/*.json` and `src/reporting/studio/render/iconsLucide.ts`.
- Data: `data/studio/templates/ghg/{ghg-inventory, ghg-iso14064, ghg-board-brief, ghg-one-page}/`, `data/studio/templates/sustainability/{sustainability-editorial, -night, -minimal}/` (each `template.json`, `layouts/NN-<role>.json`, `thumbs/README.md`), `data/studio/elements/<group>.json`, `data/studio/LICENSES.md`.
- Renderer: `render/icons.ts` draws `lucide:<name>` from the generated `render/iconsLucide.ts`; `RENDER_HASH` bumped, FE mirror synced; `ci/golden/ds/render/snapshots.json` (only `renderHash` changed).
- Tests: `ci/unit/ds-4-library.test.cjs` (10), `ci/api/tests/ds-4-library.test.cjs` (12), golden `ci/golden/ds/templates/snapshots.json` (sha256 of each GHG template × look, rendered with no data). `ci/api/tests/ds-lib.cjs`, `ci/golden/ds/lib/routes.cjs` (the three added routes) and `audit/harness/ds-probes.cjs` (a company-1 template and asset SEED step) appended with `// DS-4`.
- Dependencies: `sharp` 0.35.5 (Apache-2.0), devDependency `lucide-static` 0.563.0 (ISC; the FE's lucide-react version).

**ESG-lite_FE**
- `src/lib/studio/contracts.ts`: the DS-0 mock shapes confirmed (DS-4 fields added as optional so older mocks type-check), `ElementGroup`, `ElementGroupPayload`, `ASSET_MAX_BYTES`, `ASSET_MIMES`.
- `src/lib/studio/libraryOps.ts` (+ test): `insertElement`, `ELEMENT_DRAG_TYPE` / `elementDragData` / `readElementDrag` / `dropElement`, `placeAsset`, `imagePayload`, `assetRef`, `pageFromLayout`, `addLayoutPage`, `applyTemplate`, `bindingForDoc`, `fillPlaceholders`, `periodLabel`, `docVars`.
- `src/features/studio/panels/TemplatesPanel.tsx`, `ElementsPanel.tsx`, `UploadsPanel.tsx`, `library/api.ts` (hooks), `library/SheetThumb.tsx` (renderer thumbnails with crop), `library/preview.ts` (brand kit → RenderBrand, element previews), `LibraryPanels.test.tsx` (11 tests).
- `src/test/msw/studio.ts`: DS-4 fields on the sample templates and layouts, a line and a group element, `PATCH /assets/:id`, `POST /assets/generate` (`setStudioMockImageGen`), q over name/description/tags, `template=` on layouts.
- Renderer mirror (`src/lib/studio/render/icons.ts`, `iconsLucide.ts`, `hash.ts`) and `src/test/fixtures/studio-render/snapshots.json` from the sync script.

### What ships
- **15 template rows**: GHG Inventory (A4, 23 pages), ISO 14064-1 (A4, 25 pages: + categories 1–6, uncertainty, conformance, verification, ISO index), Board brief (16:9, 10 slides), One-page summary (A4, 1 page), each × Classic/Light/Night; Editorial (classic), Night (night), Minimal (light) sustainability designs (24 pages each).
- **99 layout rows**: Inventory 18, ISO 22, Board brief 10, Summary 1, each sustainability design 16 (every LayoutKind but `blank`).
- **367 elements**: shapes 10, lines 10, frames 5, grids 4 (2, 3, 4, 6), icons 303 (21 own + 282 Lucide, tagged nature/climate/energy/transport/industry/people/governance/data/general, ESG themes also `esg`), SDG 17, ESG graphics 5 (value chain, scope circles, pillars, upstream–downstream strip, Scope 3 wheel) as editable groups, data 13 (big number, KPI tile, progress ring and bar, callout, three charts, table, text box, page number, QR, placeholder).

### Decisions
1. **One row per look.** `slug = <family>-<look>` (a one-look family: `<family>`); `doc.design.templateId` = slug, `theme.look` = the look. Layouts belong to the family (`slug = <family>/<role>`), shared by its looks: layouts never hard-code a colour, so the look and the brand decide every colour.
2. **`report_layout.page_kind`** holds the RS LayoutKind (the DS table already has `kind` = ReportKind); `role` is what applyTemplate maps by (`cover`, `scope1`, `exec_summary`…).
3. **Seeds are generated.** The TypeScript in `seeds/` is the source; the JSON is committed and checked equal by the unit test. Text slots in a template page may be overridden (`{"layout": "chapter", "text": {"title": "Social"}}`).
4. **Placeholders** in template text: `{{company}}`, `{{period}}` ("2025" / "FY 2025"), `{{year}}`, `{{title}}`. Bindings use `years: {last: n}` and `sites: 'all'`, relative to the doc.
5. **GHG templates bind only `ghg` and `input`**, sustainability templates only `kpi` (ESG headline codes, src/kpi/esg/headlines.ts); no `custom` data. Market-based Scope 2 is bound everywhere it is shown (D7: it resolves "Not reported" with its reason).
6. **Icons** are `lucide:<name>` in the renderer, so DS-1's own icon names and goldens are unchanged.
7. **Element payloads** sit at x = y = 0 with id `el`; groups are `{type:'group', w, h, elements}` with frames relative to the box. The FE fits bindings on insert: the doc's sites, and GHG → ESG headline KPI for a sustainability doc.
8. **applyTemplate**: template pages replace the doc's; each is matched to an unused old page of the same role; on a match every text slot keeps the old text (layout/auto source) and user/AI elements move across with notes and guides; old pages with user elements and no match are kept at the end. Meta, inputs, assets and the brand's colour and font overrides stay; look, templateId and templateVersion come from the template. Kind and format must match (Resize is DS-10).
9. **Asset storage** without R2 is `local-uploads/` (the app's dev storage), so uploads work in development and in the API tests; `GET /assets/:id/file` serves them to the tenant (and redirects to R2 when configured).

### Deviations
1. **Three routes outside 01-contracts §4** (awaiting a DS-0 contracts follow-up): `PATCH /assets/:id` (move to a folder, alt text), `GET /assets/:id/file`, `POST /assets/generate` (AI image, RS R13). Added to both route lists with `// DS-4`.
2. **Asset in use**: no error code exists for it, so DELETE answers `DS_VALIDATION` (400) with `details.reason = 'ASSET_IN_USE'` and the doc ids.
3. **Template not found** answers `DS_LAYOUT_NOT_FOUND` (404, "That template or layout wasn't found.") rather than `DS_DOC_NOT_FOUND`; a non-numeric id answers `DS_DOC_NOT_FOUND` (routeId).
4. **FE ops live in `src/lib/studio/libraryOps.ts`**, not `docOps.ts` (DS-6 owns and is writing docOps in parallel): DS-6 re-exports `applyTemplate`, `addLayoutPage`, `insertElement`, `dropElement`, `placeAsset` from it.
5. **Uploads are re-encoded in their own format** (JPEG q90, PNG, WebP q90), not converted; SVG is refused rather than stripped when it holds anything unsafe.
6. **Generate image** is not budgeted or logged in `report_ai_call` (DS-9 owns that table); it uses `src/reporting/imagery.ts` as is and answers 503 `DS_AI_UNAVAILABLE` without a provider.

### Not done
- **Thumbnails**: `thumbnail_key` stays null until DS-11 `thumbnail` jobs; the FE draws covers, layouts and elements live with the renderer (`SheetThumb`), in the client's brand, without data.
- **Template checks golden** ("its checks list is as expected, e.g. `SCOPE2_MARKET_MISSING` only"): waits on DS-12 checks. The render golden runs with no data; renders "with the seed company" (live data) wait on DS-5 docs (`ci/golden/ds/cases.json` seed group).
- **Layout lint against the RS-9 layout rules** (safe area, minimum font, contrast with real brands): waits on DS-12; templates were checked by eye as PNGs in all looks.
- **Playwright** for the drawers: no route shows them until the DS-6 editor shell mounts them (`registerDrawer`); component tests with MSW cover them.
- **Drop on the canvas**: the drawers set `ELEMENT_DRAG_TYPE`; reading it on the sheet (`readElementDrag` + `dropElement`) is DS-6's.
- **Company templates and layouts** (`POST /templates/from-doc`, `/layouts/from-page`): DS-13.
- Flow sections in the Night look render on a white page (DS-1 flow CSS); noted for the renderer lane.

### Tests run
- ESG-lite `test-lane.sh ds-4-be`: build, unit, scope3 golden (32/32), scope 1/2 golden, API 702 pass / 0 fail (ds-4: 12), workflow 55 + 29 pass, 9 skipped.
- ESG-lite_FE `test-lane.sh ds-4-fe`: typecheck, lint:new, vitest 1748 pass (176 files; DS-4: libraryOps 15, panels 11).
