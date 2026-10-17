# ESGLite Scope 3 plan (S3)

Planning only. No code changed in ESG-lite_FE, ESG-lite or python_AI_service, no branches or PRs (Shyam, 2026-10-15: "Do not code yet. make plan only").
Written 2026-10-15 against the `production` heads: ESG-lite `37becd7`, ESG-lite_FE `6e4f4b4`, python_AI_service `8b3de26`.

Goal: close the gaps in `gap-report.md` so ESGLite calculates and reports Scope 3 the way the GHG Protocol *Technical Guidance for Calculating Scope 3 Emissions* (v1.0) and the Scope 3 Standard ch. 11 expect. Guidance references like "L1745" are line numbers in the text of that PDF (https://ghgprotocol.org/sites/default/files/standards/Scope3_Calculation_Guidance_0.pdf); the extracted text is kept in the project folder, not in the repo. The plan also builds the contributor/manager review workflow from the canvas https://claude.ai/artifact/D8kfAoEqCUvRJNjwFjwzqW.

Module ids use the prefix `S3-` because B1–B8, IM, XI, CB and C are taken. PR titles: `[S3-n k/m] …`.

## How the files fit together (read top to bottom)

| Layer | File | Who reads it |
|---|---|---|
| 1 Root rules | `02-root-claude-snippets.md`: a block pasted into each repo's root `CLAUDE.md` by S3-0 | every session in that repo, always |
| 2 Plan | `00-plan.md`: goal, rules, modules, waves, lanes, file ownership, definition of done, milestones | every lane, once per module |
| 2 Contracts | `01-contracts.md`: enums, tables and columns, API, engine interface, error codes, check ids | every lane; changed only by an S3-0 follow-up PR |
| 2 Decisions | `04-decisions.md`: open decisions D1–D12 with the default each lane builds on | every lane |
| 2 Lanes | `03-lane-map.md`: who runs what in parallel and what waits | team leads, the dashboard |
| 3 Layer | `layers/ESG-lite-src-scope3/CLAUDE.md` → `ESG-lite/src/scope3/CLAUDE.md` | backend sessions |
| 3 Layer | `layers/ESG-lite-emissionWrite/CLAUDE.md` → appended to `ESG-lite/src/services/emissionWrite/CLAUDE.md` | anyone touching the engine |
| 3 Layer | `layers/ESG-lite_FE-features-scope3/CLAUDE.md` → `ESG-lite_FE/src/features/scope3/CLAUDE.md` | frontend sessions |
| 3 Layer | `layers/python_AI_service-scope3/CLAUDE.md` → `python_AI_service/app/scope3/CLAUDE.md` | AI service sessions |
| 4 Module | `modules/S3-n-*/CLAUDE.md` → copied into the module's folder as its working spec | the one lane building it |

A session working on one module reads: the repo root `CLAUDE.md` → `00-plan.md` → `01-contracts.md` → `04-decisions.md` → its layer file → its module file. It does not read other module specs except the ones its module lists under "Depends on".

## Modules

| Id | Module | Closes gaps (report §) | Size |
|---|---|---|---|
| S3-0 | Contracts, golden cases, docs copy | foundation | S |
| S3-1 | Category taxonomy and Scope 3 boundary | G1, 4.1, part of G8 | M |
| S3-2 | Emission factor metadata (type, gases, GWP, geography, precision) | G3, 4.4 | M |
| S3-3 | Method and data quality on every row | G2, G4, 4.3, 4.6 | M |
| S3-4 | Engine integrity fixes | 4.10, quick wins | S |
| S3-5 | Spend-based method done properly (FX, EEIO, deflator) | G6, 4.5 | M |
| S3-6 | Suppliers: supplier-specific and hybrid methods (Cat 1, 2) | G5, 4.8 | L |
| S3-7 | Cat 3 split (3a/3b/3c) and WTT double-count guard | G9 | M |
| S3-8 | Transport and distribution (Cat 4, 9) | Cat 4, Cat 9 | M |
| S3-9 | Business travel and commuting (Cat 6, 7) | Cat 6, Cat 7 | M |
| S3-10 | Sold products: processing, use, end of life (Cat 10, 11, 12) | Cat 10–12, part of G7 | L |
| S3-11 | Leased assets, franchises, investments (Cat 8, 13, 14, 15) | G7 | M |
| S3-12 | Screening, relevance, proxy and extrapolation | G10, 4.2, 4.7 | M |
| S3-13 | Scope 3 reporting (GHG report, PDF, XLSX, findings) | G8, 4.9 | M |
| S3-14 | Base year and recalculation | 4.9 base year | M |
| S3-15 | Review workflow: Draft, automatic checks, month lock | the canvas | M |
| S3-16 | Audit probes and golden regression | verification | S, continuous |

## Parallel lanes at a glance
Wave 0: S3-0 (+ S3-4, which needs nothing). Wave 1 (6 lanes): S3-1, S3-2, S3-3, S3-15 part 1, S3-16 draft, S3-4. Wave 2: S3-5, S3-6, S3-7, S3-8, S3-15 part 2. Wave 3: S3-9, S3-10, S3-11, S3-12, S3-13. Wave 4: S3-14, S3-16 final.
Detail in `03-lane-map.md`. Live status: the "Scope 3 lanes" board https://claude.ai/artifact/48P5pGPghjwrFuAJoCGXsm (it updates itself hourly from PRs titled `[S3-<n> k/m]`; see `tracking.md`).
