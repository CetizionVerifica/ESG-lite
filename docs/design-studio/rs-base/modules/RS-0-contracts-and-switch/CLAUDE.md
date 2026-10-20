# RS-0 · Contracts, docs copy, per-client switch, MSW mocks, empty routers

> **Module spec**, lane L1. Copy to `ESG-lite/src/kpi/studio/contracts/CLAUDE.md`.
> **PR titles:** `[RS-0 k/m]`, three PRs:
> 1. contracts, docs and the switch (BE);
> 2. FE mirror, switch, MSW and routes;
> 3. root CLAUDE.md blocks.
>
> **Depends on:** — · **Owns:** `src/kpi/studio/contracts/*`, `src/kpi/studio/router.ts`, `guard.ts`, `company.report_studio_enabled`, `docs/report-studio/*`; FE `src/lib/report-studio/contracts.ts`, `switch.ts`, `src/test/msw/reportStudio.ts`, `src/features/kpi/studio/routes.tsx`, `ReportStudioToggle`
> **Touches:** `src/kpi/router.ts`, `Company.ts`, `company.controller.ts`, FE `kpi/routes.tsx`, `shell/nav.ts`, `commands.ts`, `routeMap.ts`, `clients/DetailPage.tsx`, the root CLAUDE.md files

## Job to be done
Give every lane the same vocabulary and a safe, switched-off home, so the other modules can be built in parallel against mocks.

## Today
- The KPI router is mounted at `/kpi` with `requireKpiTracking` (`src/kpi/router.ts`, `guard.ts`, `switch.ts`).
- FE KPI routes live in `src/features/kpi/routes.tsx`, behind `KpiGate`.
- The KPI switch toggle is on the client DetailPage.

## Build
### Backend
1. **Contracts:** `contracts/enums.ts`, `schema.ts` (zod for the whole ReportDoc in `01-contracts` §2, exporting `ReportDocSchema`, `ElementSchema`, `BindingSchema`, `KpiTokenSchema`), `errors.ts` (§5), `checks.ts` (§6), `ai.ts` (§8). Unit tests: schema round-trip on a fixture doc, and rejection cases.
2. **The switch:** migration `migrate:rs-switch` adds `company.report_studio_enabled boolean not null default false`.
   - `company.controller.ts` updateCompany accepts it from the Superadmin only, and only when `kpi_tracking_enabled` is true. Otherwise it answers 422 `RS_NEEDS_KPI` (add this to errors).
   - An audit row is written.
3. **Guard and router:**
   - `requireReportStudio` answers 403 `RS_STUDIO_OFF`.
   - `studioScope` resolves `{companyId, siteIds, role: 'R'|'M'}`.
   - `studio/router.ts` serves `GET /status`; everything else goes after the guard.
   - Mount it with one line in `src/kpi/router.ts` after `esgRouter`: `// RS-0: /kpi/studio/*`.
4. **Docs:** copy `plans/kpi-report/*` to `docs/report-studio/`, and the layer and module files to their destinations (create the folders with the CLAUDE.md only).

### Frontend
1. **Mirror and switch:**
   - `src/lib/report-studio/contracts.ts` mirrors the types and codes (a hand mirror; the zod schema stays in the backend).
   - `switch.ts` provides `reportStudioOn(user)` and `useReportStudio()` (from `/kpi/studio/status`, cached).
2. **Routes:** `studio/routes.tsx` with placeholder pages for the §9 routes, plus one entry in `kpi/routes.tsx`. The nav item "Annual report" goes in the KPI block, and the command "Open report studio" in the palette; both are switch-aware.
3. **Toggle:** `ReportStudioToggle` on the client DetailPage Overview, next to the KPI toggle. It is disabled with a tooltip when KPI tracking is off.
4. **MSW:** `src/test/msw/reportStudio.ts` mocks every §4 endpoint with fixture data: a 12-page doc using every element type, readiness, designs with 3 layouts each, and a suggestion per AI kind. RS-1 replaces its HTML fixture with real renderer output.

### Root CLAUDE.md
Paste the blocks from `02-root-claude-snippets.md` into ESG-lite and ESG-lite_FE.

## Tests
- **API:** `/status` with each switch state; every other route gives 403 `RS_STUDIO_OFF` when off and 403 `KPI_TRACKING_OFF` when KPI is off; the toggle is Superadmin-only; `RS_NEEDS_KPI`.
- **Unit:** schema fixtures.
- **Playwright:** the nav item is hidden when off, a deep link shows the friendly empty state, and the Superadmin toggle works.

## Out of scope
Any real endpoint behaviour beyond `/status` (later modules).

## Done when
- Both repos build with the contracts.
- The switch is off for every client and nothing is visible.
- The Superadmin can switch it on for a KPI client and see an empty "Annual report" page.
- The mocks serve every contract endpoint.
