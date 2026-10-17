# 03 · Lane map: what runs in parallel

Six lanes. Any lane can be a Claude thread in this project or a team member running Claude Code locally. The owner is shown on the "Scope 3 lanes" dashboard. Each lane builds one module at a time, branches from `production`, opens `[S3-n k/m]` draft PRs into `production`, and claims the next module only after its last PR is in review.

## Lanes

```
L1 Taxonomy + report   S3-0 ─► S3-1 ─────────────(waits S3-2,S3-3)─► S3-13 ─► S3-14
L2 Factors + spend     S3-2 ─► S3-5 (waits S3-3) ─► S3-7
L3 Method + suppliers  S3-3 ─► S3-6 ─────────────────────────────────► S3-12 (waits S3-5)
L4 Engine + activity   S3-4 ─► S3-8 (waits S3-3) ─► S3-9
L5 Review workflow     S3-15·1 ─► S3-15·2 (waits S3-3) ─► S3-11 (waits S3-1)
L6 Products + probes   S3-16 draft ─► S3-10 (waits S3-1,S3-3) ─► S3-16 final
```

| Wave | Modules | Needs merged | Parallel |
|---|---|---|---|
| 0 | S3-0 (L1), S3-4 (L4) | — | 2 |
| 1 | S3-1 (L1), S3-2 (L2), S3-3 (L3), S3-15·1 (L5), S3-16 draft (L6) | S3-0 | 5 (+ S3-4 finishing) |
| 2 | S3-5 (L2), S3-6 (L3), S3-8 (L4), S3-15·2 (L5), S3-7 (L2, after S3-5) | S3-2 and/or S3-3 | 4–5 |
| 3 | S3-9 (L4), S3-10 (L6), S3-11 (L5), S3-12 (L3), S3-13 (L1) | S3-1, S3-3, S3-5 | 5 |
| 4 | S3-14 (L1), S3-16 final (L6) | S3-13 | 2 |

While a lane waits, it builds the FE part of its next module against `01-contracts.md`, with mocked API responses (MSW handlers in `ESG-lite_FE/src/test/msw/scope3.ts`, created by S3-0). The FE part merges after its backend part.

## What each lane reads before starting

| Lane | Reads |
|---|---|
| L1 | root CLAUDE.md, `00-plan`, `01-contracts` §1 §4 §5 §7, both layer files, S3-0, S3-1, S3-13, S3-14 specs, `scope3-gaps/scope3-gap-report.md` §4.1 §4.9 |
| L2 | `01-contracts` §2 §4 §6, `layers/ESG-lite-emissionWrite`, `layers/python_AI_service-scope3`, S3-2, S3-5, S3-7 specs, guidance Introduction and Cat 3 (`reference/scope3-calculation-guidance.txt` lines 1390–1430, 2180–2670) |
| L3 | `01-contracts` §3 §6, S3-3, S3-6, S3-12 specs, PCF `supplierRequest.controller.ts` and `computePcf.ts` allocation, guidance Cat 1 (lines 1432–2127) |
| L4 | `layers/ESG-lite-emissionWrite`, S3-4, S3-8, S3-9 specs, guidance Cat 4, 6, 7 (lines 2673–3657, 4116–4586) |
| L5 | the canvas https://claude.ai/artifact/D8kfAoEqCUvRJNjwFjwzqW, P02 and P07 specs in ESG-lite_FE, S3-15 and S3-11 specs, guidance Cat 8, 13, 14, 15 (lines 4587–4843, 5718–end) |
| L6 | `audit/e2e-workflow-audit.md` §0 §1, `audit/harness/*`, S3-16 and S3-10 specs, guidance Cat 10–12 (lines 4976–5717) |

## Shared files (the only places lanes meet; keep both sides on conflict)

- `ESG-lite/src/services/emissionWrite/compute.ts`: after S3-0, only the dispatch table changes. Each method lives in its own file under `methods/`.
- `ESG-lite/src/entities/Emission.ts` and `EmissionFactor.ts`: each module adds its own columns in its own block, with a `// S3-n` comment.
- `ESG-lite/scripts/migrate-all.cjs`: one line per migration, appended at the end.
- `ESG-lite/src/scope3/router.ts`: one `router.use` per module (S3-0 creates it and mounts `/scope3` once).
- `ESG-lite_FE/src/features/scope3/routes.tsx`: one page entry per module. Nav items: S3-0 adds "Scope 3" under Settings, with placeholders.
- `ESG-lite_FE/src/features/approvals-ledger/*` and `my-month/*`: only S3-15 and S3-3 touch them (S3-3 adds the method/DQ chips, S3-15 the rest). S3-3 merges first.
- `ESG-lite/src/reporting/ghg*.ts`: S3-13 only. S3-4's Findings fix is FE-only.

## Merge order the merge job enforces

1. S3-0 before everything except S3-4.
2. The backend PR before the FE PR of the same module.
3. S3-2 and S3-3 before S3-5, S3-6, S3-7, S3-8, S3-9.
4. S3-1 before S3-10, S3-11, S3-12, S3-13. S3-13 before S3-14.
5. S3-15·1 (checks, read-only) before S3-15·2 (draft, lock).

## Rough sizes (lane days, backend + frontend)

S3-0 1.5 · S3-1 3 · S3-2 3 · S3-3 3 · S3-4 1.5 · S3-5 3 · S3-6 5 · S3-7 2 · S3-8 3 · S3-9 3 · S3-10 4 · S3-11 3 · S3-12 3 · S3-13 4 · S3-14 2.5 · S3-15 5 · S3-16 2 (continuous).
Critical path, L1: S3-0 → S3-1 → wait → S3-13 → S3-14, about 13 lane days. L3 is the longest (S3-3 → S3-6 → S3-12, about 11 days).
With six lanes in parallel, about 3–4 working weeks to S3-M4.
