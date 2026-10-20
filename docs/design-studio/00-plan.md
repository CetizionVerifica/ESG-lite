# 00 · Design Studio plan

## 1. Goal and success test

A Superadmin turns on **Design Studio** for a client. The client's Managers and Admins then design and generate reports inside ESGLite, the way they would in Canva, but with numbers that come from approved data:
- **GHG inventory report** (needs only the studio switch): Scope 1, 2 and 3 from approved emission entries, laid out to the GHG Protocol reporting chapter.
- **Sustainability report** (needs the studio switch **and** KPI tracking): the annual report from approved KPI values (the RS scope).

**The plan is done (milestone DS-M5) when all of these hold:**
1. **Switch off by default.** With `company.design_studio_enabled` off (the default), nothing about the studio is visible or reachable: no nav item, no route, and every `/studio` endpoint answers `DS_STUDIO_OFF`. The existing GHG report (`/reports/ghg`), EDE and KPI exports are byte-identical.
2. **Start from a template in under 2 minutes.** On `/studio`, a Manager clicks **New design**, picks a report kind, a template (searchable gallery, live thumbnails with the client's brand and data), the year and sites, and gets a complete first draft:
   - GHG (about 15–25 A4 pages): cover, statement of compliance, executive summary, boundaries, methodology, Scope 1 by source and gas, Scope 2, Scope 3 by category, sites, base year and trend, data quality, reduction initiatives, assurance, annexes.
   - Sustainability (about 30–50 A4 pages): as RS-M4 §1.3.
3. **Design like Canva.** In the editor, a user can:
   - insert from side panels: Templates, Elements, Text, Brand, Uploads, Data, Charts, AI, Pages;
   - use the contextual toolbar for the selection (font, size, colour, effects, position, transparency, lock, link to data);
   - add, move, resize, rotate, crop, layer, align, tidy up, group, lock, duplicate and delete any element, with snapping, rulers, guides, undo and redo;
   - switch between scroll view, the page strip and grid view; reorder, name, hide and duplicate pages;
   - apply a Style (palette + font pair) to the whole report and shuffle styles.
4. **Numbers stay linked.** Every number in tiles, charts, tables and text chips comes through a binding: **approved** emission entries for GHG (DS-2 GHG source), **approved** KPI values for sustainability (KPI D14). When approved data changes, the draft updates on its next load and nearby typed text is flagged.
5. **Resize and convert.** From an A4 report, **Resize** makes a linked copy as a 16:9 board deck, an A4 one-page summary, or a 1:1 / 1.91:1 social card. The copy keeps the bindings and the brand.
6. **Preview equals PDF.** One renderer makes the editor sheets, the Page view, Present mode, PNG pages and the PDFs. Proof and final for the same version show no difference in page count, positions or text.
7. **AI suggests, people decide.** The AI panel can:
   - draft a report from a brief;
   - write and rewrite text in the company's brand voice;
   - suggest layouts and chart titles;
   - write alt text;
   - review the report for missing disclosures.

   Every result is a suggestion with Accept / Try again / Discard. Numbers appear only as data tokens.
8. **Checks gate the final.** A final is blocked while any `error` check is open: the RS layout and number checks, plus the GHG completeness checks in `01-contracts` §6 (for example a missing consolidation approach, an unaddressed Scope 3 category, biogenic CO₂ inside a scope total).
9. **Download and share.** PDF (screen), PDF (print: bleed and crop marks), PNG per page, and a read-only share link that expires. Finals are frozen versions with a data snapshot, the PDF in R2 and its SHA-256.
10. **Review.** Comments with @mentions and assigned tasks, a request-approval flow, and version history (restore any autosaved version).
11. **Release discipline.** Every new endpoint has tenant-isolation, role and switch-off tests. Every new table ships as an idempotent `migrate:ds-*` script.

## 2. Non-negotiables

1. **Same people, same access.** No new role.
   - Admins and Managers create and edit. Only a Manager or Superadmin generates a final or approves (as KPI D11).
   - Users (contributors) don't see the studio, except as @mentioned commenters if D13 is changed.
   - Site scope follows `accessibleSiteIds`. A company-wide report needs access to all sites.
2. **Switches decide.**
   - `company.design_studio_enabled` (default `false`, Superadmin only) gates everything (`requireDesignStudio`).
   - The `sustainability` kind also needs `requireKpiTracking`. The `ghg` kind does not.
   - Both checks run in the backend and the frontend. Turning a switch off hides the studio and keeps the data.
3. **Numbers come from bindings, never from typing.**
   - Tiles, charts, tables and text chips resolve through DS-2 from **approved** data only.
   - Derived figures (change, share, progress, intensity, per-site sums) are computed in DS-2.
   - Typed digits are allowed but checked (DS-12).
   - A "custom data" chart (typed table, Canva-style) is allowed only for non-reported figures. It carries an "Unlinked data" badge and an info check.
4. **One renderer.**
   - `src/reporting/studio/render/` (DS-1) turns a ReportDoc into HTML for every surface: editor, Page view, Present, PNG, PDFs.
   - The FE uses a byte-identical mirror, checked by hash in CI.
   - No second PDF engine and no canvas-drawn text.
5. **AI suggests, never decides.**
   - Output is our JSON (zod), never HTML. It lands only after Accept.
   - Accepted AI text stays marked `source: 'ai'` until edited or ticked reviewed.
   - Every call is logged (`report_ai_call`) and budgeted (D10).
6. **Finals are immutable.** They are never re-rendered from live data or edited. Corrections make a new version with a note.
7. **Contracts first.** Enums, the ReportDoc schema, error codes and check ids live only in `ESG-lite/src/studio/contracts/` and its mirror `ESG-lite_FE/src/lib/studio/contracts.ts`.
8. **Backfill, never break.**
   - New tables and columns ship as idempotent `migrate:ds-*` scripts; CI runs them twice and the schema-diff stays clean.
   - These are read-only to the studio: `src/reporting/ghg*.ts`, `blocks.ts`, `render.ts`, `print.ts`, `ghg-data.ts`, `ghg-scope3.ts`, `src/scope3/baseYear/*`, the EDE controller and the KPI-11 exports. DS-2 calls their exported functions and changes none of them.
9. **No Canva dependency.** We build our own editor (D2). No Canva SDK, API, template, font or graphic is copied or used. "Canva-like" means interaction patterns, never Canva's assets, names or look.
10. **Redesign rules in the FE.**
    - App chrome uses `src/ui`, the theme tokens and the four app themes, with loading, empty and error states and keyboard support.
    - Report content inside a sheet uses only the renderer and the report's theme.
    - The editor needs ≥1280 px; below that the studio is view and comment only.
    - `05-ux.md` is binding.
11. **Standards text.** Index and compliance pages show framework codes, our own titles and links, never copied standard text (KPI D7).

## 3. Where the work lands

| Repo | New code | Changed code |
|---|---|---|
| ESG-lite | `src/studio/` (contracts, router, docs, sources/{kpi,ghg,inputs}, brandkit, library, jobs, ai, checks, collab, share), `src/reporting/studio/` (renderer, charts, fonts, measure, formats), `src/entities/Studio*.ts`, `src/queues/studioRender*.ts`, `src/scripts/migrateDs*.ts`, `data/studio/` (templates, layouts, elements, icons, fonts), `ci/api/tests/ds-*.test.cjs`, `ci/unit/ds-*.test.cjs`, `ci/golden/ds/` | `src/index.ts` (one `app.use('/studio', …)`), `Company.ts` (+switch), `Brand.ts` (+fonts, voice), `CompanyMaterialTopic` (+scores, from RS-2), `company.controller.ts` (switch update), `notificationService` (report ready, mention, approval), `package.json` scripts, `ci/workflow` steps, `src/config/rabbitmq.ts` (one queue) |
| ESG-lite_FE | `src/features/studio/` (home, new, editor, panels, toolbar, pages, preview, present, share, review, versions), `src/lib/studio/` (contracts, render mirror, history, snapping, geometry, docOps, resize), `src/test/msw/studio.ts`, `e2e/ds-*.spec.ts` | `shell/nav.ts` + `commands.ts` + `routeMap.ts` (switch-aware "Design Studio" item), `clients/DetailPage.tsx` (+`DesignStudioToggle`), `ghg-report/Page.tsx` (+"Design this report" button), `brand-themes` (→ Brand kit tab), `kpi/setup` (optional materiality scores, from RS-2) |
| python_AI_service | none | none |

## 4. RS → DS map

| RS module | Becomes | What changes |
|---|---|---|
| RS-0 | DS-0 | Mount `/studio` (not `/kpi/studio`), switch `design_studio_enabled`, `ReportKind`, `DS_` codes, folders `src/studio` and `src/features/studio` |
| RS-1 | DS-1 | + page formats (A4, A4 landscape, 16:9, A5, Letter, square, social), bleed and crop marks, frame/grid/line elements, PNG page render |
| RS-2 | DS-2 | + GHG data source and report inputs; bindings become `source`-tagged |
| RS-3 | DS-3 + DS-4 | Brand fonts and voice → DS-3. Designs and layouts → DS-4 template library, plus GHG templates and the elements library |
| RS-4 | DS-5 | Kind-aware new-report flow and readiness (GHG: approvals and coverage; sustainability: lock and coverage) |
| RS-5 | DS-11 | + PNG, print PDF, Present mode, share link |
| RS-6 | DS-6 | Canva chrome replaces the insert bar + inspector: side rail and drawers, contextual toolbar, page strip, grid view, rulers and guides, Position panel |
| RS-7 | DS-7 | Kept; chips cover both data sources; + text presets and footnotes |
| — | DS-8 | New: chart and table editing (split out of RS-6 and RS-1) |
| RS-8 | DS-9 | + chat panel, design from a brief, brand voice; GHG prompts |
| — | DS-10 | New: Resize and convert |
| RS-9 | DS-12 | + GHG completeness checks; kind-aware final gate |
| RS-10 | DS-13 | + @mentions, tasks, request approval, version history list, brand controls |
| RS-11 | DS-14 | + GHG goldens |

## 5. Modules, dependencies and file ownership

| Id | Depends on | Owns | Touches |
|---|---|---|---|
| DS-0 | — | `src/studio/contracts/*`, `src/studio/router.ts`, `requireDesignStudio`, `company.design_studio_enabled`, `docs/design-studio/*`, FE `src/lib/studio/contracts.ts`, `switch.ts`, `src/test/msw/studio.ts`, empty `src/features/studio/routes.tsx`, `DesignStudioToggle` | `src/index.ts`, `Company.ts`, `company.controller.ts`, root CLAUDE.md files, `shell/nav.ts`, `commands.ts`, `routeMap.ts`, `clients/DetailPage.tsx` |
| DS-1 | DS-0 | `src/reporting/studio/render/*` (sheet, flow, elements, charts, theme, fonts, measure, formats), `scripts/sync-studio-render.mjs`, FE `src/lib/studio/render/*` (mirror) | — |
| DS-2 | DS-0 | `src/studio/sources/*` (kpi, ghg, inputs, derived, hash), `POST /studio/resolve`, `report_inputs` on `report_doc`, scores on `company_material_topic` | reads `src/reporting/ghg-data.ts`, `ghg-scope3.ts`, `src/scope3/baseYear/*`, EDE intensity, `src/kpi/values/*`, `targets/progress.ts`, `esg/headlines.ts`, `reports/model.ts` (no edits) |
| DS-3 | DS-0 | `brand_palette`, `src/studio/brandkit/*`, `GET/PUT /studio/brand-kit`, FE `studio/panels/BrandPanel`, `StylesPanel`, brand-kit tab | `Brand.ts` (+font_heading, font_body, voice), FE `brand-themes` (link to the kit) |
| DS-4 | DS-1, DS-3 | `report_template`, `report_layout`, `report_element`, `report_asset`, `src/studio/library/*`, `data/studio/*` seeds, icons and fonts, FE `TemplatesPanel`, `ElementsPanel`, `UploadsPanel` | — |
| DS-5 | DS-2, DS-4 | `report_doc`, `report_doc_version`, `src/studio/docs/*` (CRUD, autosave, readiness, auto-build), FE `studio/home`, `studio/new`, editor shell (read-only canvas) | FE `ghg-report/Page.tsx` (one button) |
| DS-6 | DS-0 (mocks), DS-1, DS-5 | FE `studio/editor/*` (canvas, selection, transforms, snapping, rulers, guides, toolbar, side rail, page strip, grid view, Position panel, shortcuts), `src/lib/studio/history.ts`, `snapping.ts`, `geometry.ts`, `docOps.ts` | — |
| DS-7 | DS-2, DS-6 | FE `studio/editor/text/*` (TipTap, `DataChip`, picker, presets, footnotes), flow-section settings, overflow measuring | — |
| DS-8 | DS-1, DS-2, DS-6 | FE `studio/editor/charts/*`, `tables/*`, `DataPanel`, `ChartsPanel`; renderer chart kinds for GHG (`render/charts/ghg/*`) | `render/charts/*` (with DS-1 owner) |
| DS-9 | DS-2, DS-5, DS-7 | `report_ai_call`, `src/studio/ai/*`, FE `studio/ai/*` (AiPanel chat, SuggestionCard, DiffView, GhostPreview, budget meter) | moves the OpenRouter client out of `src/reporting/ai-narrative.ts` into `src/lib/openrouter.ts` (same behaviour) |
| DS-10 | DS-1, DS-5, DS-6 | `src/studio/resize/*`, `POST /studio/docs/:id/resize`, FE `studio/resize/*`, `src/lib/studio/resize.ts` | — |
| DS-11 | DS-1, DS-5 | `report_job`, `report_share`, `src/studio/jobs/*`, `src/studio/share/*`, `src/queues/studioRender*.ts`, public share viewer route, FE `studio/preview`, `present`, `download`, `share` | `notificationService` (report ready), `src/config/rabbitmq.ts` (one queue) |
| DS-12 | DS-2, DS-7, DS-11 | `src/studio/checks/*` (layout, number, ghg, sustainability), shared `render/checks/number.ts`, FE `studio/checks/*` | — |
| DS-13 | DS-5, DS-6, DS-12 | `report_comment`, `report_task`, `report_approval`, `company.report_require_review`, `src/studio/collab/*`, FE `studio/review/*`, version history list, template locks, brand controls | `notificationService` (mention, task, approval) |
| DS-14 | DS-0 (draft), all (final) | `ci/golden/ds/*`, `ci/workflow` DS steps, `audit/harness/ds-probes.cjs`, `e2e/ds-*.spec.ts` | — |

## 6. Waves and milestones

| Wave | Modules | Needs merged |
|---|---|---|
| 0 | DS-0 | — |
| 1 | DS-1, DS-2, DS-3, DS-14 draft, DS-6 FE on mocks | DS-0 |
| 2 | DS-4, DS-5, DS-6 wired | DS-1, DS-2, DS-3 |
| 3 | DS-7, DS-8, DS-11 | DS-5, DS-6 |
| 4 | DS-9, DS-10, DS-12 | DS-7, DS-8, DS-11 |
| 5 | DS-13, DS-14 final | DS-12 |

**Milestones** (each is releasable behind the switch):
- **DS-M1 · GHG report, designed** (DS-0…5, 11 read-only editor): pick a GHG template, get a branded draft from approved emissions, Page view, proof PDF. No editing yet. This already beats today's GHG PDF.
- **DS-M2 · Canva editing** (+DS-6, 7, 8): full free-form editing, text with data chips, charts and tables.
- **DS-M3 · Sustainability report** (DS-2 KPI source, DS-4 sustainability templates): the RS-M4 report inside the same studio.
- **DS-M4 · AI, resize, checks, finals** (+DS-9, 10, 12): AI panel, board deck and summary, the GHG completeness gate, frozen finals.
- **DS-M5 · Team** (+DS-13, DS-14 final): comments, mentions, tasks, approvals, version history, share link. This is the §1 success test.

## 7. Definition of done (every module)

1. Its spec's "Done when" holds, and the module spec copy has an "As built" section listing files, deviations and decisions.
2. **Backend:**
   - tenant-isolation, role and switch-off tests (`DS_STUDIO_OFF`, and `KPI_TRACKING_OFF` for the sustainability kind) for every new endpoint;
   - migrations run twice and the schema-diff is clean;
   - build, unit, goldens unchanged, API and workflow tests all green.
3. **Renderer:** HTML snapshot goldens updated deliberately; the FE mirror hash matches (`npm run check:studio-render` in both repos).
4. **FE:**
   - the redesign definition of done (four app themes, states, keyboard);
   - `05-ux.md` copy rules;
   - unit tests for logic (history, snapping, geometry, resize, tokens);
   - a Playwright check of the main path and of the switch-off path.
5. The last PR body has "Workflow test: N passed, M skipped" and `Completes: DS-<n>`.

## 8. Working rules for parallel lanes

- Branch from `production`. Open the first PR as a draft at once; the draft is the claim.
- **Shared files** are append-only blocks with a `// DS-n` comment:
  - `src/index.ts` (one mount, DS-0);
  - `src/studio/router.ts` (one `router.use` per module);
  - `Company.ts`, `Brand.ts`;
  - `package.json` `migrate:ds-*` lines;
  - `src/features/studio/routes.tsx`;
  - `shell/nav.ts`.
- **The renderer mirror:** only change `src/reporting/studio/render/` in ESG-lite, then run `npm run sync:studio-render` in ESG-lite_FE. Both PRs carry the same `RENDER_HASH`.
- **Backend before FE.** While waiting, build against `01-contracts.md` with MSW mocks (`src/test/msw/studio.ts`).
- **Contract changes** go in a DS-0 follow-up PR first.

## 9. Risks

| Risk | Mitigation |
|---|---|
| "Canva-like" grows without end (video, whiteboards, stock libraries, live co-editing) | Out of scope list in `04-decisions` D3. Each Canva feature is mapped in `research.md` §2 as Adopt / Adapt / Skip. |
| Editor and PDF drift apart | One renderer, one self-hosted font set, pinned Chromium, a proof-vs-final golden (DS-14). |
| GHG numbers in the designer differ from the GHG report screen | DS-2 calls the same `computeGhgTables` / `computeScope3` functions as `/reports/ghg`. A golden compares DS-2 totals with `GET /user/ghg/tables` for the seed companies. |
| Market-based Scope 2 isn't recorded today (`src/kpi/auto/ghg.ts:88`) | The GHG template shows "Not reported" with a reason, and `SCOPE2_MARKET_MISSING` is a warning (D7). Capturing it is a separate plan. |
| Disclosures that aren't in the data (responsible person, recalculation policy, exclusions, uncertainty, verification) | Report inputs (DS-2): a short form in the new-report flow and the Data panel, prefilled where data exists. Checks name what is missing. |
| Free-form text overflows and gets clipped | Live measuring (DS-7) plus `TEXT_OVERFLOW`, measured again in Playwright before a final (DS-12). |
| AI states wrong numbers | Numbers only as tokens; derived figures computed in code; the number check blocks the final. |
| AI cost | Budgets per doc and per company (D10); a cheap model for rewrites. |
| Resized copies drift from the source | A resized design is a new doc with its own pages, sharing bindings. A "Source changed" note appears when the source's data hash moves (DS-10). |
| Share links leak data | Links are read-only, expire (default 14 days, max 90), can be revoked, are audit-logged, and show only a stored proof or final PDF, never live data (D15). |
| Element and icon licensing | Only MIT/ISC/OFL icon and font sets, plus our own drawn ESG graphics. The licence of each asset is listed in `data/studio/LICENSES.md` (DS-4). |
