# Insights backend: build status

Built on 2026-10-21 in one cloud session, on `in/local` (ESG-lite). Backend only; the frontend is built by a separate session against the MSW mocks. **No pull requests were opened and `production` was not touched.** `origin/production` (`197142b`) is contained in `in/local`; nothing newer existed on it during the build.

## Branches (all pushed)

| Module | Branch | Merged into `in/local` | Endpoints / pieces |
|---|---|---|---|
| IN-0 | `in-0-contracts` (earlier session) | wave 0 | contracts, `company.insights_enabled`, guard, `/status`, `/sites` |
| IN-1 | `in-1-core-summary` | wave 1 | extraction (Overview, SBTi targets, intensity → `src/services/*`), `scope`, `panel`, `cache`, `sources/*`, `derive/index.ts`, `GET /insights/summary` |
| IN-10 draft | `in-10-verification` | wave 1 | fixture company `ci/fixtures/in-company`, golden index and runner |
| IN-2 | `in-2-story-panels` | wave 2 | `GET /esg-ring`, `/decoupling`, `/target-wall` |
| IN-4 | `in-4-pathway-events` | wave 2 | `insight_event` (`migrate:in-events`), `GET/POST/PATCH/DELETE /events`, `GET /pathway`, `/completeness` |
| IN-6 | `in-6-disclosure-flow` | wave 2 | `GET /flow` |
| IN-3 | `in-3-insight-cards` | wave 3 | rule engine, 11 rules, `GET /cards` |
| IN-5 | `in-5-emissions-bridge` | wave 3 | `derive/lmdi.ts`, `GET /bridge` |
| IN-7 | `in-7-materiality` | wave 3 | `GET /materiality`, `PUT /kpi/setup/materiality-scores` (reuses DS-2's score columns; no new migration) |
| IN-9 | `in-9-ai-card-wording` | wave 4 | `insight_ai_call` (`migrate:in-ai-calls`), `ai/*`, `GET /cards?ai=1` |
| IN-8 | `in-8-polish-present-export` | wave 4 | `GET /stripes`, `/snapshot.pdf` (backend only; motion and present mode are FE) |
| IN-10 final | `in-10-final` | last | workflow steps IN-W0–W7, `audit/harness/in-probes.cjs`, every golden runs, §1 checklist |

Each module's "As built" section (files, deviations, decisions) is in its spec copy: `src/insights/sources/CLAUDE.md` (IN-1), `panels/CLAUDE.md` (IN-2), `rules/CLAUDE.md` (IN-3), `events/CLAUDE.md` (IN-4), `derive/CLAUDE.md` (IN-5), `panels/flow.CLAUDE.md` (IN-6), `panels/materiality.CLAUDE.md` (IN-7), `docs/insights/modules/IN-8-polish-present-export/CLAUDE.md` (IN-8), `ai/CLAUDE.md` (IN-9), `ci/golden/in/CLAUDE.md` (IN-10, with the §1 checklist and evidence per item).

## How it was run

- Postgres 16 was started in the container; every suite ran. Commands mirror `.github/workflows/ci.yml`: data-safety (`check_ci_isolation.py`, `check_destructive_changes.py origin/production`), `tsc --noEmit` + build + `insights:contracts --check`, `test:unit`, `test:scope3-golden`, every `migrate:*` twice on production's schema (built from `origin/production`'s entities) + `schema-diff`, `migrate-all` twice on the base schema with the base API fixture, `ci/golden/run.cjs` (plain and `GOLDEN_REVIEW_V2=1`), `ci/api/run.cjs` (`NODE_ENV=test`), `test:workflow`, `test:ds-golden`.
- IN-0 baseline (before any IN-1 change): all green (API 784 pass / 0 fail / 7 skipped; unit 625 pass); nothing needed fixing.
- Waves 2–4 were built in parallel, one forked subagent per module in its own git worktree and branch, each with its own test database and port; merges into `in/local` were done one at a time.

## Final suites on `in/local` (IN-10 final merged)

All green (2026-10-21, commit `a57d010` + this file):

| Suite | Result |
|---|---|
| Data safety (CI isolation, destructive changes vs `origin/production`) | pass |
| Typecheck, build, `insights:contracts --check` | pass |
| Unit (`test:unit`) | 712 pass, 0 fail, 12 skipped (pre-existing) |
| Scope 3 golden | 32 run, 0 failed |
| Migrations: all 62 `migrate:*` twice on production's schema, `schema-diff`, `migrate-all` twice on the seeded base | pass |
| Calculation snapshot (plain and `GOLDEN_REVIEW_V2=1`) | matches (23 entries, 6 reports) |
| API (`ci/api/run.cjs`, `NODE_ENV=test`) | 860 pass, 0 fail, 8 skipped |
| Workflow (`test:workflow`) | **Workflow test: 97 passed, 4 skipped** (68 + 29 categories; skips: 18 SE-4, 27 S3-16, DS-W7/W8 Chromium) |
| Design Studio golden | 423 run, 423 matched, 2 skipped (Chromium) |

Suite runs per merge point on `in/local`: wave-1 tip (full, green), IN-2 (safety, build, unit, API, workflow — green), IN-4 (full incl. migrations — green: API 823 / 0 fail, workflow 60 pass + categories 29), wave-2 tip IN-6 (safety, build, unit, golden, API, workflow — green: API 829 / 0 fail), then waves 3 + 4 + IN-10 final together (full, above). The wave-3 and wave-4 merges were each checked on the merged tree with the Insights API tests plus the related existing suites (KPI route walk `kpi-d18`, `kpi-3`, `ds-2`, `ds-9`: 100 and 105 pass, 0 fail) before moving `in/local`, but `in/local` was not stopped at those two tips for a full run: the wave-3 tip alone fails workflow step K9 (see "Defects" below), fixed by IN-10 final.

## Not run / skipped

- **PDF bytes** (`in-8` snapshot one-page check, DS-W7/W8, 2 DS golden PDF cases): Playwright's Chromium (`chromium_headless_shell`) isn't installed in this container, so these skip with that reason. Without it `GET /insights/snapshot.pdf` answers 500. The IN-8 lane rendered the snapshot HTML once by hand in the local Chromium: one landscape page.
- **Workflow steps 18 (SE-4) and 27 (S3-16)**: pre-existing skips waiting on other plans.
- **Frontend checks** (Playwright, 390 px, themes, motion, nav, e2e main path `e2e/insights-main.spec.ts`): ESG-lite_FE, not this repo.

## Contract follow-ups the FE mirror needs (`ESG-lite_FE/src/lib/insights/contracts.ts`)

Made here as IN-0 follow-ups in `src/insights/contracts/panels.ts` and `docs/insights/01-contracts.md` (type-only; `ci/insights-contracts.json` is unchanged):
1. `Summary.readiness.by_pillar`: `Record<Pillar, number | null>` (a pillar with nothing counted is null, not 0).
2. `Summary.renewable_share_pct: number | null` (hero cell 3 when KPI tracking is off).
3. `Flow.nodes[].kind` adds `"category"` (KPI-off flow: column 2 is the top 6 categories).
Not in the contract, worth knowing on the FE: `GET /insights/events` items also carry `created_by` and `can_edit`; FY `year=2026` means Apr 2025 – Mar 2026 (Overview's `FY2025-26`); `/insights/snapshot.pdf` needs the `Authorization` header (no `?token=`), so a plain download link needs an IN-0 follow-up in `src/index.ts`.
I couldn't message the FE session from this cloud session (cross-session messaging is refused here), so these are listed here only.

## Decisions and deviations (details in each "As built")

- **Extraction (IN-1, refactor only):** `computeManagerOverview`, `computeNearTermTables`, `computeLongTermChart`, `emissionIntensityComparison` moved unchanged into `src/services/`; controllers delegate; existing tests and goldens unchanged.
- **SBTi set-up:** base year = `company_base_year` (S3-14); near-term target year = 2030 kept 5–10 years from the base; 4.2 %/yr. The hero strip uses the I6 pathway rule (+5 %); the target wall rates SBTi items with the I6 target rule (straight line at today), so the two can show different words for the same pathway.
- **Intensity:** Σ approved scoped emissions ÷ Σ approved production over sites with production; mixed units → `combined: true`, unit "mixed units".
- **ESG ring:** a pillar/topic with nothing counted is 0 (contract type `number`), unlike summary readiness (null).
- **Completeness (IN-4):** emissions "expected" = the site's categories (FERA excluded), done when an approved monthly row or yearly batch covers the month (My month's rule), not the submission-status contributor count; KPI cells only for manual site-level KPIs.
- **Bridge (IN-5):** Overview rounds to 3 dp, so ≤ 0.005 t of rounding residue is added to the largest step to keep Σ steps = change exactly; anything larger throws.
- **Flow (IN-6):** per-site scope split calls `computeManagerOverview` once per site (an N-per-site query set, against layer rule 8; cached per stamp). p95 on the 3-site fixture is 37 ms.
- **Materiality (IN-7):** a KPI's ESRS topic comes from its `kpi_disclosure_map` ESRS disclosures; E1's weight is a 100 % share whenever there are approved emissions, other topics by KPI count share; weight = 1 + 9 × share/100. Scores PUT is Admin/Superadmin (`KPI_FORBIDDEN` otherwise), `IN_SCORES_INVALID` for bad bodies; audit rows hold topic codes only.
- **Cards (IN-3):** `target_off_track` counts KPI targets only; `intensity_change` doesn't fire on mixed-unit intensity; rule goldens run as a unit test.
- **AI (IN-9):** model `google/gemini-3-flash-preview` via `src/lib/openrouter`; reads `INSIGHTS_AI_*`, falling back to the studio's `STUDIO_AI_*`; one log row per model call (never text); rejected wordings cached as rule text.
- **Snapshot (IN-8):** server-side HTML from the panel build functions (the FE print route isn't reachable from the backend in CI), printed by the unchanged `htmlToPdf`; its card sentences are a backend copy of 01-contracts §6.
- **Golden that moves with the calendar:** the target-wall golden recomputes expected progress and status from today's date by design; the order should hold for months, but it will need a refresh eventually.

## Defects found during the build

- **KPI probes missed the new route** (found by IN-10 final): IN-7's `PUT /kpi/setup/materiality-scores` wasn't in `audit/harness/kpi-probes.cjs`'s route matrix, so KPI-P07 and workflow step K9 failed from the wave-3 merge on; fixed in `in-10-final` (`61961c3`).
- **My own comment tripped the data-safety check** (IN-1, `cache.ts` mentioned a clear call); reworded (`[IN-1 fix]`).
- IN-3's `?ai=1` API test now reaches the (unlistened) AI stub port after IN-9 and leaves `ok=false` rows in `insight_ai_call` for company 1; the IN-9 test removes them first. Harmless, noted.

## Performance (probes, this machine, cache missed every call)

p95 ms: summary 53, esg_ring 19 (kpi_off), decoupling 55, target_wall 44, pathway 63, completeness 37, flow 37, cards 94, bridge 32, materiality 17 (kpi_off), stripes 46 — all inside layer rule 8 (summary ≤ 400, others ≤ 800). KPI-on timings with 40 KPIs were not measured (the fixture has KPI tracking off).
