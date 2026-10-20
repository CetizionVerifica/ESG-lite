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
