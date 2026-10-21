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
