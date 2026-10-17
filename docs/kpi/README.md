# ESGLite KPI tracking plan (KPI)

Planning only. No code changed in ESG-lite, ESG-lite_FE or python_AI_service, no branches or PRs (Shyam, 2026-10-17: "Do not code yet").
Written 2026-10-17 against the `production` heads: ESG-lite `10b38be`, ESG-lite_FE `1ff35f7`, python_AI_service `7936b9b`.

**Goal:** a client the Superadmin switches on can track every ESG KPI it reports, beyond GHG: energy, water, waste, workforce, safety and governance. Each KPI is entered once and mapped to the disclosures of **GRI**, **BRSR** (SEBI, incl. BRSR Core) and **CSRD / ESRS**, then shown and exported in each framework's own shape. The same people who enter emission data enter KPIs, with the same roles, sites and review. The UI must be the easiest part of the product to use.

Module ids use the prefix `KPI-` (B1–B8, IM, XI, CB, C, P, E, S3 and SE are taken). PR titles: `[KPI-n k/m] …`. Branches: `kpi-<n>-<short-name>`. The last PR of a module says `Completes: KPI-<n>`.

## How the files fit together (read top to bottom)

| Layer | File | Who reads it |
|---|---|---|
| 1 Root rules | `02-root-claude-snippets.md`: a block KPI-0 pastes into each repo's root `CLAUDE.md` | every session in that repo, always |
| 2 Plan | `00-plan.md`: goal, non-negotiables, modules, waves, file ownership, definition of done | every lane, once per module |
| 2 Contracts | `01-contracts.md`: enums, tables, API, error codes, FE routes | every lane; changed only by a KPI-0 follow-up PR |
| 2 Decisions | `04-decisions.md`: D1–D16 with the default each lane builds on | every lane |
| 2 UX | `05-ux.md`: the screens, flows and copy rules every FE module follows | FE lanes, and BE lanes shaping responses |
| 2 Lanes | `03-lane-map.md`: who runs what in parallel, merge order | team leads |
| 3 Layer | `layers/ESG-lite-src-kpi/CLAUDE.md` → `ESG-lite/src/kpi/CLAUDE.md` | backend sessions |
| 3 Layer | `layers/ESG-lite_FE-features-kpi/CLAUDE.md` → `ESG-lite_FE/src/features/kpi/CLAUDE.md` | frontend sessions |
| 3 Layer | `layers/python_AI_service-kpi/CLAUDE.md` → `python_AI_service/app/kpi/CLAUDE.md` | AI service sessions |
| 4 Module | `modules/KPI-n-*/CLAUDE.md` → copied into the module's folder as its working spec | the lane building it |

A session working on one module reads: the repo root `CLAUDE.md` → `00-plan.md` → `01-contracts.md` → `04-decisions.md` → `05-ux.md` (FE) → its layer file → its module file. It does not read other module specs except the ones its module lists under "Depends on".

KPI-0 copies this folder to `ESG-lite/docs/kpi/` (the plan of record) and the layer and module files to their destinations.

## Modules

| Id | Module | Size |
|---|---|---|
| KPI-0 | Contracts, docs copy, MSW mocks, empty routers | S |
| KPI-1 | Client switch (Superadmin) and gating everywhere | S |
| KPI-2 | KPI library and framework catalogue (GRI, BRSR, ESRS), Superadmin library admin | L |
| KPI-3 | Company setup wizard: frameworks, year, material topics, KPI selection, owners | M |
| KPI-4 | KPI value store: periods, site/company level, units, evidence, statuses, audit | M |
| KPI-5 | Auto KPIs from data already in ESGLite (emissions, energy, production, waste) | M |
| KPI-6 | Calculated KPIs: formulas, intensities, percentages | M |
| KPI-7 | "My KPIs": the contributor's to-do list and one-question entry | L |
| KPI-8 | Review and close (Manager): checks, approve all ready, period lock | M |
| KPI-9 | Targets and progress per KPI | S |
| KPI-10 | KPI dashboard and framework coverage | M |
| KPI-11 | Framework reports and exports (GRI index, BRSR tables, ESRS datapoints) | L |
| KPI-12 | AI assist: values from documents, mapping suggestions (suggest only) | M |
| KPI-13 | Golden cases, workflow test, probes | S, continuous |

Waves and lanes: `03-lane-map.md`. Milestones: `00-plan.md` §6.
