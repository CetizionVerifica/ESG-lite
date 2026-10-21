# IN-4 · Pathway with levers (C), completeness calendar (G), events and annotations

> **Module spec**, lane L2. Copy to `ESG-lite/src/insights/events/CLAUDE.md`.
> **PR titles:** `[IN-4 k/m]`, four PRs:
> 1. BE `insight_event` table, entity, CRUD;
> 2. BE `/insights/pathway`, `/insights/completeness`;
> 3. FE `Pathway`, `EventsDrawer`, event marks in Decoupling;
> 4. FE `Completeness` + missing-items drawer.
>
> **Depends on:** IN-1 · **Owns:** `insight_event`, `src/entities/InsightEvent.ts`, `events/*`, `panels/{pathway,completeness}.ts`, FE `panels/{Pathway,Completeness}.tsx`, `components/EventsDrawer.tsx`
> **Touches:** —

## Job to be done
Show whether emissions follow the science-based pathway and which lever (renewables, efficiency) is moving them; label the moments that explain jumps; and show where the year's data is thin before it's locked.

## Build
### Backend
1. **Events:** `migrate:in-events` creates `insight_event` (`01-contracts` §5). CRUD per §4: label ≤ 60 chars, kind enum, date within the company's data range ± 1 year; Manager writes only for own sites (or company-level if they reach all sites); creator/Admin/Superadmin edit and delete. Audit-log create/delete. Events change the cache stamp.
2. **`/insights/pathway`** → `Pathway`:
   - pathway and actual by scope from `sbtiTargets.service.ts` for base year → target year (near-term horizon from the saved/selected setup; default 4.2 %/yr 1.5 °C);
   - lever `renewable_share` = approved renewable kWh ÷ total electricity kWh per year from the existing Scope 2 electricity data (or `energy_renewable / energy_total` KPI values when KPI on); `energy_intensity` = kWh per output unit when production exists;
   - `gap_band` = max(0, actual − pathway) per year; `events` in range;
   - `no_data` when no base year, with reason "Set a base year in Targets".
3. **`/insights/completeness`** → `Completeness`: per site × month of the period:
   - emissions expected/approved from the submission-status logic (`submissionStatus.controller.ts` functions; extract if needed, refactor-only);
   - KPI expected/approved from `kpi/dashboard` gaps and values (monthly KPIs per month, quarterly in the quarter's last month, annual in the last month) — only when KPI on;
   - `pct` = approved ÷ expected; `null` for future months or nothing expected.

### Frontend (`05-ux` §4 C, G)
1. **Pathway:** stacked scope bars, dashed pathway line, lever line on the right axis, gap band (`markArea` per year or a custom series), target pin, event `markLine`s. Header toggle "Pathway | What moved" (D arrives in IN-5; until then the toggle is hidden).
2. **EventsDrawer:** list, add, edit, delete events (Manager+), opened from a "Events" button on Pathway and Decoupling.
3. **Completeness:** `heatmap` with `visualMap` on heat tokens, printed %, blank future cells; click → drawer of missing entries and KPI values with links.

## Golden cases (`ci/golden/in/pathway/`, `completeness/`)
- pathway values equal `/user/targets/tables` for the same base year and rate;
- renewable share by hand for two years;
- completeness for a site with a yearly-filed category and a quarterly KPI.

## Tests
- **API:** events role matrix, site scope, validation errors, tenant isolation, migration twice; pathway `no_data`; completeness `kpi_off` (emissions only).
- **Playwright:** add an event and see it on both charts; completeness cell opens the drawer; 390 px.

## Done when
Pathway and completeness match the source pages on the fixture, events can be managed and appear as annotations, and both panels work without KPI tracking.

## IN-4 as built (backend)
- **Table** `insight_event` (01-contracts §5; `created_at`/`updated_at` timestamptz), entity `src/entities/InsightEvent.ts` (registered in `src/config/data-source.ts`, `// IN-4`), `migrate:in-events` → `src/scripts/migrateInEvents.ts` (IF NOT EXISTS; the statements TypeORM generates, schema-diff clean), index `IDX_insight_event_company_date`.
- **`events/crud.ts`**: `GET /insights/events?from=&to=&sites=` → `{events:[{id, date, label, kind, site_id, created_by, can_edit}]}` (company-level ones plus the scope's sites, by date; `can_edit` added for the drawer); `POST` → 201 `{event}`; `PATCH /:id` → `{event}`; `DELETE /:id` → `{removed}`. Rules: zod bodies → 400 `IN_EVENT_INVALID` (`details.issues`); date within [first emission date − 1 year, max(last emission date, today) + 1 year] (`eventDateWindow`; no data → today ± 1 year); a site outside the caller's → 404 `IN_SITE_NOT_FOUND`; company-level (`site_id` null) only for a caller who reaches every site, else 403 `IN_FORBIDDEN` (`details.rule`); an event not visible to the caller (another company's, or on a site outside theirs) → 404 `IN_EVENT_NOT_FOUND`; edit/delete by its creator, an Admin or the Superadmin, else 403 `IN_FORBIDDEN`. `audit_log` (`entity_type 'insight_event'`) on create, update (changed fields; the label text itself is logged only as "changed") and delete. Events move the data stamp (IN-1 `sources/stamp.ts` reads the table once it exists).
- Exported for other modules: `eventsInRange(scope, fromIso | null, toIso | null): EventRef[]` (IN-2 decoupling marks, IN-5 annotations), `buildPathway(scope)` (`panels/pathway.ts`), `buildCompleteness(scope, today?)` (`panels/completeness.ts`), `NO_BASE_YEAR`. Routes are mounted through `panels/in4.ts` (one `router.use` line, `// IN-4`).
- **`GET /insights/pathway`**: years base…target, `pathway` = table1 `targetEmission`, `actual.s1/s2` = table3 per year (null for "No Data" years), `actual.s3` only when Scope 3 is in the SBTi boundary (≥ 40 % in the base year; else all null), `gap_band` = max(0, actualTotal − targetTotal) for years with data, levers `renewable_share` (sources/energy, %) and `energy_intensity` (kWh per unit) only when every site's production shares one unit, events base-year Jan 1 … target-year Dec 31. Calendar years always (as the Targets page). `no_data`: no base year ("Set a base year in Targets…"), or no approved emissions in the base year. Deviation: the renewable lever reads emission rows only, not the `energy_renewable / energy_total` KPI values when KPI is on (one source, same figure on both sites of the switch).
- **`GET /insights/completeness`**: cells per site × month of the period. Emissions: expected = the site's categories without FERA (the contributor obligation of `services/contributorObligations.ts`, at site level rather than per contributor); approved = categories with an approved monthly row in the month or an approved yearly batch covering it (`yearlyCoversDateSql`, the "what's left to file" rule). KPI (on and set up): selected **manual site-level** KPIs whose period ends in the month, on `expectedSites` (KPI-8/D17), approved values only; company-level and auto/formula KPIs are not cells (deviation: nobody files them per site). `pct` null for months after the current one or with nothing expected. Deviation from "submission-status logic": submission status counts contributors who filed anything; completeness counts what was filed per category, which is what the heatmap shows, so no extraction from `submissionStatus.controller.ts` was needed.
- **derive/pathway.ts** (new file, so IN-2's `derive/index.ts` stays untouched): gapBand, renewableShares, energyIntensities, completenessPct.
- **Tests:** `ci/api/tests/in-4-events.test.cjs` (migration twice, role matrix, a Manager of one site, validation, window, not-found, tenant, audit rows, stamp, switch-off), `ci/api/tests/in-4-pathway-completeness.test.cjs` (no_data, = `/user/targets/tables`, events in range, monthly + FY yearly coverage, future months null, quarterly KPI cells, KPI off, roles/scope/switch-off), `ci/unit/in-4-derive.test.cjs`; goldens `ci/golden/in/{pathway,completeness}/fixture.json` on `ci/fixtures/in-company` + `seed-in4.sql` (a 0 t CY yearly batch on site 902, two events), and the pathway part of the `parity` golden.
