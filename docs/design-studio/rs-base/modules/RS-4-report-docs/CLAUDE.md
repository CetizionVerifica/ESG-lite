# RS-4 · Report docs: readiness, new-report wizard, auto-build, autosave, studio home

> **Module spec**, lane L2. Copy to `ESG-lite/src/kpi/studio/docs/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/studio/home/CLAUDE.md`.
> **PR titles:** `[RS-4 k/m]`, four PRs:
> 1. tables, CRUD, autosave and versions;
> 2. readiness and auto-build;
> 3. FE home and wizard;
> 4. FE editor shell (read-only canvas).
>
> **Depends on:** RS-2, RS-3 · **Owns:** `report_doc`, `report_doc_version`, `src/kpi/studio/docs/*`, FE `studio/home`, `studio/wizard`, `studio/editor` shell (read-only)

## Job to be done
From a closed year, one click makes a complete, well-laid-out first draft. It is saved safely as people work, with snapshots to go back to.

## Build
### Backend
1. **Tables:** migration `migrate:rs-docs` creates `report_doc` and `report_doc_version` (`01-contracts` §3).
2. **CRUD and autosave:**
   - `GET/POST /docs`, `GET/PATCH/DELETE /docs/:id`.
   - PATCH validates with `ReportDocSchema`, checks `rev` (409 `RS_VERSION_CONFLICT` returns `{rev}`), and stores `draft` with `rev + 1`.
   - DELETE is a soft delete, for drafts only.
   - A heartbeat `POST /docs/:id/presence` (30 s) backs the "also open by another user" notice (R15). It is in-memory, best effort.
3. **Versions:** `POST /docs/:id/versions {note}` creates a `snapshot` version. `GET /docs/:id/versions` lists them. "Restore as draft" copies a version's doc into the draft (new rev, audit row).
4. **Readiness:** `GET /readiness?year=&sites=` combines:
   - `review/lock.ts` (whole-year lock row, not reopened);
   - `dashboard/coverage.ts` (per-framework %);
   - `values/yearly.ts` (missing kpi × sites × periods);
   - the pending count.
5. **Auto-build (`build.ts`)**, deterministic, no AI. Input: `{year, designId, frameworks, sites, chapters, inputs}`.
   1. Pick the chapter list: material topics and selected KPIs give topic chapters in E → S → G order, then Targets, Materiality (if scores exist), and the appendix flow sections.
   2. Per chapter, pick layouts. The opener goes first. Then data pages chosen by what data exists: hero chart for the headline KPI, tiles for the next 3, a target page if targets exist. A chapter with nothing approved gets one "No data this year" text page, flagged `VALUES_MISSING`.
   3. Fill placeholders: role bindings (`$headline:E:0` → a KPI code), chart kinds per binding shape (≥3 years → stacked or line; 1 year → share bar or tiles; scope split → share bar), and template text with tokens (e.g. heading "{{kpi:GHG_SCOPE1_2|current|change_pct}} change in Scope 1 and 2 emissions").
   4. Insert the cover (title, year, logo, hero KPI), contents, leadership (the user's text or a placeholder), about (from the company profile + KPI settings), highlights (the top 9 headlines across pillars), and the back cover.
   5. Set `source: 'layout'|'auto'` and `basedOnHash` on every element.

   If `ai: true`, RS-8 later replaces template text with suggestions. Until RS-8, the template text stays.
6. **Rebuild:** `POST /docs/:id/rebuild {pageIds?}` re-runs the build for those pages and keeps elements whose `source` is `user`, or which have been edited (`reviewed` or changed frames).

### Frontend (05-ux S1, S2, S3 shell)
1. **Home** (S1): the readiness card, the report list, and empty and not-locked states.
2. **Wizard** (S2): 4 steps, with live design thumbnails (`preview.html?mode=sheet&pageId=` from RS-5; until then, static thumbnails from RS-3), the chapter toggles, the inputs, and a build progress list (polling the build; it is synchronous in RS-4 and fast).
3. **Editor shell:** the top bar, the pages panel (thumbnails, reorder, hide, duplicate, delete, add from layout gallery), and the canvas showing sheets rendered by `render/renderSheet()` with no editing yet. Autosave is wired for page-level operations.

## Golden cases (`ci/golden/rs/build/`)
For the fixture company, `build` with Editorial produces this page list and these bindings (golden JSON):
- the chapters follow the material topics;
- a missing-data chapter page;
- highlights pick the top headlines;
- the build is deterministic, so the same input gives an identical doc.

## Tests
- **API:** roles (a User gets 403; a site-scoped Manager can't build `sites='all'`), tenant isolation, the rev conflict, schema errors, too-large, a final being immutable (once RS-5 creates finals), soft delete, restore.
- **Playwright:** create a report from the wizard, reorder pages, reload, and confirm the order is kept.

## Out of scope
Free placement (RS-6), text editing (RS-7), PDFs (RS-5), AI text (RS-8).

## Done when
A Manager sees readiness, creates a report in under 2 minutes, gets a complete deterministic first draft in the chosen design, and can reorder or add pages with autosave and snapshots.
