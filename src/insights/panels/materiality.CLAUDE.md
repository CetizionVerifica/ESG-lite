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

## IN-7 as built (backend)
- **Scores: no new migration.** Design Studio DS-2 shipped the shared columns first (`company_material_topic.impact_score`, `financial_score`, numeric(3,1), `migrate:ds-2-materiality-scores`), so IN-7 reuses them (I10: whoever merges first ships them). DS-2's own writer (`PUT /studio/materiality`, `src/studio/sources/materiality.ts` `saveScores`) sits behind the Design Studio switch and answers DS codes, so it isn't reused.
- **`PUT /kpi/setup/materiality-scores`** (`src/insights/scores.ts`, one route line `// IN-7` in `src/kpi/setup/router.ts`): behind `requireKpiTracking` (403 `KPI_TRACKING_OFF`); Admin and Superadmin (`company_id`) only, else 403 `KPI_FORBIDDEN`; body `MaterialityScoresBodySchema` (0–10, one decimal, null clears); a bad body, a repeated topic, or a topic that isn't one of the company's **material** topics → 400 `IN_SCORES_INVALID` (`details.rule` `material_topic` + `esrs_topics`, or `one_row_per_topic`, or zod `issues`) and nothing is saved. One transaction; one `audit_log` row (`kpi_setup`, action `materiality_scores`, `changed_fields {esrs_topics: [codes]}` — codes only, never the scores). Answers `{topics:[{esrs_topic, label, material, impact_score, financial_score}]}`. Passes the D18 route-table parity walk.
- **`GET /insights/materiality`** (`panels/materiality.ts`, `router.use` line `// IN-7`), KPI panel (`kpi_off` while off); `setup_incomplete` before KPI setup or with no material topic.
  - **Topic of a KPI** = the `esrs_topic` of the disclosures it is mapped to in `kpi_disclosure_map` (the link the KPI-11 ESRS list and KPI-3's `disclosureApplies` use; only ESRS disclosures carry a topic). The company's selected, active KPIs only (library or its own); a KPI mapped to two topics counts in both.
  - `status` = worst of the topic's KPIs' statuses, each KPI the worst of its targets (`sources/targets` `kpiTargetStatuses`, I6); no target → `no_data`. `on_track` = KPIs on_track or reached; `off_track` = KPIs off_track (at_risk counts in neither).
  - `weight` (`derive/materiality.ts`): share = **100 % for E1 when the period has approved tCO₂e** (every tonne is a climate tonne), otherwise the topic's KPIs ÷ Σ KPIs of the material topics × 100; weight = 1 + 9 × share ÷ 100 (1–10).
  - `scored` = every material topic has both scores; points carry the scores (null when missing) either way. `label` = the ESRS topic name without its code. `?pillar=` keeps E*, S* or G* topics. Links: `<topic>` → `/kpi/esg?topic=<topic>`, `scores` → `/kpi/setup?step=materiality`.
- **Tests:** `ci/api/tests/in-7-materiality.test.cjs` (by hand on company 1: roll-up, counts, weights with and without tCO₂e, pillar filter, scored false → true; PUT roles, validation, tenant, KPI switch, audit; panel roles, scope, tenant, IN_OFF, kpi_off, setup_incomplete); `ci/unit/in-7-materiality.test.cjs`; golden `materiality` runs (`ci/golden/in/materiality/fixture.json` on company 901 with KPI on for the case only, `cleanup-in7.sql`).
