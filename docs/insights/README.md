# ESGLite Insights plan (IN)

Planning only. No code changed in ESG-lite, ESG-lite_FE or python_AI_service, and no branches or PRs exist.
Written 2026-10-19 against `origin/production`: ESG-lite `5c0901e`, ESG-lite_FE `5873b1c`, python_AI_service `caff118`. The KPI plan (`plans/kpi`, KPI-0…13 and waves D/E) is built and on production. The Report studio plan (`plans/kpi-report`, RS-0…11) is planning only; this plan shares two pieces with it (materiality scores, chart data shapes) and doesn't wait for it.

**Goal:** one **Insights** page that joins the four dashboards that exist today (Overview, Targets, KPI dashboard, ESG dashboard) into a single story: are we on track, why did the numbers move, how ready is our ESG data, and what needs attention. The visuals should feel premium (sunburst, decoupling, bridge, flow, materiality, stripes), and every number must still come from approved data on the server.

Research and live chart mockups: `research.md` and https://claude.ai/artifact/ErBXCeyw35VBWqj28Ho68h

Module ids use the prefix `IN-` (B1–B8, IM, XI, CB, C, P, E, S3, SE, KPI and RS are taken). PR titles: `[IN-n k/m] …`. Branches: `in-<n>-<short-name>`. The last PR of a module says `Completes: IN-<n>`.

## How the files fit together (read top to bottom)

| Layer | File | Who reads it |
|---|---|---|
| 1 Root rules | `02-root-claude-snippets.md`: a block IN-0 pastes into each repo's root `CLAUDE.md` | every session in that repo, always |
| 2 Plan | `00-plan.md`: goal, success test, non-negotiables, modules, waves, file ownership, definition of done, risks | every lane, once per module |
| 2 Contracts | `01-contracts.md`: enums, panel response shapes, tables, API, error codes, insight rules, FE routes | every lane; changed only by an IN-0 follow-up PR |
| 2 Decisions | `04-decisions.md`: I1–I16, each with the default every lane builds on | every lane |
| 2 UX | `05-ux.md`: the page, each panel, interactions, motion, copy rules | FE lanes, and BE lanes shaping responses |
| 2 Lanes | `03-lane-map.md`: what runs in parallel, merge order | team leads |
| 3 Layer | `layers/ESG-lite-src-insights/CLAUDE.md` → `ESG-lite/src/insights/CLAUDE.md` | backend sessions |
| 3 Layer | `layers/ESG-lite_FE-features-insights/CLAUDE.md` → `ESG-lite_FE/src/features/insights/CLAUDE.md` | frontend sessions |
| 4 Module | `modules/IN-n-*/CLAUDE.md`: copied into the module's folder as its working spec | the lane building it |
| — | `research.md`: what the four dashboards show today, research findings, the eight chart concepts | background; read once |

A session working on one module reads these files in order, and does not read other module specs unless its module lists them under "Depends on":
1. the repo root `CLAUDE.md`;
2. `00-plan.md`;
3. `01-contracts.md`;
4. `04-decisions.md`;
5. `05-ux.md` (FE, and BE when shaping a response);
6. its layer file;
7. its module file.

IN-0 copies this folder to `ESG-lite/docs/insights/` (the plan of record), and copies the layer and module files to their destinations.

No `python_AI_service` layer: IN-9's AI wording runs in the backend through the OpenRouter client that `src/reporting/ai-narrative.ts` already uses (I13).

## Modules

| Id | Module | Size |
|---|---|---|
| IN-0 | Contracts, docs copy, per-client switch, MSW mocks, empty router, page shell and nav | S |
| IN-1 | Insights backend core: scope, cache, summary (hero strip), shared data readers | M |
| IN-2 | Story panels A, B, H: ESG ring, decoupling, target wall (BE + FE) | M |
| IN-3 | Insight cards: rule engine and cards (BE + FE) | M |
| IN-4 | Pathway with levers (C), completeness calendar (G), events and annotations | M |
| IN-5 | Emissions bridge (D): driver decomposition | M |
| IN-6 | Data-to-disclosure flow (E): Sankey | M |
| IN-7 | Materiality × performance (F), materiality scores | M |
| IN-8 | Polish: morph transitions, emission stripes, present mode, export | M |
| IN-9 | AI wording for insight cards | S |
| IN-10 | Golden cases, workflow test, probes | S, continuous |

Waves and lanes: `03-lane-map.md`. Milestones: `00-plan.md` §6.
