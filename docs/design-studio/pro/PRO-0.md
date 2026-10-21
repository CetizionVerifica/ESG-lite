# PRO-0 · Shared contracts for AT-1, AT-2, PE-1, PE-2

> Plan: `01-pro-editing-and-ai-templates.md` (this folder); background `README.md`; mockups `canvas/project/{AiTemplates,AiLayouts,PhotoEdit,TextEffects}.dc.html`.
> Owner decisions accepted: **E1** background remover on the server (ONNX via onnxruntime-node, model from `STUDIO_BG_MODEL_PATH`, 503 `DS_BG_UNAVAILABLE` without it, stub engine under `NODE_ENV=test`, result = new derived asset, run as a studio job); **E2** the AI may see template names/descriptions and the fenced free-text brief, coverage counts only, no PII, no figures; **E3** custom fonts are Manager/Superadmin only, WOFF2/TTF/OTF ≤ 5 MB, licence tick stored, magic bytes checked, embedded in the PDF from stored bytes.

## What the four modules build on

### Element props (`src/studio/contracts/proProps.ts`, FE `ImageEditProps` / `TextEditProps`)
All optional: every doc saved before PRO-0 stays valid and renders unchanged.

| Element | Prop | Shape | Owner |
|---|---|---|---|
| image, frame | `adjust` | `{brightness?, contrast?, saturation?, warmth?}` ints -100..100, `blur?` 0..100; absent = 0 | PE-1 |
| image, frame | `filter` | `none \| vivid \| mono \| warm \| cool \| fade` (absent = none) | PE-1 |
| image, frame | `duotone` | `{dark, light}` hex, or `null` (off) | PE-1 |
| image, frame | `originalAssetId` | the source asset while `assetId` is a derived (background-removed) asset; "Restore original" moves it back | PE-1 |
| every element | `opacity` | **existing** element opacity 0..1 (DS-6), already applied by the renderer in every mode; the UI shows 0..100 % | PE-1 (UI) |
| text | `effects` | `{shadow?{blur 0..100, offsetX/offsetY -100..100, colour, opacity 0..100}, lift?{intensity 0..100}, outline?{width 0..100, colour}, highlight?{colour, radius 0..100}, curve?{radius -100..100}}`; shadow and lift exclude each other | PE-2 |
| text | `font` | `FontRef` = a bundled `FontId` or `custom:<BrandFont.id>`; overrides the style's font; a deleted custom font falls back to the style's font | PE-2 |

Units are slider integers; the renderer module that draws an effect owns its mapping to SVG/CSS filters and pins it with a DS golden (`npm run test:ds-golden`) in editor, Page view, PNG and PDF.

### API (`src/studio/contracts/pro.ts`, FE `// PRO-0` block of `src/lib/studio/contracts.ts`)

| Module | Route | Role | Request → response |
|---|---|---|---|
| AT-1 | `POST /studio/templates/suggest` | R | `TemplateSuggestBody {kind, brief{purpose, frameworks, audience, length, tone?, note?}, year, yearType, sites, format?}` → `TemplateSuggestResponse {shortlist: TemplateSuggestion[] (≤ 3: templateId, rank, template, readiness{score, level, badges[], notReportedPages}, reasons[], pagesToDrop[], pagesToAdd[]), aiUsed, model, considered}`; model output `TemplateSuggestModelOutputSchema`; logged as `report_ai_call.action = 'suggest_templates'` |
| AT-2 | `POST /studio/docs/:id/ai {action:'suggest_layouts', target:{pageId}}` (DS-9 route) | R | `Suggestion` kind `pages`: `payload.pages` = 3 options (same page id), `payload.layoutOptions[i]` = `LayoutOptionMeta {id A/B/C, name, layoutSlug, reason, placedElementIds}`; model output `SuggestLayoutsModelOutputSchema` (layout slugs from the candidate list + `slot → elementId`; the server builds the pages) |
| AT-2 | `POST /studio/docs/:id/template-swap/preview` | R | `{templateId, rev}` → `TemplateSwapPreview {fromTemplateId, templateId, rev, doc, pages: SwapPageMapping[], unplaced[], previewHash}`; nothing saved |
| AT-2 | `POST /studio/docs/:id/template-swap/apply` | R | `{templateId, rev, previewHash}` → `DocResponse` (one new rev); stale rev or hash → 409 `DS_VERSION_CONFLICT {rev}` |
| PE-1 | `POST /studio/assets/:id/remove-background` | R | `{}` → 202 `ImageJob`; 503 `DS_BG_UNAVAILABLE`; SVG → 415 `DS_ASSET_TYPE` |
| PE-1 | `GET /studio/image-jobs/:id` | R | `ImageJob {id, kind 'remove_background', assetId, status, resultAssetId, errorCode, errorReason, createdAt, finishedAt}`; the result asset carries `StudioAsset.derivedFrom = {assetId, op}` |
| PE-2 | `GET /studio/brand-kit/fonts` | R | `BrandFontsResponse {fonts: BrandFont[], canEdit}` (`BrandKit.customFonts` may carry the same list) |
| PE-2 | `POST /studio/brand-kit/fonts` (multipart) | M | `file` + `FontUploadFields {family, weight, style, licenceConfirmed}` → 201 `BrandFont {id, ref 'custom:<id>', family, weights, styles, assetIds, files[{assetId, weight, style, format, bytes, url}], licenceConfirmedBy, licenceConfirmedAt, createdAt}`; errors `DS_FONT_LICENCE` 422, `DS_FONT_TYPE` 415 (magic bytes `FONT_MAGIC`), `DS_FONT_TOO_LARGE` 413, `DS_FONT_EXISTS` 409 |
| PE-2 | `DELETE /studio/brand-kit/fonts/:id` | M | 204 |
| PE-2 | `GET /studio/brand-kit/fonts/:id/files/:fileId` | R | the font bytes (`font/woff2 \| font/ttf \| font/otf`) for the editor's `@font-face` |

Find and replace is a pure FE doc op (no route): `FindQuery`, `FindMatch`, `FindReplaceOp`, `FindResult` in the FE contracts. Data chips, locked and template-locked boxes and hidden pages are never changed.

### Error codes (`contracts/errors.ts`, PRO-0 block)
`DS_NOT_BUILT` 501 (stub), `DS_BG_UNAVAILABLE` 503, `DS_FONT_TYPE` 415, `DS_FONT_TOO_LARGE` 413, `DS_FONT_LICENCE` 422, `DS_FONT_EXISTS` 409. Everything else reuses DS codes (`DS_VERSION_CONFLICT`, `DS_LAYOUT_NOT_FOUND`, `DS_FINAL_IMMUTABLE`, `DS_ASSET_TYPE`, `DS_JOB_FAILED`, the DS-9 AI codes).

### How a module takes over its stub
1. Replace its router file: AT-1 `src/studio/suggest/router.ts`, AT-2 `src/studio/swap/router.ts`, PE-1 `src/studio/images/router.ts` (engine in `src/studio/images/bgRemove/`), PE-2 `src/studio/fonts/router.ts`. The mount lines in `src/studio/router.ts` (`// PRO-0`) stay.
2. Load docs with `loadDocRow` + `assertDocSitesReadable` + `assertKind`; assets and fonts by `company_id`; another company's id answers 404.
3. Add the module's own `ci/api/tests/ds-pro-<module>-*.test.cjs` (tenant isolation, role, switch-off, kind-off, payloads). `ds-pro-0-contracts.test.cjs` keeps checking the guard on every route and accepts a real answer once the stub is gone.
4. When the route's first path segment needs a company-1 row for the cross-tenant probe, add an `ID_SOURCES` line (and a `SEED` step) in `audit/harness/ds-probes.cjs` (`image-jobs` for PE-1, `brand-kit` for PE-2).
5. New tables: an idempotent `src/scripts/migrateDsPro<N><Name>.ts`, registered as `migrate:ds-pro-<n>-<name>` in `package.json` (append), entity in `src/config/data-source.ts` so `ci/schema-sync.cjs` builds it.
6. FE: replace the MSW `PRO-0` handlers' behaviour if the real one differs, and build the UI on the API client stubs.

## As built (2026-10-20, branch `pro-0-contracts` in ESG-lite and ESG-lite_FE, local only)

### Files
**ESG-lite**
- Docs: `docs/design-studio/pro/` (copy of `plans/canva-premium`: `README.md`, `01-pro-editing-and-ai-templates.md`, `canvas/`), this file; "Pro editing" block in `src/studio/CLAUDE.md`.
- Contracts: `src/studio/contracts/proProps.ts` (new), `src/studio/contracts/pro.ts` (new); `schema.ts` (spreads `imageEditProps` into image and frame props, `textEditProps` into text props, `// PRO-0`); `ai.ts` (`Suggestion.payload.layoutOptions?`); `library.ts` (`StudioAsset.derivedFrom?`); `brandkit.ts` (`BrandKit.customFonts?`); `errors.ts` (PRO-0 codes); `snapshot.ts` (15 PRO-0 enums); `index.ts` (re-exports). `ci/studio-contracts.json` regenerated.
- Routes: `src/studio/notBuilt.ts` (501 `DS_NOT_BUILT {module}`), stubs `src/studio/{suggest,swap,images,fonts}/router.ts` (font writes behind `requireManager`), four `router.use` lines in `src/studio/router.ts`.
- Test plumbing: the PRO routes in `ci/golden/ds/lib/routes.cjs` `CONTRACT_ROUTES` (modules AT-1 … PE-2) and `ci/api/tests/ds-lib.cjs` `STUDIO_CONTRACT_ROUTES`; `ci/unit/ds-14-verification.test.cjs` accepts `AT-n`/`PE-n` module names; `ci/unit/ds-0-contracts.test.cjs` expects the PRO-0 error codes; `audit/harness/ds-probes.cjs` treats a `DS_NOT_BUILT` stub as "not built yet" (n/a in the tenant probe, no 5xx flag) and lists the font writes as Manager-only.
- Tests: `ci/unit/ds-pro-0-contracts.test.cjs` (8: fixtures still valid, image/frame/text props in and out of range, AT-1/AT-2/PE-1/PE-2 schemas, error codes, snapshot), `ci/api/tests/ds-pro-0-contracts.test.cjs` (3: switch-off on every PRO route for every role; Users DS_ROLE, Admins DS_ROLE on font writes, Managers and the Superadmin past the guard with `DS_NOT_BUILT {module}` from stubs; other company → 404, Superadmin without company_id → DS_COMPANY_REQUIRED).

**ESG-lite_FE**
- `src/lib/studio/contracts.ts`: image/frame/text props extended (`& ImageEditProps` / `& TextEditProps`, `// PRO-0`), `StudioAsset.derivedFrom?`, `BrandKit.customFonts?`, `Suggestion.payload.layoutOptions?`, PRO-0 error codes, and the `// PRO-0` block (enums, `IMAGE_ADJUST_RANGE`, `FontRef` + `isCustomFontRef`, AT-1/AT-2/PE-1/PE-2 shapes, find and replace op types). `contracts.snapshot.json` copied from the backend.
- API client stubs with TanStack hooks and error copy: `src/features/studio/new/suggestApi.ts`, `src/features/studio/swap/api.ts`, `src/features/studio/photo/api.ts`, `src/features/studio/brand-kit/fontsApi.ts` (the delete call carries a `data-loss-reviewed` marker).
- MSW: the `PRO-0` block of `src/test/msw/studio.ts` (state, `setStudioMockTemplateAi`, `setStudioMockBgRemover`, `studioMockFonts`, handlers for every new route, `suggest_layouts` in the DS-9 AI handler, error messages), reset in `resetStudioMocks`.
- Tests: `src/lib/studio/proContracts.test.ts` (3), `src/test/msw/studioPro.test.ts` (6).
- "Pro editing" block in `src/features/studio/CLAUDE.md`.

### Deviations
1. **Transparency** uses the existing element `opacity` (0..1, DS-6) instead of a new 0..100 prop on image/text/shape: it is already on every element and already rendered identically in every mode, so a second field would only conflict. The UI shows percent.
2. **Renderer untouched.** The renderer's input types are structural, so the new optional props pass through without a visual change; adding them to `render/types.ts` now would only move `RENDER_HASH` for every module. PE-1 and PE-2 add their props to `render/types.ts`, render them, re-sync and update the hash.
3. **No new AI action.** `suggest_layouts` already exists in `AI_ACTIONS` (DS-9 left it unbuilt). AT-1 isn't a doc action; it logs `report_ai_call.action = 'suggest_templates'` (`TEMPLATE_SUGGEST_LOG_ACTION`), so `AI_ACTIONS` and its golden list are unchanged.
4. **Stubs answer 501 `DS_NOT_BUILT`** behind the real guard (switch, role, Manager-only writes) rather than being left unmounted, so the switch-off and role tests already cover the routes. The DS probes count a stub as not built.
5. **Image jobs are their own shape** (`ImageJob`, `GET /image-jobs/:id`) rather than a new `JOB_KINDS` value: `report_job` rows belong to a doc, a background removal belongs to an asset.
6. **Custom fonts per text box** (`text.props.font`); the brand kit heading/body pair and `theme.fonts` stay bundled `FontId`s. Widening them to `FontRef` is PE-2's call (it touches the renderer's theme).
7. **Brief length** is `short | medium | long` (about 2 / 20 / 40 pages, as the mockup) and audience `verifier | board | investors | public` (the mockup's four).
8. **No migrations**: PRO-0 adds no table or column; PE-1 (image jobs, derived asset column) and PE-2 (fonts) ship theirs.

### Not done (owned by the modules)
- Every behaviour behind the stubs (AT-1, AT-2, PE-1, PE-2), their tables, the renderer effects and their DS goldens, the UI.
- `ID_SOURCES` lines for `image-jobs` and `brand-kit` in the DS probes (need the modules' tables).

### Tests run
- ESG-lite `test-lane.sh pro-0-be`: build, unit, Scope 3 golden 32/32, Scope 1/2 snapshot, API 782 pass / 0 fail (ds-pro-0: 3). Workflow failed once on `C2` with `fetch failed / ECONNRESET` (a Scope 3 seed request under a load average of ~25 from parallel lanes, not studio code); a rerun of `ci/workflow/local.sh` on a fresh throwaway DB passed 62 + 29, 0 fail (DS-W steps and the DS probes included).
- ESG-lite_FE `test-lane.sh pro-0-fe`: typecheck ok, lint:new ok; vitest 1990 pass / 17 fail in the lane, all 5 s timeouts in editor/AI/review/text component tests while the backend lane ran; the six files pass on their own, and a full rerun gave 2006 pass / 1 fail (`TextEditing` timeout, which passes 8/8 alone). PRO-0 tests: `proContracts.test.ts` 3, `studioPro.test.ts` 6, `contracts.test.ts` 6, all pass. `check:studio-contracts ../pro-0-be` matches.
