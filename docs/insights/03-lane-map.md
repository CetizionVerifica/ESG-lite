# 03 · Lane map: what runs in parallel

Three lanes. Any lane can be a Claude thread or a team member running Claude Code. Each lane:
- builds one module at a time;
- branches from `production`;
- opens `[IN-n k/m]` draft PRs into `production`;
- claims the next module only after its last PR is in review.

## Lanes

```
L1 Core + story        IN-0 ─► IN-1 ─► IN-2 ─► IN-3 ──────────────► IN-9 (waits IN-3)
L2 Why it moved        IN-10 draft ─► IN-4 (waits IN-1) ─► IN-5 ─► IN-8 (waits IN-2, IN-4)
L3 ESG + frameworks    FE panels on mocks ─► IN-6 (waits IN-1) ─► IN-7 (waits IN-2) ─► IN-10 final
```

| Wave | Modules | Needs merged | Parallel |
|---|---|---|---|
| 0 | IN-0 (L1) | — | 1 |
| 1 | IN-1 (L1), IN-10 draft (L2), FE panels A/B/H on mocks (L3) | IN-0 | 3 |
| 2 | IN-2 (L1), IN-4 (L2), IN-6 (L3) | IN-1 | 3 |
| 3 | IN-3 (L1), IN-5 (L2), IN-7 (L3) | IN-2, IN-4 | 3 |
| 4 | IN-9 (L1), IN-8 (L2) | IN-3, IN-4 | 2 |
| 5 | IN-10 final (L3) | all | 1 |

While a lane waits, it builds the FE of its next module against `01-contracts.md` with MSW mocks (`src/test/msw/insights.ts`, created by IN-0). The FE merges after its backend.

## What each lane reads before starting

| Lane | Reads |
|---|---|
| L1 | Root CLAUDE.md, `00-plan`, `01-contracts` §2 §3 §4 §6 §8, `04-decisions` I1–I6 I11–I14, both layer files, IN-0/1/2/3/9 specs. Also `controllers/managerOverview.controller.ts`, the targets controller behind `/user/targets/*`, `src/kpi/esg/service.ts`, `kpi/targets/service.ts`, `kpi/dashboard/service.ts` (read-only except IN-1's extraction). FE `features/overview`, `features/kpi/esg`, `ui/ChartFrame.tsx`, `ui/KpiStrip.tsx`. |
| L2 | `01-contracts` §3 (pathway, completeness, bridge, stripes) §5, `04-decisions` I7 I8 I15 I16, both layer files, IN-4/5/8/10 specs. Also `features/targets-sbti` (BE + FE), `controllers/submissionStatus.controller.ts`, `productionData.controller.ts`, `src/reporting/print.ts`, `ci/golden`, `ci/workflow/README.md`, `audit/harness`. |
| L3 | `01-contracts` §3 (esg ring, flow, materiality), `04-decisions` I9 I10, both layer files, IN-6/7 specs, `plans/kpi-report/modules/RS-2-data-bindings/CLAUDE.md` §7 (materiality scores). Also `kpi/auto/adapters.ts`, `entities/KpiDisclosureMap.ts`, `CompanyMaterialTopic.ts`, FE `kpi/setup/components/MaterialityStep.tsx`. |

## Shared files (the only places lanes meet; keep both sides on conflict)

- The ESG-lite routes index: IN-0 adds one `app.use('/insights', insightsRouter)` with `// IN-0`.
- `ESG-lite/src/insights/router.ts`: one `router.use` per module.
- `ESG-lite/src/entities/Company.ts` (IN-0), `CompanyMaterialTopic.ts` (IN-7 or RS-2): one column block each, with `// IN-n` or `// RS-2`.
- `ESG-lite/src/controllers/managerOverview.controller.ts` and the targets controller: IN-1 only (extraction, no behaviour change).
- `ESG-lite/package.json`: one `migrate:in-*` line per module.
- `ESG-lite_FE/src/routes/*` registry, `shell/nav.ts`, `commands.ts`, `clients/DetailPage.tsx`: IN-0 only.
- `ESG-lite_FE/src/features/insights/panels/index.ts`: one entry per panel, appended by the panel's module.
- `ESG-lite_FE/src/features/overview/Page.tsx`: IN-0 adds one "See insights" link, switch-aware.
- `ESG-lite_FE/src/features/kpi/setup/*`: IN-7 only (materiality scores block, append-only).

## Merge order the merge job enforces

1. IN-0 before everything.
2. The backend PR before the FE PR of the same module.
3. IN-1 before IN-2, IN-4, IN-6. IN-1's extraction PR before any other IN-1 PR.
4. IN-2 before IN-3 and IN-7. IN-4 before IN-5 and IN-8.
5. IN-3 before IN-9.

## Rough sizes (lane days, backend + frontend)

IN-0 1.5 · IN-1 4 · IN-2 4 · IN-3 3 · IN-4 4 · IN-5 3 · IN-6 3 · IN-7 3 · IN-8 4 · IN-9 2 · IN-10 2 (continuous).
- **Critical path (L1):** IN-0 → IN-1 → IN-2 → IN-3 → IN-9, about 14.5 lane days.
- **Earliest release** is IN-M1 (L1 alone), at about 2.5 weeks with one lane; IN-M2 follows about a week later with three lanes.
