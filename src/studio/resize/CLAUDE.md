# DS-10 · Resize and convert

> **Module spec**, lane L3, wave 4. Copy to `ESG-lite/src/studio/resize/CLAUDE.md`.
> **PR titles:** `[DS-10 k/m]`, three PRs:
> 1. mapping engine (pure) + endpoint;
> 2. target layouts for deck, summary and social, per kind;
> 3. FE Resize dialog + linked-source chip.
>
> **Depends on:** DS-1, DS-5, DS-6 (DS-9 optional) · **Owns:** `src/studio/resize/*`, `POST /studio/docs/:id/resize`, FE `studio/resize/*`, `src/lib/studio/resize.ts`, target layouts in `data/studio/templates/*/resize/`

## Job to be done
The Canva Resize / Switch idea for ESG work: turn the 20-page GHG report into a 9-slide board deck, a one-page summary or a social card in one step, with the numbers still linked.

## Build
1. **Mapping (pure, shared with the FE preview):**
   - for each source page, its layout kind maps to a target layout kind per format (`cover → title slide`, `exec_summary → highlights slide`, `scope3 → category slide`, …);
   - bound elements move to matching slots in the target layout by role (`hero_number`, `main_chart`, `table`);
   - unmatched bound elements are dropped from the copy and listed;
   - flow sections become a "See the full report" slide or are dropped.
2. **Text:**
   - with AI on, `summarise_for_deck` and `summarise_for_social` (DS-9) make suggestions that are pre-accepted into the copy but marked `AI_UNREVIEWED`;
   - with AI off, text is cut to the slot length with an ellipsis and `TEXT_TRUNCATED` (info).
3. **Endpoint:** `POST /docs/:id/resize {format, purpose, pageIds?, title}` creates a new doc with `source: {docId, rev, dataHash}`, built and autosaved. It returns the id.
4. **Linked source:** the copy shows "Made from <title>". When the source's data hash differs from `source.dataHash`, it shows "Source data changed", and its bindings resolve live anyway, since they are the same bindings.
5. **FE dialog** (`05-ux` S6): target checkboxes, a preview of the first 3 pages of the selected target (client-side mapping + renderer), chapter picker, "Summarise text with AI", **Create copies**.

## Tests
- **Unit:** the mapping for each template × target; drop lists.
- **Golden:** Inventory → Board brief renders 8–10 slides with the right numbers.
- **Playwright:** resize to a deck and a summary, open the deck, present it.

## Done when
From any GHG or sustainability report, a user creates a linked deck, summary or social card in under 30 seconds.

## As built (2026-10-20, branch `ds-10-resize` in ESG-lite and ESG-lite_FE, local only)

### Files
**ESG-lite**
- `src/studio/resize/engine.ts`: the pure mapping engine (no imports, no Node/DOM, no clock). `RESIZE_TARGETS` (the dialog's five targets), `RESIZE_FORMATS` / `resizeTargetFor(purpose, format)`, `resizeChapters(doc)`, `resizeDocument(doc, {purpose, format, pageIds?, title, sizes, link})` → `{doc, report: {profile, pages[{pageId, layout, from}], dropped[], truncated[], omitted[]}}`, `truncateTextDoc`, `plainText`, `textLength`, `elementRole`, `pageRole`, `TARGET_LAYOUTS`. **Mirrored byte for byte** to ESG-lite_FE `src/lib/studio/resize.ts`; `src/studio/resize/hash.ts` holds `RESIZE_HASH` (sha256 of engine.ts), the FE carries the same value in `src/lib/studio/resizeHash.ts`.
- `src/studio/resize/service.ts`: `resizeDesign` (POST), `linkedSource` (GET), `sourceDataHash`, `acceptSummary` (AI output guard). `aiHook.ts`: `registerResizeSummaryHook` for DS-9. `router.ts`, mounted with one `router.use` in `src/studio/router.ts` (`// DS-10`).
- Contracts: `src/studio/contracts/resize.ts` (`ResizeBodySchema`, `ResizeResponse`, `LinkedSource`, `LinkedSourceResponse`), re-exported from `contracts/index.ts` (`// DS-10`); `contracts/checks.ts` + `TEXT_TRUNCATED` (info, both kinds, `RESIZE_CHECK_IDS`); `ci/studio-contracts.json` regenerated.
- `src/studio/docs/service.ts`: `resolveForBuild` is now exported (one word; DS-10 resolves the source and the copy the way a build does).
- Tests: `ci/unit/ds-10-resize.test.cjs` (11), golden `ci/golden/ds/resize/inventory-deck.json`, `ci/api/tests/ds-10-resize.test.cjs` (7). Route lists `ci/api/tests/ds-lib.cjs` and `ci/golden/ds/lib/routes.cjs` gain `GET /docs/:id/source` (`// DS-10`). `ci/unit/ds-0-contracts.test.cjs` counts 38 checks; `ci/golden/ds/contracts/*.json` list `TEXT_TRUNCATED` in `checksFor`.

**ESG-lite_FE**
- `src/lib/studio/resize.ts` (generated mirror), `resizeHash.ts`, `scripts/sync-studio-resize.mjs` + `npm run sync:studio-resize` (`-- --be=<ESG-lite dir>`; `-- check` verifies the hash).
- `src/lib/studio/contracts.ts` (`TEXT_TRUNCATED`; DS-10 block: `ResizeBody`, `ResizeResponse`, `LinkedSource`, `LinkedSourceResponse`), `contracts.snapshot.json`.
- `src/features/studio/resize/`: `api.ts` (calls + `useResize`, `useLinkedSource`), `logic.ts` (`planTargets`, `chaptersOf`, `pageIdsFor`, `copyTitle`, `countText`, `previewNote`), `ResizeDialog.tsx`, `ResizeButton.tsx`, `LinkedSourceChip.tsx`; tests `logic.test.ts`, `resize.test.tsx`, `src/lib/studio/resize.test.ts`.
- `src/features/studio/editor/TopBar.tsx`: the disabled Resize stub replaced by `<ResizeButton />`, `<LinkedSourceChip />` after the title, and `[&_button]:whitespace-nowrap` on the bar so its buttons stay on one line (all `// DS-10`).
- `src/test/msw/studio.ts`: the DS-0 resize mock now runs the real engine; `GET /docs/:id/source`; `setStudioMockSourceDataChanged()`.
- `e2e/ds-10-resize.spec.ts` (main path + switch off).

### Endpoints (behind `requireDesignStudio`; role R; doc loaded first: 404 other company / unreadable sites, `DS_KIND_OFF`)
| Route | Notes |
|---|---|
| `POST /studio/docs/:id/resize` | `{format, purpose, pageIds?, title?, ai?, company_id?}` → 201 `{id, title, pageCount, dropped, truncated, summarised}`. 422 `DS_FORMAT_INVALID` (purpose/format pair not in `RESIZE_FORMATS`), 422 `DS_RESIZE_UNSUPPORTED` (a card or summary with no numbers or charts, e.g. flow sections only; a booklet of another page shape), 400 `DS_VALIDATION` (bad body, unknown `pageIds`), 409 `DS_VERSION_CONFLICT` while the source is still building. |
| `GET /studio/docs/:id/source` | `{source: null}` for a design that isn't a copy; else `{docId, exists, title, rev, dataHash, currentRev, currentDataHash, dataChanged}`. `exists: false` (no title) once the source is deleted or the caller can't read it. |

### How the mapping works
- **Profiles:** `deck` (slide_16_9, a4_landscape), `summary` (a4, letter, a5), `social` (square, social_191), `booklet` (purpose `report`: a5, a4, letter; same page shape ±10 %, frames, lines and crops scaled).
- **Page roles** come from `FreeformPage.layoutId` (`<family>/<role>`, DS-4). Per kind a role maps to a deck layout or to "left out by default" (with the layout used when picked) and to a chapter: GHG `summary · scope12 · scope3 · trend · methodology · annexes`; sustainability `summary · environment · social · governance · annexes`. Pages without a layout id (people's own pages) are classed by content (chart → chart slide, ≥ 2 hero numbers → highlights, table → table, else text) and go in by default when they show numbers. Flow sections join a chapter by type (`scope3_categories` → Scope 3, `ghg_factor_table` / `methodology` → Methodology when the kind has it, else Annexes); the contents flow is never copied.
- **Target layouts** (`TARGET_LAYOUTS`, mm on a reference size, scaled to the format): deck `title, highlights, chart, table, text, section, full_report, close`; `one_page`; `social_square`; `social_wide`. Slots accept element roles (`kicker, title, heading, subtitle, body, caption, callout, hero_number, fact, chart, table, image`); decor (shapes, rules, page numbers, empty frames, footers) never moves. Narrow hero slots turn a big number into a KPI tile card (a big number's type size doesn't shrink with its frame). The same figure appears once per page.
- **Deck:** a title slide first (the cover, or one made from the doc), one slide per included page in order, then one "See the full report" slide naming the flow sections and the pages left out (up to 8, "and more"), the back cover last. **Inventory → 10 slides**: title, highlights (exec summary), Scope 1, Scope 2, Scope 3, sites, trend, initiatives, full report, close.
- **Summary / social:** one page filled from every included page, highlights pages first; the title is the report's.
- **Dropped:** every bound element (binding or data chip) of an included page that found no slot is listed `{pageId, pageName, elementId, type, label}`; the unit test checks moved + dropped = bound for every template × target.
- **Text:** slot lengths in characters (a chip counts 8). Longer text is cut at a word with "…", chips whole, marks kept, lists flattened to "• " paragraphs, and listed in `truncated` (with the original for AI).
- **The copy:** `meta.title` = the request's title (default `<source> · Board deck|Summary|Social card|Booklet`), the source's `design` (template id, look, brand overrides), meta, assets and inputs; `source = {docId, rev, dataHash}` with the source's data hash resolved at resize time; `report_doc.source_doc_id`, `template_id = null` (no template to rebuild from), its own `data_hash`, every bound element stamped `basedOnHash`, rev 1 and an `autosave` version "Made from …". The report is stored in `report_doc.build.resize` `{profile, pages, dropped, truncated, omitted, from, summarised, ai}` and the build steps say what happened.

### Decisions and deviations
1. **Target layouts live in the engine (TypeScript), not in `data/studio/templates/*/resize/`.** The FE preview must run the very same mapping, and the engine is mirrored byte for byte (like the renderer); JSON files would be a second copy to keep in step. Per-kind behaviour is the role table (`ROLE_RULES`) and the chapters; the slot layouts are shared by both kinds.
2. **`GET /docs/:id/source`** is a route outside 01-contracts §4 (awaiting a DS-0 follow-up), added to both route lists. "Source data changed" compares the source's data hash *now* (resolved like a build, approved data only, inputs included) with `doc.source.dataHash`; the copy's numbers always resolve live.
3. **`ai` in the resize body** (not in the 01-contracts body): asks DS-9 for `summarise_for_deck` / `summarise_for_social` per cut text. DS-9 registers through `registerResizeSummaryHook`; until then (`ai: 'unavailable'`) and when the hook throws (`'failed'`) the cut text stays. An AI summary is used only when it is valid TipTap text whose chips all come from the original and that adds no digits; it lands with `source: 'ai'`, not reviewed (AI_UNREVIEWED).
4. **`TEXT_TRUNCATED`** (info, both kinds) is in the contracts; the copy lists the cut elements in `build.resize.truncated`. DS-12 turns that list into checks (for elements still present and still cut).
5. The body also accepts `company_id` (a Superadmin names the company, as every studio body).
6. **FE:** the dialog is its own wide modal (`src/ui` Modal stops at `max-w-xl`) using the `src/ui` focus trap and scroll lock; "Summarise text with AI" starts off (no AI status exists on the FE yet; DS-9 can pass `aiOn`). `pageIds` are sent only when the chapter picker changed (each target keeps its own defaults otherwise). One copy opens at once; several are listed with Open links.

### Tests run
- ESG-lite `test-lane.sh ds-10-be` (at `2a081ea`): build ok, unit 573 pass, scope3 golden 32/32, calculation snapshot matches, API 738 pass / 0 fail (ds-10: 7), workflow 55 + 29 pass, 9 skipped. After the last engine commit (a lint comment and its hash): `ci/unit/ds-10-resize.test.cjs` 11/11.
- ESG-lite_FE `test-lane.sh ds-10-fe`: typecheck ok, lint:new ok, vitest 1927 pass (204 files; DS-10: 16). Playwright on a private port: `ds-10-resize` 2/2, `ds-0-switch` 5/5, `ds-6-editor` + `ds-11-outputs` pass. `check:studio-render` and `sync:studio-resize -- check` ok.

### Not done
- **AI summaries** need DS-9 to register its summariser (`registerResizeSummaryHook`); the hook path is guarded by `acceptSummary` (unit-tested) but has no API test with a live hook.
- **The `TEXT_TRUNCATED` check itself** is DS-12's to raise from `build.resize.truncated`.
- **ci/golden/ds `seed/ghg-board-brief`** ("resized from the Inventory", waits DS-10) stays skipped: it needs DS-14's seed-doc runner; the Inventory → deck golden here covers the mapping.
- The deck's pages carry the source's speaker notes when there are some; no notes are written for slides made from scratch. No "Pages to include" per target (one picker for all copies). The dialog doesn't show the full drop list (counts only in the note; the copy's `build.resize` has it).
