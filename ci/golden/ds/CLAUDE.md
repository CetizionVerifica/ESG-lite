# DS-14 · Golden cases, workflow test, probes

> **Module spec**, lane L5, continuous (draft in wave 1, final in wave 5). Copy to `ESG-lite/ci/golden/ds/CLAUDE.md`.
> **Depends on:** DS-0 (draft), all (final) · **Owns:** `ci/golden/ds/*`, `ci/workflow` DS steps, `audit/harness/ds-probes.cjs`, `e2e/ds-*.spec.ts` main path
> **Base:** RS-11. Kept. Changes are below.

## Build
1. **Seed docs:**
   - for the 3 seed companies: a GHG Inventory (Classic), a GHG Board brief (resized from it) and a One-page summary;
   - for the KPI seed company: a sustainability Editorial report.
2. **Goldens:**
   - **Renderer snapshots:** per element, per format, per mode.
   - **Data parity:** DS-2 GHG totals = `/user/ghg/tables`, CY and FY; EDE unchanged after the intensity extraction.
   - **Checks lists:** per seed doc.
   - **PDF:** proof vs final text positions; print bleed box.
   - **AI:** recorded responses validate.
3. **Workflow test** (`ci/workflow`):
   - switch on;
   - GHG page → Design this report → build;
   - edit (move a chart, add a chip);
   - resize to a deck;
   - checks;
   - approve;
   - final;
   - share link;
   - switch off → everything hidden and `/studio/*` answers 403.
4. **Probes** (`audit/harness/ds-probes.cjs`): a cross-tenant id on every endpoint; a share token brute-force rate limit; a 2 MB doc cap; a script tag in text, alt text or a brand voice is rendered inert.

## Done when
The workflow test passes on a clean DB, and every golden is green on `production` after DS-13.

## As built (draft, wave 1: 2026-10-20, branch `ds-14-verify-draft` on `ds/local`)

The draft sets up the structure, the runners and every check that DS-0 alone can answer. Later
waves switch cases from skip to run; DS-14 final fills the rest.

### Files
- `ci/golden/ds/cases.json`: every golden this spec names, by group (`contracts`, `status`, `seed`,
  `render`, `parity`, `checks`, `pdf`, `ai`). A case is `"run": true` (compared with
  `ci/golden/ds/<id>.json`) or skipped with `"waits": "DS-n"`. A `matrix` case expands to one case
  per combination; list names come from the compiled contracts (`render/element` is
  `ELEMENT_TYPES` × `PAGE_FORMATS` × sheet/paged/present = 378 cases; `ai/recorded` is one per
  `AI_ACTIONS`).
- `ci/golden/ds/run.cjs` (`npm run test:ds-golden`): runs the run cases, prints
  `DS golden: N run, M matched, F failed, K skipped (waits ...)`. `UPDATE_SNAPSHOT=1` rewrites the
  expected files; `DS_GOLDEN_ONLY=<groups>`; `DS_GOLDEN_OFFLINE=1` runs only `"needs": "build"`
  groups (no database). A mismatch writes the actual file to `.golden-actual/ds/` (git-ignored).
  Groups with `"needs": "api"` get a throwaway stack: `lib/stack.cjs` (schema from dist/, the API
  fixture `ci/api/fixture.sql`, every `migrate:ds-*`, the compiled server on `DS_GOLDEN_PORT`,
  default 3993).
- `ci/golden/ds/groups/<group>.cjs`: one handler per group, `async (ctx, case) → value`
  (`ctx = {root, q, call}`). Built: `contracts.cjs` (fixture docs parse; bytes and the 2 MB cap;
  page and element outline; `collectBindings`; `checksFor(kind)`; an RS v1 doc through
  `upgradeV1`) and `status.cjs` (`GET /studio/status` and the guard's answer per role in all four
  studio × KPI states).
- `ci/golden/ds/lib/routes.cjs`: the 01-contracts §4 route list with the module of each route,
  the compiled-router walker, `gatedRoutes`, `concrete`, `shape` (parameter-name agnostic). Used by
  the probes and the workflow steps; kept equal to `ci/api/tests/ds-lib.cjs` by a unit test.
- `audit/harness/ds-probes.cjs`: DS-P01 switch off, P02 company 2 naming company 1, P03
  cross-tenant ids (`ID_SOURCES` per resource; `SEED` steps make company-1 rows), P04 roles (Users
  `DS_ROLE`, Manager-only routes refuse Admins), P05 Superadmin `company_id`, P06 kind guard
  (`DS_KIND_OFF`), P07 nothing routed is unprobed, P08 `migrate:ds-*` twice, P09 share-token
  rate limit, P10 2 MB doc cap, P11 script tags inert. On DS-0: 187 pass, 0 fail, 41 n/a.
- `ci/workflow/workflow.test.cjs` (block marked `DS-14`): DS-W0 baseline, DS-W1 switch on, DS-W2–W8
  pending steps (build, edit, resize, checks, approve, final, share), DS-W9 switch off (every gated
  route for Admin, Manager and User; emission reports byte-identical), DS-W10 probes and DS-W11
  goldens in scratch databases. `ci/workflow/README.md` has the row.
- `ci/unit/ds-14-verification.test.cjs`: route lists in step, no unlisted compiled route,
  `cases.json` well formed, offline goldens match.
- `package.json`: `test:ds-golden`. `.gitignore`: `.golden-actual/`.

### For the module that lands a group
1. Write `groups/<group>.cjs` (or extend it), set its cases to `"run": true`, run
   `UPDATE_SNAPSHOT=1 DS_GOLDEN_ONLY=<group> node ci/golden/ds/run.cjs` on a ci_* database, read
   every expected file, commit them.
2. A new table: add its `ID_SOURCES` line in `ds-probes.cjs`, and a `SEED` step if no company-1
   row exists on the API fixture. A new route outside 01-contracts §4: add it to
   `lib/routes.cjs` and `ci/api/tests/ds-lib.cjs` (the unit test and DS-P07 fail otherwise).
3. Workflow DS-W2–W8: once a route exists its step skips with "DS-n is routed; DS-14 final writes
   this step's checks"; the module (or DS-14 final) replaces `dsLater(...)` with real checks.

### Deviations
- **Fixture:** the API-backed goldens and the probes use the API fixture (companies 1 and 2), not
  "the 3 seed companies": no seed-company set exists yet. DS-4/DS-5 decide the seed set
  (`ci/golden/ds/fixture/`), and the `seed`, `parity` and `checks` handlers use it.
- **Ports:** DS-W10 and DS-W11 use `API_TEST_PORT` and `GOLDEN_PORT` when set (free during the
  workflow in `test-lane.sh`), so parallel lanes don't collide on a fixed port.
- **Pending workflow steps skip** rather than fail once their route exists, so parallel lanes
  merging into `ds/local` stay green before DS-14 final.

### Not done (draft)
- Every `seed`, `render`, `parity`, `checks`, `pdf` and `ai` case (skipped, waiting on DS-1, 2, 4,
  5, 9, 10, 11, 12).
- Workflow DS-W2–W8 checks; probes DS-P03 per id, P06, P09, P10, P11 (n/a until their modules land;
  P11 needs the DS-1 render call and the DS-3 brand voice written).
- FE `e2e/ds-*.spec.ts` main path (Playwright): no FE part in this draft; DS-0's nav-item
  Playwright test is the only FE e2e so far.

## As built (final, wave 5: 2026-10-20, branch `ds-14-verify-final` on `ds/local`, both repos, local only)

DS-14F turns every golden from skip to run, writes the workflow steps DS-W2–W8 (W6 waits on
DS-13), finishes the probes and adds the FE main-path Playwright run against the real backend.

### Files
**ESG-lite**
- Seed set: `ci/golden/ds/fixture/seed.sql` (on top of the API fixture: companies 11 DS Seed
  Cement, 12 DS Seed Textiles, 13 DS Seed Foods; their sites, Managers 11–13, brands, Scope 3
  categories 4/1/5 with `ghg_category`, 64 approved emission rows with factor sources, per-gas kg
  and one biogenic row, production for the EDE intensity) and `fixture/seed-kpi.sql` (company 13:
  KPI tracking on, CY setup, default frameworks, every library KPI annual, approved 2024/2025
  values of the Editorial template's KPIs at each definition's level, one pending value).
- `ci/golden/ds/lib/seed.cjs`: `ensureSeed(ctx)` loads both, runs the KPI migrations, switches the
  studio on and builds the seed docs through the API as each company's Manager:
  GHG companies 1 (CI Steel, CY 2025, pending + rejected rows), 11 (FY 2026), 12 (CY 2025):
  Inventory (`ghg-inventory-classic`), Board brief (`POST /docs/:id/resize` to 16:9 deck),
  One-page summary (`ghg-one-page-classic`); company 13: `sustainability-editorial`.
  `lib/stack.cjs`: three seed Managers in `USERS` and `buffer` on file answers (`// DS-14F`).
- Groups: `groups/seed.cjs` (outline, build steps, every binding and chip resolved:
  "label = display [reason] | series"), `groups/checks.cjs` (checks list per seed doc at its rev,
  no render), `groups/parity.cjs` (resolve vs `POST /user/ghg/tables` per company, CY 2025/2024
  and FY 2026/2025, scope and Scope 3 category splits; a gap over 0.01 t **throws**, so it can't be
  snapshotted away; EDE yearly for the cement company and DS-2 `intensity_output` = total ÷ EDE's
  approved production), `groups/render.cjs` (378 cases: each element type's elements of the DS-1
  fixture on one page of the format, rendered in the mode; frame, bytes and sha256 of each
  element's HTML; hidden elements must not render), `groups/pdf.cjs` (on a duplicate of the
  cement Inventory with the report details given and the empty placeholders removed: proof and
  final of one rev, same page count, same text per page, every text run within 0.5 mm, read with
  pdfjs-dist; then a print PDF's Media/Trim/Bleed boxes with pdf-lib).
- `cases.json`: every case `"run": true`; seed and checks cases name their `doc`; the `pdf` group
  is `"chromium": true`. `run.cjs`: a chromium group is skipped, named, where Playwright's Chromium
  can't start.
- `audit/harness/ds-probes.cjs` (`// DS-14F`): DS-P10 makes its own design (DS-P04/P05 delete
  design 1 on the way, which left P10 n/a); DS-P11 written: hostile `<script>`, `onerror` and
  `javascript:` in text, titles, labels and alt text render escaped in sheet, paged, present and
  print; a hostile brand voice round-trips as JSON text and can't close its `<untrusted>` fence.
- `ci/workflow/workflow.test.cjs`: DS-W2–W5, W7, W8 written (block `DS-14F`), W9 also checks an
  active view link answers 410 once the studio is off; `ci/workflow/README.md` row.
- `ci/unit/ds-14-verification.test.cjs`: no case waits on a module; the render matrix is complete;
  the seed fixture's ids stay clear of the API fixture and its sequences.
- `ci/golden/ds/e2e-stack.cjs`: the real stack for the FE main path (throwaway DB, seed set, CORS
  for the app origin, tokens and template ids written to a JSON file).
- `package.json`: devDependency `pdfjs-dist` 4.10.38 (Apache-2.0), exact.

**ESG-lite_FE**
- `e2e/ds-14-main-path.spec.ts` + `playwright.ds-real.config.ts` (`npm run test:e2e:ds-real`, own
  port 4317, `VITE_API_URL` from the stack file): the main path on the real backend and the
  switch-off path. Skipped, named, without `DS_E2E_STACK`. `package.json`: the script and the
  config in `lint:new`.

Run it: `npm run build && DB_NAME=ci_x node ci/golden/ds/e2e-stack.cjs /tmp/ds-stack.json 3995
http://localhost:4317` in ESG-lite, then `DS_E2E_STACK=/tmp/ds-stack.json npm run test:e2e:ds-real`
in ESG-lite_FE.

### Decisions
1. **The 3 seed companies** are the API fixture's CI Steel (deliberately not final-ready: pending
   and rejected rows) plus two new ones; the KPI seed company is a fourth. They live in
   `ci/golden/ds/fixture/` and are loaded only by the DS goldens and the e2e stack (the API
   suite's fixture is unchanged).
2. **Goldens record no ids, dates or data hashes** (`approvedAt`, `dataHash` vary with
   `updated_at`); the template id appears as the doc stores it.
3. **Render goldens hash each element's HTML, not the CSS**: a theme or font change shows in
   DS-1's own snapshots (`ci/golden/ds/render/snapshots.json`), an element change here.
4. **Parity throws instead of recording `equal: false`.** Same for proof vs final (text or
   > 0.5 mm).
5. **Workflow W7 settles the period through Review** (the Manager approves the pending row and
   deletes the rejected one) because a GHG final can't be made with them (D6). The W9 baseline
   is retaken right after that; W7 first asserts the studio had moved nothing since W0.
6. **The FE main path runs on the real backend** (every other ds-* spec mocks the API), so it
   is a separate config and an opt-in run; it fills report details and removes empty
   placeholders through the API while the report isn't open (an autosave would race it).

### Deviations
- The seed group runs with `ai: false` (no provider in CI); the AI drafting path is covered by
  the `ai/recorded` goldens and DS-9's tests.
- "Edit (move a chart, add a chip)" in the workflow is a PATCH of the doc as the editor would
  send it; dragging on the canvas is DS-6's Playwright.
- PDF goldens use the cement Inventory only (one A4 Classic doc), not every seed doc.

### Findings for other modules (the checks working on the seed docs)
- DS-12: `NUMBER_UNBOUND` (info) flags the "26" of "FY 2025–26" on every FY doc.
- DS-12: the near-miss fix (`replace_with_token`) wasn't offered for a typed Scope 1 30 % high
  on the workflow client (several candidate figures); the workflow uses the Scope 1 chip directly.
- DS-1/DS-4: the Classic Inventory's cover and compliance kicker text is 3.0:1 on its
  background (`LOW_CONTRAST` warning); flow tables (`scope3_categories`, `ghg_factor_table`) still
  print "Not reported" in finals (known since DS-12).
- DS-11 FE: after a final finishes, the Share dialog shows it only once the page's versions
  query refetches (the e2e reloads); worth an invalidate on the final's job completion seen from
  the checks panel.

### Tests run
- `test-lane.sh ds-14f-be`: build ok, unit ok, scope3-golden 32/32, calculation snapshot matches
  (23 entries, 6 reports), workflow 61 pass / 0 fail / 3 skipped (+ categories 29 pass), DS
  goldens `425 run, 425 matched` (inside DS-W11), probes 269+ pass / 0 fail / 7 n/a (DS-13
  routes and the bundled font file). API: 761 pass / 1 fail in the lane run (a ds-12 test lost
  its connection after 208 s, ECONNRESET, while the machine also ran Chromium and Vite); the
  whole API suite again on a fresh ci_* DB: 762 pass / 0 fail. No API test or server code
  changed in DS-14F.
- `test-lane.sh ds-14f-fe`: typecheck ok, lint:new ok, vitest 1957 pass (208 files).
- DS goldens alone on a fresh ci_* DB, twice (written, then compared): 425/425.
- `ds-14-main-path` (real stack): 2/2 passed, three runs in a row.

### Not done
- **DS-W6 (approval)** stays "waits on DS-13" (`/docs/:id/approvals` isn't routed on ds/local);
  DS-P03 for the DS-13 routes stays n/a for the same reason. When DS-13 lands: write W6 (request
  approval, the reviewer approves the current rev, `DS_APPROVAL_PENDING` before that) and add
  `report_comment`/`report_approval` SEED rows; nothing else here needs to change.
- "Every golden is green on `production` after DS-13" can only be checked after that merge.
- The FE main path doesn't run in FE CI (no backend there); it is the opt-in real-stack run.
