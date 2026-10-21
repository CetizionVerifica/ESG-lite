# AT-2 · Suggest layouts + try another template (editor)

> Plan: `01-pro-editing-and-ai-templates.md` §2B and §3. Contracts: `PRO-0.md` (`SuggestLayoutsModelOutputSchema`, `LayoutOptionMeta`, `TemplateSwapBody`, `TemplateSwapApplyBody`, `TemplateSwapPreview`). Mockup: `canvas/project/AiLayouts.dc.html`.

## What it does
- **Suggest layouts** (`POST /studio/docs/:id/ai {action: 'suggest_layouts', target: {pageId}, params?: {differentFrom?, note?}}`, the DS-9 route, role R): three layouts for one free-form page, built only from the company's library layouts (system + own, the doc's kind and format) and the page's own elements. The answer is a DS-9 `Suggestion` of kind `pages`: `payload.pages` holds three options that all keep the page id, and `payload.layoutOptions[i]` is `{id A/B/C, name, layoutSlug, reason, placedElementIds}`. Nothing is written to the doc; the FE shows ghost previews and applies the chosen one as one undo step through the normal PATCH.
- **Try another template** (`POST /studio/docs/:id/template-swap/preview|apply`, role R): restyles the whole report with another template of the same kind and format while keeping every text, chart, table and data chip. Preview returns the proposed doc, a page-by-page mapping, anything unplaced and a `previewHash`, and saves nothing. Apply rebuilds the same preview, checks rev and hash, and saves it as one new rev.

## As built
**Pure logic** (`src/studio/swap/compose.ts`): `layoutSlots`, `movable`, `rankLayouts` (the page's own layout and the `differentFrom` slugs left out; covers only for covers), `autoAssign` / `checkPairs` (slot → element by kind and size), `composePage` (only `frame` and `z` move on existing elements; layout decoration is added with doc-unique ids), `layoutOptionIssues` (every element kept, props unchanged, nothing invented, `ElementSchema`, the doc schema, DS-12 safe area and locked overlaps), `swapTemplate` (theme from the new template, pages mapped by layout role, content kept, unmatched pages kept as they are) and `docHash`.

**suggest_layouts** (`src/studio/swap/layouts.ts`, prompt `src/studio/ai/prompts/layouts.ts`; `ai/runner.ts` hands the action over):
1. Target check before any model call: missing, unknown, flow, hidden or empty page → 400 `DS_VALIDATION`.
2. Up to 8 candidate layouts from `rankLayouts`; none → `DS_LAYOUT_NOT_FOUND`.
3. DS-9 budget, model via `ai/client.ts` (`src/lib/openrouter.ts` config), a `report_ai_call` row per call (`action = 'suggest_layouts'`).
4. The model sees element ids, kinds, sizes and short excerpts fenced as untrusted data (`<untrusted name="page_elements">`), with chips shown as `⟨figure⟩`; never a resolved value. The free-text `note` is fenced too.
5. The answer must parse as `SuggestLayoutsModelOutputSchema`; every slug must be a candidate, every slot must exist and fit, names and reasons pass `literalNumberIssues`. The server builds each page (`composePage`) and re-checks it (`layoutOptionIssues`).
6. Any issue → one retry listing the issues → 502 `DS_AI_OUTPUT_INVALID {issues}`. Fewer than three good options are topped up with the best remaining candidates and a server-written reason, so the answer has three whenever the library does.

**Template swap** (`src/studio/swap/service.ts`, `swap/router.ts` replacing the PRO-0 stub):
- Doc load: `loadDocRow` (company → 404 `DS_DOC_NOT_FOUND`, `assertKind` → 403 `DS_KIND_OFF`, the `assertDocSitesReadable` rule via `canReadSites` → 404). A doc being built → 409 `DS_VERSION_CONFLICT {rev, building}`.
- Template: `templateDoc` (system or the company's own; another company's → 404 `DS_LAYOUT_NOT_FOUND`); other kind → `DS_LAYOUT_NOT_FOUND`; other format → 422 `DS_FORMAT_INVALID` (that is Resize).
- Preview: stale `rev` → 409 `DS_VERSION_CONFLICT {rev}`; the result is re-validated with `ReportDocSchema`; nothing saved, also on a final.
- Apply: final → 409 `DS_FINAL_IMMUTABLE`; stale `rev` or a `previewHash` that no longer matches (doc, template or target template changed) → 409 `DS_VERSION_CONFLICT {rev}`; else one rev through DS-5's `patchDoc` (rev, final, sites, template locks, autosave), with `report_doc.template_id` set in the same `UPDATE` as the draft and rev (`updateDraft`'s `templateId`), so a failed write moves neither. No model call.

**Plumbing:** `ci/golden/ds/lib/routes.cjs` and `ci/api/tests/ds-lib.cjs` keep the two swap routes (marked built); `audit/harness/ds-probes.cjs` needs no new `ID_SOURCES` line (`docs` is DS-5's). DS-9 chat (`ai/chat.ts`) now points "suggest a layout" asks at the drawer's layouts. Recorded answer in `ci/fixtures/studio/ai/recorded.json`; DS golden `ci/golden/ds/ai/recorded/suggest_layouts.json` (via `ci/golden/ds/lib/layouts.cjs`) pins candidates, frames moved and decoration added per option.

## Deviations
1. **Doc checks through `loadDocRow`.** It already runs `assertKind` and the same site rule as `assertDocSitesReadable` (`canReadSites`: `'all'` needs every site), so the swap and the DS-9 route don't call them a second time.
2. **Hash conflict detail.** A stale preview hash answers `DS_VERSION_CONFLICT {rev, reason: 'preview_changed'}`; the extra `reason` lets the FE say "the preview is out of date" rather than "someone else changed this".
3. **Unknown or other-kind template → `DS_LAYOUT_NOT_FOUND`** (the PRO-0 list of reused codes); another format → `DS_FORMAT_INVALID`.
4. **Gap filling.** When the model's options are valid but fewer than three, the server tops up from the ranking with a fixed reason (no figures) instead of a second model call.
5. **DS-9 tests touched.** `ci/api/tests/ds-9-ai.test.cjs` uses `chart_kind` as its "unbuilt action" example now that `suggest_layouts` is built; `ci/unit/ds-9-ai.test.cjs` expects the new chat reply.
6. No renderer change (`RENDER_HASH` unchanged), no migration, no contract change.

## Not done / open
- FE (ghost previews, side-by-side swap preview, one undo step) is the FE lane; the FE repo isn't here, so nothing was synced.

## Tests run (2026-10-21, branch `at-2-layouts-swap`)
- `npm run build` ok.
- Unit (`npm run test:unit`): 645 tests, 633 pass, 0 fail, 12 skipped (`ci/unit/ds-pro-at-2-layouts.test.cjs`: 8).
- API (`npm run test:api`, fresh DB): 791 tests, 784 pass, 0 fail, 7 skipped (`ds-pro-at-2-layouts-swap.test.cjs`: 9 — switch-off/role/401, tenant, kind-off, three options kept and fenced, retry → `DS_AI_OUTPUT_INVALID`, `DS_VALIDATION` targets, preview/apply incl. stale rev, stale hash and other-template hash, final immutable, Superadmin apply). Follow-up (2026-10-21): +1, "apply is one write" (a trigger refuses the `template_id` change; no new rev, draft and `template_id` unchanged). It failed on the old two-statement apply and passes now: the file is 10/10.
- DS golden (`npm run test:ds-golden`, fresh DB): 423 run, 423 matched, 0 failed, 2 skipped (Chromium not installed).
- DS probes (`audit/harness/ds-probes.cjs`, fresh DB): 362 pass / 0 fail / 0 error / 5 n/a; P01–P05 pass on both swap routes.
