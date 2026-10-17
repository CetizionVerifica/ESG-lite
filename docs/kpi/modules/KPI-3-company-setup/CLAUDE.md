# KPI-3 · Company setup wizard: frameworks, year, material topics, KPI selection, owners

> Module spec. Lane L3. Copy to `ESG-lite/src/kpi/setup/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/setup/CLAUDE.md`. PR titles `[KPI-3 k/m]` (1/2 ESG-lite, 2/2 FE).
> Depends on: KPI-1, KPI-2 · Owns: `company_kpi_settings`, `company_framework`, `company_material_topic`, `company_kpi`, `kpi_assignment`, `kpi_topic_grant`, `migrate:kpi-setup`, `src/kpi/setup/*`, FE `kpi/setup` · Touches: `company-users` (topic grant field on the user drawer)

## Job to be done
An Admin turns "we report GRI, BRSR and CSRD" into the exact list of KPIs their people owe, per site, with owners, **in under 5 minutes**, without reading a standard (05-ux S2).

## Today
- Admins already manage users and sites (`/company-admin`, FE `company-users`, `sites`).
- Site users are `user.site` / `user.sites`, and Managers are the site's managers.
- Category grants (`user_categories`) are the model for the topic grant.
- The year type (CY/FY) is per row today: `reporting_period` and `year_type` on emissions. Companies have no stored year type, so KPI-3 stores one for KPIs.

## Build
### Backend
1. Tables per 01-contracts §2 (setup part), `migrate:kpi-setup`.
2. `GET /kpi/setup`, any role of the company, returns:
   - the settings;
   - the enabled frameworks (with versions);
   - material topics;
   - selected KPIs with each one's frequency and level;
   - assignments;
   - a `recommended` list.
3. `PUT /kpi/setup` (Admin, or Superadmin with `company_id`): partial updates per step, validated:
   - a non-material topic needs a reason;
   - excluding a `required` KPI needs a reason;
   - an owner must be a user of that site (or of the company for company-level KPIs);
   - a reviewer must be a Manager of the site.

   Each step writes an audit row (`kpi_setup`). `setup_completed_at` is set when the last step is saved.
4. **Recommendation rule** (`setup/recommend.ts`, pure, unit-tested). A KPI is recommended when either holds:
   - it maps to a disclosure of an enabled framework version whose requirement is `required` or `core`;
   - its requirement is `if_material` and its `esrs_topic` is material.

   Calculated KPIs pull in their inputs, e.g. `GHG_INTENSITY_REVENUE` adds `REVENUE`.
5. **Default owners:**
   - site-level KPIs go to the site's data-entry users (`user.site`), and reviewers are the site's managers;
   - company-level KPIs go to the Admins.
6. `POST /kpi/setup/custom-kpis` (Admin): a company KPI (`company_id` set), validated as library KPIs, optionally mapped (`kpi_disclosure_map` rows scoped to the company).
7. Users: the `kpi_topic_grant` field in the existing user update (Admin), so a "safety officer" sees only Health & safety KPIs.

### Frontend
1. The `/kpi/setup` wizard, exactly as `05-ux.md` S2: a `Stepper` with 4 steps, resumable, with each step saved on Next. It uses the `useSetup()` query and mutation.
2. **Step 3 (KPIs):**
   - grouped by topic, with `FrameworkBadges` and "Auto" / "Calculated" chips and a live count;
   - unticking a required KPI asks for a reason in a `Popover`;
   - "Add your own KPI" drawer.
3. **Step 4 (owners):**
   - a matrix grid with a person `Combobox` per cell and "Apply to all sites";
   - virtualised for 30+ KPIs × 10+ sites;
   - keyboard navigable.
4. **After setup:** Settings → KPI setup shows the same steps as tabs for later changes. A finished-setup summary shows "Invite your team", which sends notifications to owners (`kpi_assigned`).
5. A user drawer field "KPI topics" (topic grant) in `company-users`.

## Tests
- **API:**
  - Admin-only writes, while a Manager or User reads;
  - a Superadmin with `company_id`;
  - each reason rule;
  - an owner outside the site → 422;
  - tenant isolation; switch off → `KPI_TRACKING_OFF`;
  - migration twice.
- **Unit:** the recommendation rule (GRI only; BRSR Core; ESRS with E3 not material; formula inputs pulled in).
- **Playwright:** the full wizard (4 steps, a reason prompt, a custom KPI, apply to all sites), resuming after a reload, and 390 px.

## Out of scope
A full double-materiality assessment (D13). Per-KPI due dates (D16).

## Done when
An Admin completes setup in 4 steps and every site's people owe exactly the right KPIs. The setup can be changed later, with every change audited.
