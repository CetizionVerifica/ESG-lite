# IN-10 · Golden cases, workflow test, probes

> **Module spec**, lane L2 (draft) then L3 (final). Copy to `ESG-lite/ci/golden/in/CLAUDE.md`.
> **PR titles:** `[IN-10 k/m]`: 1. draft fixture + skipped goldens (wave 1); 2…n. switch goldens to run as modules merge; final: workflow, probes, e2e main path.
>
> **Depends on:** IN-0 (draft), all (final) · **Owns:** `ci/golden/in/*`, `ci/fixtures/in-*`, `ci/workflow` IN steps, `audit/harness/in-probes.cjs`, `e2e/insights-main.spec.ts`
> **Touches:** —

## Job to be done
Prove the §1 success test: Insights shows the same numbers as the source pages, drivers add up, rules fire at their edges, access is right, and the page is fast.

## Build
1. **Fixture `ci/fixtures/in-company`:** 3 sites (one with a different production unit), 2021–2026 approved emissions by scope and category, some pending; production per site; Scope 2 kWh with a renewable share rising; SBTi base year 2021; 40 KPIs (auto, formula, manual) with targets in all statuses; ESRS materiality with scores for all but one topic; two events. A second company for tenant isolation; a KPI-off company.
2. **Goldens** (each module's list), all `skip` in the draft and switched to `run` by the module's PR. Plus the **cross-page parity golden**: `/insights/summary` net/intensity = `/manager/overview`; `/insights/pathway` = `/user/targets/tables`; `/insights/esg-ring` coverage = `/kpi/esg`.
3. **Workflow test** (`ci/workflow`): Superadmin turns Insights on → Manager opens every panel → adds an event → approves a pending entry → summary changes and cache busts → Superadmin turns it off → `IN_OFF`.
4. **Probes** (`audit/harness/in-probes.cjs`): every endpoint × roles × another company's ids × a site outside scope; p95 timings on the fixture against layer rule 8.
5. **E2E main path:** open Insights, hero → ring filter → bridge toggle → card Show → present mode → PDF, at 1280 and 390, in one light and one dark pack.

## Done when
All goldens run green, the parity golden holds, probes find no leaks, timings meet the budget, and the workflow and e2e pass. The final PR body states the §1 checklist with evidence for each item.
