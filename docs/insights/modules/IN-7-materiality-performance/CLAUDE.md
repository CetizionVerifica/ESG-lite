# IN-7 · Materiality × performance (F), materiality scores

> **Module spec**, lane L3. Copy to `ESG-lite/src/insights/panels/materiality.CLAUDE.md`.
> **PR titles:** `[IN-7 k/m]`, three PRs: 1. BE scores migration + `PUT /kpi/setup/materiality-scores` (skip if RS-2 merged it); 2. BE `/insights/materiality`; 3. FE `MaterialityMatrix` + scores block in KPI setup.
>
> **Depends on:** IN-2 · **Owns:** `panels/materiality.ts`, FE `panels/MaterialityMatrix.tsx`; scores columns and setup block **shared with RS-2** (I10)
> **Touches:** `CompanyMaterialTopic.ts`, `kpi/setup` materiality step (append-only)

## Job to be done
Put "what matters most" and "how we're doing on it" on one picture, so the top-right red bubbles tell a Manager where to act — the ESRS view most tools leave static.

## Build
### Backend
1. **Scores (shared with RS-2 §7):** if `company_material_topic.impact_score` doesn't exist, ship `migrate:rs-materiality-scores` exactly as RS-2 specifies (numeric(3,1), 0–10, null) and `PUT /kpi/setup/materiality-scores` (Admin, Superadmin; `IN_SCORES_INVALID`). If RS-2 merged first, use its endpoint and skip PR 1.
2. **`/insights/materiality`** → `Materiality`:
   - material topics from `company_material_topic` (`material = true`);
   - per topic: KPIs mapped to that ESRS topic among the company's selected KPIs; status = worst KPI target status (off_track > at_risk > on_track > reached > no_data) from `kpiTargets`; counts on/off track;
   - `weight` = the topic's share of tCO₂e for E1 (climate) and the KPI count share for others, normalised to 1–10 for sizing;
   - `scored` false when any material topic lacks a score.
   - `kpi_off` when KPI tracking off; `setup_incomplete` when no materiality rows.

### Frontend (`05-ux` §4 F)
1. Scatter with one series per status (legend), bubble size by weight, label "Topic · status", "Act here" `markArea` for ≥ 7/≥ 7, axes 0–10.
2. Not scored: topic list with status chips and "Add scores" link (Admin) to KPI setup's materiality step.
3. **Setup block:** "Scores (for the materiality chart)" with two sliders per material topic, shown when Insights or Report studio is on. Same component RS-2 describes; whoever builds it first owns it.

## Golden cases (`ci/golden/in/materiality/`)
Worst-status roll-up; weight normalisation; `scored` false with one missing score.

## Tests
- **API:** roles (scores Admin+ only), validation, tenant isolation, switch-off, `kpi_off`.
- **Playwright:** set scores in setup → bubbles appear; bubble click opens the topic's KPIs (`/kpi/esg?topic=`).

## Done when
The matrix shows positions from scores and colour + label from live target status, and the scores work once for both Insights and Report studio.
