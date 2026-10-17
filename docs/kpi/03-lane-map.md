# 03 · Lane map: what runs in parallel

Five lanes. Any lane can be a Claude thread or a team member running Claude Code. Each lane builds one module at a time:
- branch from `production`;
- open `[KPI-n k/m]` draft PRs into `production`;
- claim the next module only after its last PR is in review.

## Lanes

```
L1 Switch + library     KPI-0 ─► KPI-1 ─► KPI-2 ─────────────────────────► KPI-11 (waits KPI-5, KPI-6)
L2 Values core          KPI-4 (waits KPI-0) ─► KPI-6 ─► KPI-5 (waits KPI-2)
L3 Setup + entry UX     KPI-3 FE on mocks ─► KPI-3 (waits KPI-1, KPI-2) ─► KPI-7 (waits KPI-4)
L4 Review + targets     KPI-9 (waits KPI-4) ─► KPI-8 (waits KPI-7 BE) ─► KPI-10
L5 AI + verification    KPI-13 draft ─► KPI-12 (waits KPI-7) ─► KPI-13 final
```

| Wave | Modules | Needs merged | Parallel |
|---|---|---|---|
| 0 | KPI-0 (L1) | — | 1 |
| 1 | KPI-1 (L1), KPI-4 (L2), KPI-13 draft (L5), KPI-3 FE on mocks (L3) | KPI-0 | 4 |
| 2 | KPI-2 (L1), KPI-6 (L2), KPI-9 (L4), KPI-3 BE (L3) | KPI-1, KPI-4 | 4 |
| 3 | KPI-5 (L2), KPI-7 (L3), KPI-8 (L4) | KPI-2, KPI-3, KPI-6 | 3 |
| 4 | KPI-10 (L4), KPI-11 (L1), KPI-12 (L5), KPI-13 final (L5) | KPI-5, KPI-7, KPI-8 | 4 |

While a lane waits, it builds the FE of its next module against `01-contracts.md` with MSW mocks (`src/test/msw/kpi.ts`, created by KPI-0). The FE merges after its backend.

## What each lane reads before starting

| Lane | Reads |
|---|---|
| L1 | root CLAUDE.md, `00-plan`, `01-contracts` §1 §2 §3 §7, `04-decisions` D2 D6 D7 D12, both layer files, KPI-0/1/2/11 specs, the official framework sources linked in KPI-2 |
| L2 | `01-contracts` §1 §2 §4 §5, backend layer file, KPI-4/5/6 specs, `src/reporting/ghg-data.ts` and `ghg-scope3.ts` (read-only) |
| L3 | `05-ux` S2 S3, `01-contracts` §3 §6, FE layer file, KPI-3/7 specs, existing `my-month`, `add-data`, `bulk-upload` features |
| L4 | `05-ux` S4 S5, `01-contracts` §5, KPI-8/9/10 specs, existing `approvals-ledger` (Ready / Needs attention, CloseMonthView) |
| L5 | python layer file, KPI-12/13 specs, `ci/golden`, `ci/workflow/README.md`, `audit/harness` |

## Shared files (the only places lanes meet; keep both sides on conflict)

- `ESG-lite/src/entities/Company.ts`: KPI-1 adds one column with `// KPI-1`.
- `ESG-lite/package.json`: one `migrate:kpi-*` line per module, before `migrate:scope3-row-quality-backfill`.
- `ESG-lite/src/kpi/router.ts`: one `router.use` per module (KPI-0 creates it and mounts `/kpi`).
- `ESG-lite_FE/src/features/kpi/routes.tsx`: one page entry per module.
- `ESG-lite_FE/src/features/shell/nav.ts`: KPI-1 adds the switch-aware filter; modules add their item to the KPI block.
- `ESG-lite_FE/src/features/approvals-ledger/*` and `my-month/*`: only KPI-8 (KPIs tab) and KPI-7 (KPIs due card) touch them.
- `ESG-lite/src/kpi/contracts/*`, `ESG-lite_FE/src/lib/kpi/contracts.ts`: KPI-0 follow-ups only.

## Merge order the merge job enforces

1. KPI-0 before everything.
2. The backend PR before the FE PR of the same module.
3. KPI-1 before any FE module goes live (the FE reads the switch).
4. KPI-2 and KPI-4 before KPI-3, KPI-5, KPI-6. KPI-4 before KPI-7, KPI-8, KPI-9.
5. KPI-5 and KPI-6 before KPI-11. KPI-7 before KPI-8 and KPI-12.

## Rough sizes (lane days, backend + frontend)

KPI-0 1 · KPI-1 1.5 · KPI-2 5 (incl. verifying ~120 mappings) · KPI-3 4 · KPI-4 3 · KPI-5 3 · KPI-6 2.5 · KPI-7 5 · KPI-8 3 · KPI-9 2 · KPI-10 3 · KPI-11 5 · KPI-12 3 · KPI-13 2 (continuous).
- Critical path, L1: KPI-0 → KPI-1 → KPI-2 → KPI-11, about 12.5 lane days, plus the waits.
- L3 is the heaviest UX lane, at about 9 days.

With five lanes, KPI-M4 lands in about 3 working weeks.
