# 03 · Lane map: what runs in parallel

There are five lanes. Any lane can be a Claude thread or a team member running Claude Code. Each lane:
- builds one module at a time;
- branches from `production`;
- opens `[DS-n k/m]` draft PRs into `production`;
- claims its next module only after the last PR of the current one is in review.

## Lanes

```
L1 Render + output     DS-0 ─► DS-1 ───────────────► DS-11 (waits DS-5) ──────► DS-12 (waits DS-7, DS-8)
L2 Data + documents    DS-2 (waits DS-0) ─► DS-5 (waits DS-4) ───────────────────► DS-13 (waits DS-12)
L3 Brand + library     DS-3 (waits DS-0) ─► DS-4 (waits DS-1) ─► GHG + sustainability templates ─► DS-10 (waits DS-6)
L4 Editor (FE)         DS-6 on mocks ─► DS-6 wired (waits DS-1, DS-5) ─► DS-7 ─► DS-8
L5 AI + verification   DS-14 draft ─► DS-9 (waits DS-7) ─► DS-14 final
```

| Wave | Modules | Needs merged | Parallel |
|---|---|---|---|
| 0 | DS-0 (L1) | — | 1 |
| 1 | DS-1 (L1), DS-2 (L2), DS-3 (L3), DS-6 FE on mocks (L4), DS-14 draft (L5) | DS-0 | 5 |
| 2 | DS-4 (L3), DS-5 (L2), DS-6 wired (L4) | DS-1, DS-2, DS-3 | 3 |
| 3 | DS-11 (L1), DS-7 (L4), templates continued (L3) | DS-4, DS-5, DS-6 | 3 |
| 4 | DS-8 (L4), DS-9 (L5), DS-10 (L3), DS-12 (L1) | DS-7, DS-11 | 4 |
| 5 | DS-13 (L2), DS-14 final (L5) | DS-12 | 2 |

While a lane waits, it builds the FE of its next module against `01-contracts.md` with MSW mocks (`src/test/msw/studio.ts`, created by DS-0). The FE merges after its backend.

## What each lane reads before starting

| Lane | Reads |
|---|---|
| L1 | Root CLAUDE.md, `00-plan`, `01-contracts` §1 §2 §4 §6 §7, `04-decisions` D2 D6 D8 D12 D15 D18, the renderer layer file, DS-0/1/11/12 specs, RS-1/5/9 bases. Also `src/reporting/render.ts`, `print.ts`, `svgcharts.ts`, `brands.ts` (read-only; patterns to reuse). |
| L2 | `01-contracts` §2 §2.1 §3 §4, `04-decisions` D5 D6 D7 D14 D16, the backend layer file, DS-2/5/13 specs, RS-2/4/10 bases. Also `src/reporting/ghg-data.ts`, `ghg-scope3.ts`, `ghg.ts` (orchestration only), `src/scope3/baseYear/*`, `emission.controller.ts` EDE intensity, `src/kpi/values/*` (read-only). |
| L3 | `research.md` §1 §2 §3, the mockups (`canvas/`), `05-ux` S1 S2 S5 S6, `04-decisions` D9 D11 D17 D18 D19, the renderer layer file, DS-3/4/10 specs, RS-3 base, `src/reporting/brands.ts`, `variety.ts`, FE `brand-themes`. |
| L4 | `05-ux` (all), `01-contracts` §2 §9, the FE layer file, DS-6/7/8 specs, RS-6/7 bases, `research.md` §2 (Canva patterns), FE `brand-themes` (split editor and preview pattern), `src/ui`. |
| L5 | `01-contracts` §8, `04-decisions` D10 D11, the backend layer file, DS-9/14 specs, RS-8/11 bases, `src/reporting/ai-narrative.ts`, `ci/golden`, `ci/workflow/README.md`, `audit/harness`. |

## Shared files (the only places lanes meet; keep both sides on conflict)

- `ESG-lite/src/index.ts`: DS-0 adds `app.use('/studio', studioRouter)` and `app.use('/s', shareViewer)` (the second one is added by DS-11), each with a `// DS-n` comment.
- `ESG-lite/src/studio/router.ts`: one `router.use` per module.
- `ESG-lite/src/entities/Company.ts` (DS-0, DS-13), `Brand.ts` (DS-3), `CompanyMaterialTopic.ts` (DS-2): one column block each, with `// DS-n`.
- `ESG-lite/package.json`: one `migrate:ds-*` line per module, plus `sync:studio-render` / `check:studio-render` (DS-1).
- `ESG-lite/src/config/rabbitmq.ts`: DS-11 adds the `studio.render` queue.
- `ESG-lite/src/reporting/ai-narrative.ts`: DS-9 only (extracts the OpenRouter client; same behaviour).
- `ESG-lite_FE/src/features/shell/nav.ts`, `commands.ts`, `routeMap.ts`: DS-0 only.
- `ESG-lite_FE/src/features/ghg-report/Page.tsx`: DS-5 only (one button).
- `ESG-lite_FE/src/features/brand-themes/*`: DS-3 only (link to the brand kit).
- `src/reporting/studio/render/*` and its FE mirror: the owning lane at the time (L1; L3 for theme, layout CSS and element renderers; L4 for DS-8 chart renderers). Each PR bumps `RENDER_HASH`.

## Merge order the merge job enforces

1. DS-0 before everything.
2. The backend PR before the FE PR of the same module. The ESG-lite renderer PR before the FE mirror sync PR.
3. DS-1 before DS-4, DS-6 wired and DS-11.
4. DS-2 before DS-5, DS-7, DS-8 and DS-9. DS-3 before DS-4. DS-4 before DS-5.
5. DS-5 before DS-6 wired, DS-10 and DS-11. DS-7 before DS-8 and DS-9. DS-11 and DS-7 before DS-12. DS-12 before DS-13.

## Rough sizes (lane days, backend + frontend)

| Module | Days | Note |
|---|---|---|
| DS-0 | 2 | |
| DS-1 | 8 | |
| DS-2 | 6 | |
| DS-3 | 4 | |
| DS-4 | 9 | 4 GHG templates × 3 looks, the sustainability designs, the element set |
| DS-5 | 5 | |
| DS-6 | 12 | |
| DS-7 | 5 | |
| DS-8 | 5 | |
| DS-9 | 7 | |
| DS-10 | 5 | |
| DS-11 | 5 | |
| DS-12 | 5 | |
| DS-13 | 6 | |
| DS-14 | 3 | continuous |

- **Critical path (L4):** DS-0 → DS-6 → DS-7 → DS-8, then DS-12 → DS-13. About 37 lane days plus waits.
- **DS-M1** (a designed GHG report without editing) at about 3–4 weeks with lanes L1–L3.
