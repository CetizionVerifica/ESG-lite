# ESGLite Design Studio plan (DS)

Planning only. No code changed in ESG-lite, ESG-lite_FE or python_AI_service, and no branches or PRs exist (Shyam, 2026-10-20: "Do not code yet").
Written 2026-10-20 against `origin/production`: ESG-lite `2cf9290`, ESG-lite_FE `586b205`.

**Goal:** bring Canva's core design experience into ESGLite as one **Design Studio** that makes two kinds of report from approved data:
- the **GHG inventory report** (Scope 1, 2 and 3, from approved emission entries);
- the **Sustainability report** (from approved KPI values).

A Manager picks a template, gets a finished first draft with real numbers and AI-suggested text, then designs freely: templates, elements, brand kit and styles, charts, resize to other formats, comments and approval, checks, and a final PDF that never changes. Every number stays linked to approved data.

**Relation to the report studio plan (`plans/kpi-report`, RS-0…11).** Shyam chose (2026-10-20) "one studio, absorb RS". This folder is now the plan of record. RS specs are still read where a DS module says "Base: RS-n". Each DS module lists what it keeps from its base and what it changes. RS is no longer built on its own. The map is in `00-plan.md` §4.

Module ids use the prefix `DS-` (taken: B1–B8, IM, XI, CB, C, P, E, S3, SE, KPI, RS, IN). PR titles: `[DS-n k/m] …`. Branches: `ds-<n>-<short-name>`. The last PR of a module says `Completes: DS-<n>`.

## How the files fit together (read top to bottom)

| Layer | File | Who reads it |
|---|---|---|
| 1 Root rules | `02-root-claude-snippets.md`: a block DS-0 pastes into each repo's root `CLAUDE.md` | every session in that repo, always |
| 2 Plan | `00-plan.md`: goal, success test, non-negotiables, RS→DS map, modules, waves, ownership, definition of done, risks | every lane, once per module |
| 2 Contracts | `01-contracts.md`: report kinds, the ReportDoc v2 schema, data sources, tables, API, error and check codes, jobs, FE routes | every lane; changed only by a DS-0 follow-up PR |
| 2 Decisions | `04-decisions.md`: D1–D20, each with the default every lane builds on | every lane |
| 2 UX | `05-ux.md`: Canva-style editor anatomy, panels, screens S1–S10, copy rules | FE lanes, and BE lanes shaping responses |
| 2 Lanes | `03-lane-map.md`: what runs in parallel, merge order | team leads |
| 3 Layer | `layers/ESG-lite-src-reporting-studio/CLAUDE.md` → `ESG-lite/src/reporting/studio/CLAUDE.md` | sessions touching the renderer (shared with the FE) |
| 3 Layer | `layers/ESG-lite-src-studio/CLAUDE.md` → `ESG-lite/src/studio/CLAUDE.md` | backend sessions (API, data sources, jobs, AI, checks) |
| 3 Layer | `layers/ESG-lite_FE-features-studio/CLAUDE.md` → `ESG-lite_FE/src/features/studio/CLAUDE.md` | frontend sessions |
| 4 Module | `modules/DS-n-*/CLAUDE.md`: copied into the module's folder as its working spec | the lane building it |
| — | `research.md`: Canva analysis, GHG reporting requirements, what ESGLite has today | background; read once |
| — | `canvas/`: source of the interface mockups at https://claude.ai/artifact/9Cwm9fMMTwDbG4DoN39Juw | FE lanes, designers |

A session working on one module reads, in order: the repo root `CLAUDE.md` → `00-plan.md` → `01-contracts.md` → `04-decisions.md` → `05-ux.md` (FE only) → its layer file → its module file → the RS base spec its module names (if any). It does not read other module specs unless its module lists them under "Depends on".

DS-0 copies this folder to `ESG-lite/docs/design-studio/` (the plan of record), copies the RS module specs DS names as bases to `docs/design-studio/rs-base/`, and copies the layer and module files to their destinations.

## Modules

| Id | Module | Base | Size |
|---|---|---|---|
| DS-0 | Contracts, docs copy, per-client switch, report kinds, MSW mocks, empty routers | RS-0 (replaced) | S |
| DS-1 | Renderer v2: page model → HTML, page formats and bleed, frames and grids, FE mirror | RS-1 (amended) | L |
| DS-2 | Data sources: KPI resolver, **GHG resolver**, report inputs (disclosures), data hash | RS-2 (amended) | L |
| DS-3 | Brand kit and Styles: palettes, fonts, logos, brand voice, shuffle, apply to all | new (+ RS-3 brand fonts) | M |
| DS-4 | Template and element library: GHG and sustainability templates, page layouts, elements, icons, uploads | RS-3 (amended) | L |
| DS-5 | Reports: studio home, new-report flow per kind, readiness, auto-build, autosave | RS-4 (amended) | M |
| DS-6 | Canvas editor with Canva chrome: side rail, contextual toolbar, page strip, grid view, rulers and guides, position panel | RS-6 (amended) | L |
| DS-7 | Text and flow: TipTap, data chips, text presets, flow sections, footnotes | RS-7 (kept) | M |
| DS-8 | Charts and tables editor: data-bound charts, chart picker, table editor, custom-data charts | new | M |
| DS-9 | AI assistant: chat panel, design from a brief, write and rewrite in brand voice, suggestions | RS-8 (amended) | L |
| DS-10 | Resize and convert: A4 report → board deck, one-page summary, social card | new | M |
| DS-11 | Preview, download, present, share link, render jobs, versions | RS-5 (amended) | M |
| DS-12 | Checks and the final gate, including GHG completeness checks | RS-9 (amended) | M |
| DS-13 | Collaboration: comments, @mentions, tasks, approval, version history, template locks, brand controls | RS-10 (amended) | M |
| DS-14 | Golden cases, workflow test, probes | RS-11 (amended) | S, continuous |

Waves and lanes: `03-lane-map.md`. Milestones: `00-plan.md` §6.
