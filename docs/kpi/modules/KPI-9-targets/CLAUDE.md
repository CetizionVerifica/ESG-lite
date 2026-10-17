# KPI-9 · Targets and progress per KPI

> Module spec. Lane L4. Copy to `ESG-lite/src/kpi/targets/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/targets/CLAUDE.md`. PR titles `[KPI-9 k/m]`.
> Depends on: KPI-4 · Owns: `kpi_target`, `migrate:kpi-targets`, `src/kpi/targets/*`, FE `kpi/targets` · Touches: —

## Job to be done
An Admin sets a target per KPI, e.g. "cut water withdrawal 20 % by 2030 from 2024". Everyone sees whether they're on track. ESRS E1-4 and GRI 305-5 ask for targets and progress, and BRSR leadership indicators ask about them.

## Today
- SBTi-style emission targets are computed on the fly (`emission.controller.ts` `getNearTermTargetTables`, `getLongTermTargetChart`; FE `targets-sbti`).
- There's no stored target entity. KPI-9 doesn't change SBTi targets.

## Build
### Backend
1. **The `kpi_target` table** per 01-contracts §2.
   - CRUD at `/kpi/targets`: Admin writes, everyone in the company reads.
   - Validation: the baseline year has an approved value (or a typed baseline with a note), the target year is after the baseline, and the direction matches the sign.
   - Every write is audited.
2. **Progress (pure, `progress.ts`):**
   - the latest approved annual value;
   - the % of the way from baseline to target;
   - an on-track flag using a linear path;
   - a status of `on_track`, `behind` or `no_data`.

### Frontend
1. `/kpi/targets`: a list of targets with a progress bar, a status pill and a sparkline.
2. A "Set target" drawer: pick the KPI (search), the scope (company or site), the baseline (prefilled from the approved value), and the target year and value, with a direction preview ("−20 % by 2030").
3. Progress shown on the KPI cards of the dashboard (KPI-10) and in My KPIs' read-only rows.

## Tests
- **Unit:** progress maths (reduce, increase, maintain; no data).
- **API:** validation; roles; tenant isolation; switch off.
- **Playwright:** set a target, then see the progress.

## Out of scope
SBTi emission targets (unchanged). Target approval workflows.

## Done when
Any KPI can carry a target, and its progress shows wherever the KPI appears.
