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
