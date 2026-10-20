# DS-0 · Contracts, docs copy, switch, report kinds, mocks, empty routers

> **Module spec**, lane L1, wave 0. Copy to `ESG-lite/src/studio/contracts/CLAUDE.md`.
> **PR titles:** `[DS-0 k/m]`, three PRs:
> 1. BE contracts, switch, guard, router, docs copy;
> 2. FE contracts mirror, switch, nav item, routes shell, MSW;
> 3. client toggle UI.
>
> **Depends on:** — · **Owns:** `src/studio/contracts/*`, `src/studio/router.ts`, `src/studio/guard.ts`, `company.design_studio_enabled`, `docs/design-studio/*`, FE `src/lib/studio/contracts.ts`, `switch.ts`, `src/test/msw/studio.ts`, `src/features/studio/routes.tsx`, `DesignStudioToggle`
> **Base:** RS-0 (replaced: same steps with the DS names, mount and switch).

## Job to be done
Create the shared ground every other lane builds on, so that lanes can run in parallel without arguing about names.

## Build
1. **Docs:**
   - copy `plans/design-studio/` → `ESG-lite/docs/design-studio/`;
   - copy the RS files DS names as bases (`01-contracts.md`, `05-ux.md`, `04-decisions.md`, the 3 layer files, and RS-1, 2, 4, 5, 6, 7, 8, 9, 10, 11) → `docs/design-studio/rs-base/`;
   - add the root CLAUDE.md blocks from `02-root-claude-snippets.md`.
2. **Contracts:** write `contracts/` with every enum, the zod schema of ReportDoc v2 (including the bindings union and report inputs), error codes, check ids and AI actions from `01-contracts.md`. Add `upgradeV1(doc)`.
3. **Switch:**
   - `migrate:ds-0-switch` adds `company.design_studio_enabled boolean not null default false`;
   - `PUT /admin/companies/:id` accepts it (Superadmin only, audited, as the KPI switch in `company.controller.ts`).
4. **Guards and router:**
   - `guard.ts`: `requireDesignStudio` (403 `DS_STUDIO_OFF`) and `requireKind`;
   - `router.ts` with `GET /status`, mounted in `src/index.ts` with `// DS-0`.
5. **FE:**
   - `contracts.ts` mirror and a CI check comparing enums (a script that diffs the exported names);
   - `switch.ts`;
   - the "Design Studio" nav item in Reports, command palette entries, `routeMap` entries with `requires: "studio"`;
   - `routes.tsx` with placeholder pages;
   - `DesignStudioToggle` on `clients/DetailPage.tsx` beside `KpiTrackingToggle`.
6. **MSW:** `src/test/msw/studio.ts`, with handlers for every `01-contracts` §4 endpoint returning fixture docs for one GHG doc and one sustainability doc (the fixtures in `src/test/fixtures/studio/`).

## Tests
- **API:**
  - switch off → every `/studio/*` route except `/status` answers 403 `DS_STUDIO_OFF`;
  - `/status` reports the kinds correctly with KPI tracking on and off;
  - only a Superadmin can flip the switch;
  - the migration runs twice.
- **Unit:** the zod schema accepts both fixture docs and rejects a frame outside the format.
- **Playwright:** the nav item is hidden when off and shown when on.

## Done when
Both repos carry the contracts, the switch works end to end, the studio route shows a placeholder behind it, and every later module can build on mocks.

## As built (2026-10-20, branch `ds-0-contracts` in both repos, local only)

### Files
**ESG-lite**
- Docs: `docs/design-studio/` (the whole plan folder, canvas mockups included), `docs/design-studio/rs-base/` (RS `01-contracts`, `04-decisions`, `05-ux`, the 3 RS layer files, RS-0…RS-11 module specs; RS-0 and RS-3 added because DS-3/DS-4 name RS-3). Layer and module specs copied to their destinations (`src/studio/CLAUDE.md`, `src/reporting/studio/CLAUDE.md`, `src/studio/{contracts,sources,brandkit,library,docs,resize,jobs,checks,collab,ai}/CLAUDE.md`, `src/reporting/studio/render/CLAUDE.md`, `ci/golden/ds/CLAUDE.md`). Root `CLAUDE.md` block from `02-root-claude-snippets.md`.
- Contracts: `src/studio/contracts/{enums,sources,schema,errors,checks,ai,snapshot,index}.ts`. `index.ts` re-exports everything plus `StudioStatus`.
- Switch: `src/entities/Company.ts` (`design_studio_enabled`), `src/scripts/migrateDs0Switch.ts` (`npm run migrate:ds-0-switch`), `src/studio/switch.ts` (audit row), `src/controllers/company.controller.ts` (accepts the field; both switches audited in one transaction).
- Guard and router: `src/studio/guard.ts`, `src/studio/http.ts` (`handle`, `parse`, `routeId`), `src/studio/router.ts`, mount in `src/index.ts` (`app.use("/studio", authenticate, studioRouter); // DS-0`).
- Tests: `ci/unit/ds-0-contracts.test.cjs`, `ci/api/tests/ds-0-switch.test.cjs`, `ci/api/tests/ds-lib.cjs` (shared: `setStudio`, `setKpi`, `runScript`, `studioRoutes`, `STUDIO_CONTRACT_ROUTES`, `gatedStudioRoutes`, `callAs`), fixtures `ci/fixtures/studio/{ghg,sustainability}-doc.json`.
- FE mirror reference: `ci/studio-contracts.json`, written by `npm run studio:contracts` (`scripts/studio-contracts-snapshot.cjs`; `--check` runs in the unit test, `--diff <FE snapshot>` compares with the FE copy).

**ESG-lite_FE**
- `src/lib/studio/contracts.ts` (hand mirror + §4 HTTP shapes, "mock shape" where 01-contracts doesn't fix one), `contracts.snapshot.json` (copy of `ci/studio-contracts.json`), `contracts.test.ts`; `scripts/check-studio-contracts.mjs` (`npm run check:studio-contracts [../ESG-lite]`).
- `src/lib/studio/switch.ts` (`designStudioOn`, `kindEnabled`, `useDesignStudio`, `useStudioNavOn`, `useStudioNeedsClient`, `isStudioOff`, `isKindOff`, `useStudioCompanyId`), `src/lib/studio/StudioGate.tsx`, `src/services/studioService.ts` (`getStudioStatus`).
- Shell: `routeMap.ts` (`REQUIREMENTS` + `"studio"`, routes `studio-home|new|brand-kit|editor|preview|present|versions`), `nav.ts`, `commands.ts`, `AppShell.tsx`, `pages.tsx` (RoleGuard → StudioGate), all marked `// DS-0`.
- `src/features/studio/routes.tsx` + `StudioPlaceholder.tsx` (home shows the two kinds, sustainability disabled with "Needs KPI tracking").
- `src/features/clients/components/DesignStudioToggle.tsx` on `DetailPage.tsx` after `KpiTrackingToggle`.
- MSW: `src/test/msw/studio.ts` (every §4 endpoint, stateful; `resetStudioMocks`, `setStudioMockEnabled`, `setStudioMockKpi`, `studioMockDoc`), registered first in `src/test/msw/index.ts`; fixtures `src/test/fixtures/studio/` (same files as the backend's).
- Tests: `src/lib/studio/*.test.ts`, `src/test/msw/studio.test.ts`, studio cases in `src/features/shell/{routeMap,nav,commands}.test.ts`, `e2e/ds-0-switch.spec.ts`.

### Decisions and deviations
1. **Page sizes in the contracts.** `PAGE_FORMAT_SIZES` (mm + bleed, DS-1 §1 table) lives in `enums.ts` because the schema must reject a frame outside the format. DS-1's `render/formats.ts` stays the renderer's table and owns safe margins; it must keep these sizes (DS-1: add a unit test comparing them).
2. **Element props are a discriminated union by `type`**, so each element's props are validated. RS left divider, page_number and placeholder props open; DS-0 fixed them, and the DS-1 elements: `frame {mask, assetId?, fit, alt, crop?, bleed?}`, `grid {columns, gap, mask?, cells[]}`, `line {x1,y1,x2,y2 (mm in the frame), strokeWidth, dash, arrows}`, `big_number {binding, measure?, format?, label?, showDelta}`, `progress {binding, variant ring|bar}`, `callout {doc, icon?, tone?}`, `qr {url http(s)}`. Value elements (kpi_tile, big_number, progress) take kpi/ghg/input bindings, never `custom`.
3. **Additions the later specs need, made optional:** element `opacity` (DS-6 toolbar transparency), `FreeformPage.guides` (DS-6), `FlowOptions.categories|showDq|showMethod` (DS-7 GHG flow settings), `bleed` on image/frame/shape (lets a frame reach into the format's bleed).
4. **`DataToken.attrs.year?: YearRef`**: kept from an RS v1 `KpiToken` so `upgradeV1` loses nothing (`prior`, `base`, a year).
5. **`Suggestion.sources`** names its source (`{source:'kpi',kpi,year} | {source:'ghg',metric,year,scope3Category?} | {source:'input',key}`), since bindings now do.
6. **Errors:** no `DS_NEEDS_KPI` (the GHG kind needs only the studio switch, D4). Plumbing codes `DS_VALIDATION` (400) and `DS_COMPANY_REQUIRED` (400) added, as KPI-0 did. `CHECK_FIXES` adds `open_inputs` (report details).
7. **Guard order:** `requireDesignStudio` checks the switch (DS_STUDIO_OFF), then the role (DS_ROLE for Users), so a User sees DS_STUDIO_OFF while off and DS_ROLE while on. Company resolution reuses `kpiCompanyFor` (Superadmin names `company_id`), mapping its codes to DS ones; another company's id is 404 `DS_DOC_NOT_FOUND`.
8. **Audit:** `audit_log.entity_type = 'design_studio'`, action `switch`, `{design_studio_enabled: {old, new}}`; no notification (D4 names none).
9. **Enum check:** a cross-repo CI job isn't possible from one repo, so each side checks its own copy: the backend unit test fails when `ci/studio-contracts.json` is stale, the FE vitest fails when the mirror differs from its copy, and `check:studio-contracts` / `--diff` compare the two copies locally.
10. **FE nav:** Managers and the Superadmin get "Design Studio" under Reports; Admins have no Reports group, so theirs is top level. As KPI (D18), a Superadmin sees it before choosing a client, and the pages ask for one. Palette: "New GHG report design"; "New sustainability report design" only with KPI tracking on.
11. **MSW:** roles aren't modelled (caller = Manager); `/resolve` returns made-up display strings (mock data, not figures); every §4 endpoint answers, plus RS comment list/create/resolve and `/fonts/:file`.

### Not done (owned elsewhere)
- `/s/:token` public viewer route (outside the shell): DS-11.
- Real endpoints beyond `/studio/status`; `RENDER_HASH` and the renderer mirror (DS-1); the GHG report page's "Design this report" button (DS-5).
- The FE copy of `docs/design-studio/` is not made: the FE root block points at ESG-lite's.

### Tests run
- ESG-lite `test-lane.sh ds-0-be`: build, unit, scope3 golden (32/32), scope 1/2 golden, API 668 pass / 0 fail (ds-0: 11), workflow 50 + 29 pass.
- ESG-lite_FE `test-lane.sh ds-0-fe`: typecheck, lint:new, vitest 1672 pass. Playwright: `ds-0-switch` 5/5, plus kpi-switch, clients, shell, smoke, kpi-superadmin, smart-import all green.
