# DS-5 · Reports: home, new-design flow, readiness, auto-build, autosave

> **Module spec**, lane L2, wave 2. Copy to `ESG-lite/src/studio/docs/CLAUDE.md`.
> **PR titles:** `[DS-5 k/m]`, five PRs:
> 1. report_doc v2 + CRUD + autosave + duplicate;
> 2. readiness per kind;
> 3. auto-build from a template;
> 4. FE home + new-design flow;
> 5. FE editor shell (read-only canvas) + "Design this report" on the GHG page.
>
> **Depends on:** DS-2, DS-4 · **Owns:** `report_doc`, `report_doc_version` (rows), `src/studio/docs/*`, FE `studio/home`, `studio/new`, editor shell
> **Base:** RS-4. Changes: kinds, formats, template-based build, GHG readiness.

## Build
1. `migrate:ds-5-docs` creates `report_doc` and `report_doc_version` with the DS columns (`01-contracts` §3).
2. **Readiness:**
   - **GHG:**
     - approved and pending entry counts in the period (the same status values `/user/ghg/tables` uses);
     - sites with no approved rows;
     - months missing per monthly site;
     - Scope 3 categories addressed n/15 (reported, or excluded in screening or in inputs);
     - each gap with a deep link (Review, My entries, Scope 3 screening).
   - **Sustainability:** RS readiness.
3. **Auto-build** (`POST /docs`):
   - load the template at its current version;
   - resolve every binding;
   - drop pages whose required data is empty unless the template marks them `keepEmpty` (e.g. the Scope 3 page shows "Scope 3 not yet reported" with a link);
   - fill input placeholders;
   - run AI drafting when `ai: true` (DS-9 hook; until DS-9 lands, templates carry default text);
   - store rev 1 and an autosave version.

   Under 2 minutes for a 25-page GHG doc with AI on; the progress steps are streamed through polling `GET /docs/:id?build=1`.
4. **Autosave:** PATCH with `rev`, debounced; `RS_VERSION_CONFLICT` becomes `DS_VERSION_CONFLICT`; presence heartbeat (RS R15).
5. **FE home** (`05-ux` S1) and **new-design flow** (S2): template gallery with live thumbnails (`preview.html?mode=sheet` once DS-11 lands; static thumbnails before then), scope, report details (DS-2 form), words, build progress.
6. **Editor shell:** top bar, rail (drawers stubbed), the read-only canvas from the renderer mirror, status bar. DS-6 makes it editable.
7. **GHG report page:** a **Design this report** button, shown when the studio is on, carries `year`, `yearType`, `compareYear` and `siteIds` into `/studio/new?kind=ghg`.

## Tests
- **API:** CRUD tenant, role and switch tests; `DS_KIND_OFF` for a sustainability doc after KPI tracking is turned off; build of each seed template; rev conflict.
- **Playwright:** GHG report page → Design this report → pick Inventory → build → the editor shows 20+ pages with numbers matching the GHG page.

## Done when
A Manager goes from the GHG report page to a built, branded, data-filled design in under 2 minutes, and it autosaves.

## As built (2026-10-20, branch `ds-5-reports` in ESG-lite and ESG-lite_FE, local only)

### Files
**ESG-lite**
- Tables: `src/entities/StudioReportDoc.ts` (`report_doc`: RS columns + `kind`, `purpose`, `format`, `inputs`, `source_doc_id`, and `template_id`, `data_hash`, `build`), `src/entities/StudioReportDocVersion.ts` (`report_doc_version`: all RS columns incl. the PDF fields DS-11 fills, + `rev`; `kind` allows `autosave`), registered in `src/config/data-source.ts` (`// DS-5`); `src/scripts/migrateDs5Docs.ts` + `migrate:ds-5-docs` (TypeORM's own SQL, IF NOT EXISTS; schema-diff clean; also adds the DS-5-only columns to a `report_doc` an earlier test made the §3 way).
- Contracts: `src/studio/contracts/docs.ts` (request schemas, `DocSummary`, `DocResponse`, `BuildProgress`, `GhgReadiness`, `SustainabilityReadiness`, `ReadinessGap`, the template build contract: `TemplatePageHintSchema`, `PLACEHOLDER_PATTERN`, `BLANK_TEMPLATE`), exported from `contracts/index.ts` (`// DS-5`).
- `src/studio/docs/`: `store.ts` (rows, tenant/kind/site-checked loads, list, optimistic `updateDraft`, soft delete, versions, autosave timing and pruning, presence), `readiness.ts`, `template.ts` (reads DS-4's `report_template` raw), `build.ts` (pure build steps), `service.ts` (create/build, get, patch, delete, rebuild, duplicate), `aiHook.ts` (DS-9 registers its drafter), `router.ts`; one `router.use` in `src/studio/router.ts` (`// DS-5`).
- Tests: `ci/unit/ds-5-docs.test.cjs` (17), `ci/api/tests/ds-5-docs.test.cjs` (10), fixture template `ci/fixtures/studio/ds-5-template-ghg.json`. `audit/harness/ds-probes.cjs`: a DS-5 `SEED` step (a blank company-1 design) and DS-P10 reads `report_doc.draft` (the probe assumed a `doc` column).

**ESG-lite_FE**
- `src/lib/studio/contracts.ts` (DS-5 blocks: readiness, designs, build progress, create/patch bodies; the DS-0 mock shapes replaced), `src/test/msw/studio.ts` (readiness, list, background build polled with `?build=1`, blank designs, rename by title; `setStudioMockBuildPolls`).
- `src/lib/studio/autosave.ts` (+test), `docData.ts` (+test: bindings/chips in resolve order, RenderData, brand from the kit, `periodLabel`), `designLink.ts`.
- `src/features/studio/docs/api.ts` (calls + TanStack hooks), `home/` (`HomePage.tsx`, `logic.ts`, tests), `new/` (`NewDesignPage.tsx`, `logic.ts`, tests), `shell/` (`EditorShellPage.tsx`, `ReadOnlyCanvas.tsx`, `useDocSession.ts`, test); `routes.tsx` (home, new, editor lines `// DS-5`).
- `src/features/ghg-report/Page.tsx`: one secondary action "Design this report" (`// DS-5`), shown when `useDesignStudio().kinds.ghg`.
- `e2e/ds-5-reports.spec.ts` (GHG report → Design this report → Inventory → build → 22 pages with the GHG page's figures; switch off hides the button); `e2e/ds-0-switch.spec.ts` reads the DS-5 home cards.

### Endpoints (behind `requireDesignStudio`; role R)
| Route | Notes |
|---|---|
| `GET /studio/readiness?kind=&year=&yearType=&sites=` | GHG: counts (approved/pending/rejected, Scope 1–3 categories), sites covered and missing, months covered / expected and missing per monthly site, Scope 3 `n/15` with reported/excluded/unaddressed, `state`, `gaps[{kind, severity, message, link, linkLabel, …}]`. Sustainability: the RS readiness (`locked`, `lockedAt`, `coverage[{framework, pct}]`, `missing[{kpi, name, sites, periods}]`, `pendingCount`) + `setupDone`, `state`, `gaps`. |
| `GET /studio/docs?kind=&year=` | `DocSummary[]` (readable sites only; sustainability hidden while KPI tracking is off, `?kind=sustainability` → `DS_KIND_OFF`). |
| `POST /studio/docs[?wait=0]` | `{kind, templateId: number \| "blank", year, yearType, sites, frameworks, compareYear?, title?, format? (blank), inputs (an inputs patch), ai}` → 201 `DocResponse`; `wait=0` → 202 `{id, rev, status, title, build}` and the build runs in the background. |
| `GET /studio/docs/:id[?build=1]` | `DocResponse` (`{id, doc, rev, status, title, dataHash, updatedAt, build}`); `build=1` → the progress only. |
| `PATCH /studio/docs/:id` | `{rev, doc?, title?}`; 409 `DS_VERSION_CONFLICT {rev}`, 422 `DS_DOC_INVALID`, 413 `DS_DOC_TOO_LARGE`, 409 `DS_FINAL_IMMUTABLE`; a kind or format change is refused. |
| `DELETE /studio/docs/:id` | soft delete (audit row `report_doc`/`delete`); never with a final. |
| `POST /studio/docs/:id/rebuild` | `{pageIds?, keepUserEdits: true}` → `DocResponse` + `rebuilt[]`. |
| `POST /studio/docs/:id/presence` | `{others}` (45 s window, in memory, per process). |
| `POST /studio/docs/:id/duplicate` | `{title?}` → 201 `{id}` (pages, inputs, template; not linked). |

### Decisions and deviations
1. **Template contract (DS-4 builds in parallel).** DS-5 reads `report_template` with raw SQL by the §3 columns (`id, company_id, kind, purpose, format, name, version, theme, doc, is_active`): a system template or the caller's company's, active only; another company's or an unknown id → 404 `DS_LAYOUT_NOT_FOUND`; until the table exists every template is 404. `templateId` in the doc is `String(report_template.id)`. Build hints live in the template doc: per page `requires: 'data'|'none'`, `keepEmpty`, `emptyText` (on the page object or in a top-level `build.pages[pageId]` map); DS-5 strips them before validating. Placeholders in text, labels, chart titles, table cells, page names and meta: `{{company.name}} {{meta.title|year|period|periodShort|compareYear|sites|frameworks}} {{input:<key>}}`; an empty input becomes "[Label: add it in Report details]". **The integrator/DS-4 must keep these names** (or change `template.ts`/`build.ts`).
2. **Empty data page rule.** A page with GHG/KPI bindings or chips is dropped when every one of them is unavailable or has no value; GHG figures of exactly 0 count as empty (computeGhgTables sums no rows to 0); a KPI 0 is data. Input-only and text pages are never dropped. A kept empty page writes `emptyText` into its text elements whose id ends `.empty`. If every page drops, the doc gets one blank page.
3. **Build is in-process.** `POST /docs` waits by default (201); the FE uses `?wait=0` (202) and polls `GET /docs/:id?build=1` every 500 ms. Steps and their notes are saved to `report_doc.build`. A failed synchronous build deletes its row; a failed background build keeps it with `build.state = 'failed'` (the list shows "Build failed"). No queue: a server restart mid-build leaves `running` (not swept).
4. **Resolution in the build** uses DS-2 `resolveAll` on the doc's own scope (inputs read from the new row); a binding DS-2 rejects as `DS_BINDING_INVALID` (e.g. a KPI the company didn't select) makes only its page count as empty instead of failing the build. Every bound element gets `basedOnHash` = the build's data hash; `report_doc.data_hash` stores it.
5. **AI step:** `ai: true` calls the hook DS-9 registers (`registerAiDraftHook`); until then the step is `skipped` with the note "AI drafting isn't available yet; the template's text is kept." A failing hook leaves the template text (`failed` step, build still done).
6. **Versions:** rev 1 gets an `autosave` version at build; PATCH and rebuild add one when the newest autosave is ≥ 10 minutes old (D16), then prune autosaves older than 90 days outside the newest 200. Version list/restore endpoints are DS-11/DS-13's (not built here). The autosave version stores the doc's last `data_hash` (not re-resolved on every PATCH, for speed).
7. **Finals:** `status = 'final'` refuses PATCH, rebuild and DELETE (`DS_FINAL_IMMUTABLE`), as the DS-0 mock did; DELETE also refuses a doc with any final version. DS-11/13 decide how a corrected draft follows a final.
8. **Sites:** `'all'` needs all-site access (`DS_SITES_SCOPE` on create); a doc whose sites the caller can't all read answers 404 on every route and is left out of the list.
9. **Order of checks:** company/kind/site of an existing doc before the body (ds-probes DS-P03: another company's id with an empty body → 404); on `POST /docs` a `kind: 'sustainability'` with KPI tracking off answers `DS_KIND_OFF` before validation (DS-P06).
10. **Readiness:** "monthly site" = a site with monthly rows (any status) in the period; yearly-only sites have no months to miss; months not yet started aren't expected; a site with no approved row is reported once (as a site, not twelve months). Scope 3 "reported" = approved tCO₂e > 0 in the category (computeScope3); "excluded" = screening status `excluded`/`not_relevant`. Sustainability readiness uses the company's KPI year type (as KPI reports do); before KPI setup it answers `setupDone: false` with one gap.
11. **FE:** the editor shell lives in `features/studio/shell/` (not `editor/`, which DS-6 owns) and `routes.tsx` points `studio-editor` at it until DS-6 swaps its editor in; `useDocSession` (doc, rev, autosave, presence, conflict reload) is meant for DS-6 to build on. The shell follows DS-2's inputs PATCH (it bumps the same rev) via `adoptRev`. Thumbnails are static format-shaped tiles (`thumbnailUrl` stays null until DS-11). The scope step's site list comes from the session (Managers' sites); Admins and Superadmins get "All sites" (or the GHG page's `siteIds`).
12. **Copy:** the shell's stubbed drawers say "Coming soon in the editor."; disabled top-bar buttons say "<name>: coming soon" on hover.

### Tests run
- `test-lane.sh ds-5-be`: build ok, unit ok, scope3-golden 32/32, calculation snapshot matches, API 700 pass / 0 fail (ds-5: 10), workflow: main suite 55 pass / 0 fail / 9 skipped (DS-W10 probes 0 findings); see the PR note for the categories suite.
- `test-lane.sh ds-5-fe`: typecheck ok, lint:new ok, vitest 1749 pass (181 files). Playwright: `ds-5-reports` 2/2, `ds-0-switch` 5/5, `ghg-report` + `ds-3-brand-kit` 14/14.

### Not done
- Seed templates are DS-4's: "build of each seed template" is tested with the fixture template only; once DS-4's seeds land, add a loop over `report_template` rows to `ci/api/tests/ds-5-docs.test.cjs` (each must build and validate).
- Sustainability builds don't resolve RS role bindings (`$headline:E:0`) or pick chapters from material topics (RS-4 step 1–4): a sustainability template builds as written. Needs the DS-4 sustainability template format first.
- Live template thumbnails (`preview.html?mode=sheet`, DS-11) and cover image upload/generate in the Words step (DS-4 Uploads / DS-9).
- The shell has no page operations (reorder, hide, duplicate, delete): DS-6's Pages drawer and page strip. Version history endpoints (DS-11/13). Presence is per process (no shared store).
- A Playwright run against the real backend (the e2e mocks the API, as every FE spec does).
