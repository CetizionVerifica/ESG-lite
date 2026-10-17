# KPI-1 · Client switch (Superadmin) and gating everywhere

> Module spec. Lane L1. Copy to `ESG-lite/src/kpi/CLAUDE.md` (append "KPI-1 as built") and `ESG-lite_FE/src/lib/kpi/KPI-1.CLAUDE.md`. PR titles `[KPI-1 k/m]`.
> Depends on: KPI-0 · Owns: `company.kpi_tracking_enabled`, `migrate:kpi-switch`, `src/kpi/guard.ts` (`requireKpiTracking`), FE `src/lib/kpi/switch.ts`, `clients/components/KpiTrackingToggle.tsx`, the switch-aware nav filter · Touches: `Company.ts`, `company.controller.ts` `updateCompany`, `clients/DetailPage.tsx`, `clients/logic.ts` (Company type), `shell/nav.ts` `navFor`, `shell/AppShell.tsx`, `shell/commands.ts`, `shell/routeMap.ts`

## Job to be done
KPI tracking is an exclusive feature. A Superadmin turns it on or off for a client with **one switch**. Off means the client sees nothing of it and can't reach it; on means its people see KPI setup, My KPIs and reports, according to their role (D1, D2).

## Today
- **Switches are company columns:**
  - `ai_import_enabled`, `mcp_enabled`, `review_workflow_v2`, `entry_detail` in `src/entities/Company.ts`;
  - added by idempotent scripts (template: `src/scripts/addAiImportColumns.ts`, which exports the statements and has a `require.main` guard).
- **Setting them:**
  - `PUT /admin/companies/:id` (`admin.routes.ts:123`, `requireSuperAdmin`), handled by `updateCompany` in `company.controller.ts`.
  - It runs a per-key boolean check, then `repo.update`.
- **Reaching the FE:** switches arrive as `user.sites[].company.*` from login and `/auth/me` (`SESSION_USER_RELATIONS`).
- **Superadmin UI:** `clients/DetailPage.tsx:177-181` renders `SmartImportToggle` (a `panel` with heading, explanation and `Toggle`, plus `useUpdateCompany` and a toast).
- **FE helper pattern:** `src/lib/reviewWorkflow.ts` `reviewWorkflowOn` / `useReviewWorkflow`.
- **Nav isn't switch-aware yet:** `shell/nav.ts` `NAV_BY_ROLE` is static per role, and `routeMap.ts` has roles only.

## Build
### Backend
1. `migrate:kpi-switch` (`src/scripts/addKpiSwitch.ts`): `ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "kpi_tracking_enabled" boolean NOT NULL DEFAULT false`. Add `@Column({ default: false }) kpi_tracking_enabled` with `// KPI-1` to `Company.ts`.
2. `updateCompany`: accept `kpi_tracking_enabled` (boolean, else 400), Superadmin only (already the router's guard). Write an `audit_log` row `entity_type 'kpi_setup'`, `action 'switch'`, `{kpi_tracking_enabled:{old,new}}`.
3. `src/kpi/guard.ts`:
   - `requireKpiTracking` resolves the caller's company: the user's company, or `company_id` for a Superadmin.
   - Off → 403 `KPI_TRACKING_OFF`.
   - Applied to the whole `/kpi` router except `/status` and `/library/*`.
   - `GET /kpi/status` → `{enabled, setup_completed}`.
4. Notifications: when a client is switched on, the company's Admins get "KPI tracking is ready: set it up" (a new kind `kpi_enabled`, link `/kpi/setup`).

### Frontend
1. `src/lib/kpi/switch.ts`:
   - `kpiTrackingOn(user, siteId?)`: true when the session's company (or the site's company) has `kpi_tracking_enabled`;
   - `useKpiTracking()`: also refreshes from `GET /kpi/status`, so a switch change shows without signing in again.
2. Superadmin: `clients/components/KpiTrackingToggle.tsx`, on the Overview tab below `SmartImportToggle`.
   - Copy and confirm dialog as in `05-ux.md` S1.
   - Add `kpi_tracking_enabled?: boolean` to the `Company` type in `clients/logic.ts`.
3. **Nav filtering:**
   - Extend nav items with an optional `requires: "kpi"`.
   - `navFor(role, user)` drops items whose requirement is off; `AppShell` and `commands.ts` use it.
   - `routeMap.ts` routes get `requires: "kpi"`, and the router shows the "not available" `EmptyState` for them when off.
   - Add the KPI nav items from 01-contracts §6, each pointing at a placeholder page until its module lands.
4. Shared: a `KpiNotAvailable` empty state.

## Tests
- **API:**
  - Superadmin can set the switch; Admin, Manager and User get 403;
  - a non-boolean value → 400;
  - with the switch off, every `/kpi/*` route answers `KPI_TRACKING_OFF` (a table-driven test over the router's routes);
  - with it on, `/kpi/status` → enabled;
  - tenant isolation (company 2 token);
  - the migration runs twice.
- **Unit:** `kpiTrackingOn` (no company; site of another company; switched off).
- **Playwright:**
  - the Superadmin flips the switch (request body, toast);
  - a User with it off sees no "My KPIs" and gets the not-available page on `/kpi`;
  - with it on, sees the nav item.

## Out of scope
Pricing or plan tiers. Per-site switches.

## Done when
One toggle on the client page turns KPI tracking on or off. With it off, nothing KPI is visible or reachable for that client's people in the UI or the API. Existing goldens and reports are unchanged.
