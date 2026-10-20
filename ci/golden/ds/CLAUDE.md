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
