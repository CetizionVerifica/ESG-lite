# S3-16 · ready to place in the shared audit folder

Built and tested from a local ESG-lite checkout, but **nothing here belongs in
the repo**: every file S3-16 owns lives in `/mnt/project-files/audit/`, which
this session cannot reach. This branch is a staging area (do not merge). Place
these from a session that has the audit folder mounted. The same files, laid
out by target path, are in the package folder that came with this handover
(`package/`, with its own README).

| This file (branch) | Package file | Goes to |
|---|---|---|
| `audit/harness/scope3-probes.cjs` | `audit/harness/scope3-probes.cjs` | `/mnt/project-files/audit/harness/scope3-probes.cjs` (new) |
| `audit/harness/scope3-probes.CLAUDE.md` | `audit/harness/scope3-probes.CLAUDE.md` | `/mnt/project-files/audit/harness/scope3-probes.CLAUDE.md` (new: the module spec plus "As built") |
| §14 below | `audit/e2e-workflow-audit.section14.md` | appended to `/mnt/project-files/audit/e2e-workflow-audit.md` after §13 |
| §0.2, §9, §10, §11 lines below | same file, "Other sections" | the matching sections of `e2e-workflow-audit.md` |
| the `run-audit.sh` line below | `audit/run-audit.snippet.sh` | `/mnt/project-files/audit/run-audit.sh`, after the `xi-probes` step |
| the route list below | `audit/route-sweep.additions.md` | `/mnt/project-files/audit/harness/route-sweep.mjs`, route list |

## What was verified (2026-10-16)

Against ESG-lite `production` 6aa5bda (S3-0, 1, 2, 4, 7, 9, 10, 11, 13 and
S3-15 part 1 merged), compiled with `npm run build`, on a throwaway Postgres 16
(`ci_` database, `CI_THROWAWAY_DB=true`), starting from an empty database and
run twice in a row:

```
s scope3-probes "13 pass / 1 fail / 0 error / 8 n/a / 3 manual"
exit=0
s scope3-probes "13 pass / 1 fail / 0 error / 8 n/a / 3 manual"
exit=0
```

- Both result files and both golden files byte-identical; about 85 s a run.
- Fixture cleaned: equal row counts in every table before and after each run
  (the harness turns any difference into an `error`), no `S3-16 probe` row
  left, no uploaded evidence file left, the golden database dropped.
- The one `fail` is a product bug, filed below as F-22 against S3-7; a fail
  belongs to the owning lane, so the run still exits 0.
- Against `production` merged with `origin/s3-3-method-and-data-quality`
  (00b8cd6) in a scratch worktree: `14 pass / 1 fail / 0 error / 6 n/a /
  4 manual`, exit 0. S3-05 flips to pass (59 Scope 3 rows with a method, 53
  typed probe rows with method, dq and data_type), S3-21 runs 13 scripts
  including `row-quality`, S3-22 moves from `na` to `manual`, S3-15 drops
  method, dq and data_type from "Not tracked".

### Per row, today's production

| Row | Status | Module / evidence |
|---|---|---|
| S3-01 | pass | `ci/golden/run.cjs` snapshot identical (23 entries, 4 reports); engine 16 run / 0 failed / 16 skipped of 32; live API: all 16 run cases (S3-7, S3-9, S3-10, S3-11) and the S3-13 report case pass; 16 skip owed by S3-5, S3-6, S3-8, S3-12 |
| S3-02 | pass | numbers 1-15 on Scope 3 only, 1 Unmapped; `SCOPE_INVALID`, `GHG_CATEGORY_INVALID` (S3-1, S3-4) |
| S3-03 | pass | 2 companies × 15 boundary rows, every exclusion with a reason; `EXCLUSION_REASON_REQUIRED`; Manager PUT 403 (S3-1) |
| S3-04 | pass | metadata copied to 53 probe row snapshots; a `wtt` factor on Cat 6 saves with `FACTOR_TYPE_MISMATCH` (S3-2) |
| S3-05 | na | S3-3 (`emission.method`, `dq`, `data_type` absent) |
| S3-06 | pass | `UNIT_REQUIRED` on factor save and on an entry on a legacy unitless factor; every row has `total_kgco2e` (S3-4) |
| S3-07 | na | S3-5 |
| S3-08 | na | S3-6 |
| S3-09 | **fail** | fuel twin `3a_upstream_fuels`, all twins split, Cat 3 golden pass, total kept; but no `WTT_ALREADY_IN_FACTOR` on a category numbered 4 → F-22 (S3-7) |
| S3-10 | na | S3-8 |
| S3-11 | pass | ex-6.1, ex-7.1, ex-7.2 live (S3-9) |
| S3-12 | pass | ex-10.1, ex-10.2, ex-11.1, ex-11.3, ex-12.1 live (S3-10) |
| S3-13 | pass | ex-8.1, ex-13.1, ex-14.1, ex-14.2, ex-15.1 live; ex-15.2 waits for S3-5 (S3-11) |
| S3-14 | na | S3-12 |
| S3-15 | pass | JSON carries R2-R5, R7-R10 (Not tracked: method, dq, data_type, proxy); PDF blocks R2, R5-R10 read from `dist` because this host has no Chromium (PDF 500); R1 needs the rendered PDF (S3-13) |
| S3-16 | na | S3-14 |
| S3-17 | pass | every pending row checked, held ids within §8; `ready=` filter and counts; `only_ready` approves the ready row, skips the held one (S3-15·1) |
| S3-18 | na | S3-15·2 (S3-15 parts 3-4) |
| S3-19 | pass | 17 endpoints × company 2's Manager and User → 403/404; screening, base year, locks not built (S3-12, S3-14, S3-15·2) |
| S3-20 | pass | 11 endpoints × 4 roles as specified; base year and locks not built (S3-14, S3-15·2) |
| S3-21 | pass | `migrate:all` twice, 12 `migrate:scope3-*` scripts, second pass changes nothing |
| S3-22 | na | S3-3 (manual once S3-3 lands) |
| S3-23 | manual | API log of the run clean of probe activity names; AI service log by hand |
| S3-24 | manual | route sweep with the routes below, then a look |
| E2E-12 | manual | walked on staging by hand |

### Findings (file in §9, next free numbers)

**F-22 · S3-7 · `WTT_ALREADY_IN_FACTOR` is never raised for a category known only by its `ghg_category`.**
`wttDoubleCountWarning` (`src/services/emissionWrite/methods/fera.ts:182-191`)
reads the number through `ghgCategoryOfContext`, which looks for
`ctx.ghg_category` (`fera.ts:171-175`) and otherwise parses the category
*name*. The engine context never loads `ghg_category`
(`src/services/emissionWrite/context.ts:61-75` sets only `category_name` and
`scope`), so since S3-1 merged the warning depends on the client naming the
category "Upstream/Downstream transportation and distribution". Evidence: the
probe creates a Scope 3 category with `ghg_category = 4` named
"S3-16 probe Cat 4", a 2013 factor `life_cycle` with `includes_wtt: true`
(0.11 kg per tonne.km) through `POST /admin/emission-factors`, and posts
1,000 tonne.km for 2014 through `POST /user/emissions`: 201, total 110 kg
(correct), `warnings: []` (expected `["WTT_ALREADY_IN_FACTOR"]`). S3-7's own
test passes because its category is named "Upstream transportation and
distribution". Owner: S3-7 (with S3-1: the context should carry
`ghg_category`). Not fixed here (out of scope for S3-16).

## §14 for e2e-workflow-audit.md

In the doc's own row format. Pre-audit stays ⏸ planned until the hourly audit
runs the harness; Result carries this session's dated local run, for the
hourly audit to overwrite.

```markdown
## 14. Scope 3 (GHG Protocol categories) — modules S3-0–S3-15

The Scope 3 plan lives at `/mnt/project-files/scope3/` (plan, contracts,
decisions, one spec a module; the repo copy is `ESG-lite/docs/scope3/`).
Harness: `audit/harness/scope3-probes.cjs`
(`node audit/harness/scope3-probes.cjs <ESG-lite dir> <out.json>`), run from
`run-audit.sh` after `xi-probes`; its spec is `harness/scope3-probes.CLAUDE.md`.
Extra setup: it needs `dist/` (`npm run build`), builds the schema from it and
loads `ci/api/fixture.sql` when the database is empty, then runs `migrate:all`
as production does on start. The live golden step posts every `run` case of
`ci/golden/scope3/cases.json` through `POST /user/emissions` and writes
`results/runs/<ts>-scope3-golden.json`; the calculation snapshot runs in a
database of its own (`<DB_NAME>_golden`, dropped after). What is built is read
from the stack (columns, tables, routes asked with a token, migrate scripts):
a row whose module is not built is `na` and names the module that owes it. A
`fail` files an F-row in §9 against the owning module.

| # | Expected behaviour | Layers | Own test (module) | Audit check | Pre-audit | Result |
|---|---|---|---|---|---|---|
| S3-01 | Every worked example the app supports reproduces to the kgCO₂e through the API; every case owned by a built module is `run`; `ci/golden` stays byte-identical unless the PR lists the changes | ESG-lite | `ci/golden/run.cjs`, `test:scope3-golden`, `s3-13-reporting` report case (all) | `scope3-probes` S3-01 + `scope3-golden` | ⏸ planned | 2026-10-16 local: pass, 16 run cases and 1 report case live; 16 skip owed by S3-5, S3-6, S3-8, S3-12 |
| S3-02 | Every Scope 3 category carries a number 1–15 or reads Unmapped, numbers only on Scope 3; `scope` is one of the four values (`SCOPE_INVALID`, `GHG_CATEGORY_INVALID`) | ESG-lite | `s3-1-boundary`, `s3-4-engine-integrity` (S3-1, S3-4) | `scope3-probes` S3-02 | ⏸ planned | 2026-10-16 local: pass |
| S3-03 | 15 boundary rows a company; an exclusion with no reason is `EXCLUSION_REASON_REQUIRED`; a Manager PUT is 403 | ESG-lite, FE | `s3-1-boundary` (S3-1, D12) | `scope3-probes` S3-03 | ⏸ planned | 2026-10-16 local: pass |
| S3-04 | New factors carry type, GWP set, geography and dataset; the row snapshot copies them; `FACTOR_TYPE_MISMATCH` only warns | ESG-lite, FE, AI | `s3-2-factor-meta` (S3-2) | `scope3-probes` S3-04 | ⏸ planned | 2026-10-16 local: pass |
| S3-05 | Every new Scope 3 row from every channel carries a method, a DQ and a data type; old rows are backfilled | ESG-lite | `s3-3-row-quality` (S3-3) | `scope3-probes` S3-05 | ⏸ planned | 2026-10-16 local: n/a (S3-3); pass on production + S3-3 |
| S3-06 | `UNIT_REQUIRED` on a factor with no unit; historical import goes through the engine; every row carries `total_kgco2e` | ESG-lite | `s3-4-engine-integrity` (S3-4) | `scope3-probes` S3-06 (historical parity: the S3-4 test) | ⏸ planned | 2026-10-16 local: pass |
| S3-07 | Spend rows store the `fx` rate and date and are reproducible; `FX_RATE_FALLBACK` and `NO_DEFLATOR` warn | ESG-lite | spend tests (S3-5) | `scope3-probes` S3-07 | ⏸ planned | 2026-10-16 local: n/a (S3-5) |
| S3-08 | A supplier factor outside its boundary is `SUPPLIER_FACTOR_BOUNDARY`; hybrid allocates by the chosen key | ESG-lite, FE | supplier tests (S3-6) | `scope3-probes` S3-08 (manual once S3-6 lands, until the probe learns its API) | ⏸ planned | 2026-10-16 local: n/a (S3-6) |
| S3-09 | Cat 3 twins carry `scope3_sub`; `WTT_ALREADY_IN_FACTOR` warns on a Cat 4/9 WTT-inclusive factor; no total moves without the PR list | ESG-lite | `s3-7-fera-split` (S3-7, D6) | `scope3-probes` S3-09 | ⏸ planned | 2026-10-16 local: fail, F-22 (no warning on a category known by `ghg_category`) |
| S3-10 | Transport and warehousing forms compute their golden cases through the API | ESG-lite, FE | form tests (S3-8) | `scope3-probes` S3-10 | ⏸ planned | 2026-10-16 local: n/a (S3-8) |
| S3-11 | Travel and commuting forms compute their golden cases through the API | ESG-lite, FE | `s3-9-travel-commuting` (S3-9) | `scope3-probes` S3-11 | ⏸ planned | 2026-10-16 local: pass (ex-6.1, 7.1, 7.2) |
| S3-12 | Sold-products forms compute their golden cases through the API | ESG-lite, FE | `s3-10-sold-products` (S3-10) | `scope3-probes` S3-12 | ⏸ planned | 2026-10-16 local: pass (ex-10.1, 10.2, 11.1, 11.3, 12.1) |
| S3-13 | Leased assets, franchises and investments compute their golden cases through the API | ESG-lite, FE | `s3-11-assets` (S3-11) | `scope3-probes` S3-13 | ⏸ planned | 2026-10-16 local: pass (ex-8.1, 13.1, 14.1, 14.2, 15.1; 15.2 waits for S3-5) |
| S3-14 | Screening estimates never become rows; proxy rows are Pending, secondary and carry their basis | ESG-lite, FE | screening tests (S3-12) | `scope3-probes` S3-14 | ⏸ planned | 2026-10-16 local: n/a (S3-12) |
| S3-15 | `/reports/ghg/scope3` and the PDF carry checklist items R1–R10 or say "Not tracked" | ESG-lite, FE | `s3-13-reporting` (S3-13) | `scope3-probes` S3-15 (PDF text needs Chromium on the audit host, else the PDF's blocks from `dist`) | ⏸ planned | 2026-10-16 local: pass (R1 not read: no Chromium) |
| S3-16 | A base year freezes; a proposal at or above the threshold; approval re-freezes; rows untouched | ESG-lite, FE | base-year tests (S3-14) | `scope3-probes` S3-16 (manual once S3-14 lands, until the probe learns its API) | ⏸ planned | 2026-10-16 local: n/a (S3-14) |
| S3-17 | Every pending row carries checks of the §8 ids; ready filter and counts; "approve all ready" approves only ready rows | ESG-lite, FE | `s3-15-review` (S3-15·1) | `scope3-probes` S3-17 | ⏸ planned | 2026-10-16 local: pass |
| S3-18 | Drafts stay out of queues and reports; `PERIOD_LOCKED` on create, edit, delete, approve, reject, batch, import commit and MCP commit; unlock needs a reason | ESG-lite, FE | lock tests (S3-15·2) | `scope3-probes` S3-18 (manual once the lock lands, until the probe learns its API) | ⏸ planned | 2026-10-16 local: n/a (S3-15·2) |
| S3-19 | Company 2's token on company 1's ids answers 403 or 404 on every `/scope3/*`, `/periods/*` and `/reports/ghg/scope3` endpoint | ESG-lite | tenant-isolation tests (all) | `scope3-probes` S3-19 | ⏸ planned | 2026-10-16 local: pass (17 endpoints) |
| S3-20 | The role matrix holds for User, Manager, Admin and Superadmin | ESG-lite | role tests (all, D12) | `scope3-probes` S3-20 | ⏸ planned | 2026-10-16 local: pass (11 endpoints) |
| S3-21 | `migrate:all` runs twice clean with every `migrate:scope3-*` script; the second run changes nothing | ESG-lite | CI data-safety job (all) | `scope3-probes` S3-21 | ⏸ planned | 2026-10-16 local: pass (12 scripts) |
| S3-22 | One Scope 3 row typed, bulk, smart import and MCP gives the same `total_kgco2e`, `method` and `dq` | ESG-lite | parity tests (S3-3 to S3-11) | `scope3-probes` S3-22 (manual) | ⏸ planned | 2026-10-16 local: n/a (S3-3) |
| S3-23 | No sheet text, supplier names, prices or survey refs in the API or AI logs | ESG-lite, AI | layer rule 7 (all) | `scope3-probes` S3-23 (API log automatic; AI log manual) | ⏸ planned | 2026-10-16 local: API log clean; AI log not read |
| S3-24 | Scope 3 routes are in the sweep, in four themes, at 390 px, with no console errors | FE | `route-sweep.mjs` (S3-0 to S3-14) | `route-sweep` plus a look | ⏸ planned | |
| E2E-12 | A Scope 3 month end to end: contributor drafts and submits; manager approves ready rows, fixes a held one, locks the month; Admin screens, sets status, reads the report and the base year | all | manual on staging | walked by hand, dated here | ⏸ planned | |
```

### Other sections of e2e-workflow-audit.md (step 6)

- **§0.2** (harnesses), beside `xi-probes.cjs`:
  `- harness/scope3-probes.cjs <ESG-lite dir> <out.json>: Scope 3 rows S3-01 to S3-24 and E2E-12 (§14) and the live golden step (results/runs/<ts>-scope3-golden.json). Same guard as xi-probes (ci/lib/throwaway-db.cjs: CI_THROWAWAY_DB=true, local DB_HOST, DB_NAME ci_*), needs dist/ built; ports 3996/8997, golden snapshot on 3999 in <DB_NAME>_golden.`
- **§9** (findings): F-22, written out under "Findings"/"§9 finding to file".
- **§10** (modules and their rows): `- S3-0 to S3-15 (Scope 3, plan in /mnt/project-files/scope3/): rows S3-01 to S3-24 and E2E-12 in §14; each module owns the rows named in its "Own test" column.`
- **§11** (how a module's merge reaches the audit): `- Scope 3: no audit edit per merge; scope3-probes reads what the stack has built and flips the module's rows from n/a by itself. A golden case still skip after its owner is built fails S3-01.`

## run-audit.sh

One step after `xi-probes`, same summary line:

```sh
s scope3-probes "$(node "$AUDIT_DIR/harness/scope3-probes.cjs" "$ESG_LITE_DIR" "$RESULTS_DIR/runs/$TS-scope3-probes.json")"
```

The harness prints the summary in the step format
(`s scope3-probes "… pass / … fail / … error / … n/a / … manual"`); match
the surrounding steps' quoting and how they strip the leading `s `. Named
`$TS-scope3-probes.json`, it writes `$TS-scope3-golden.json` beside it.
Exit 1 only on a harness `error`.

## route-sweep.mjs

Add to the route list (S3-24); the first four exist on FE `production`
(`src/features/shell/routeMap.ts`), the rest arrive with their modules:

```js
"/settings/scope3",                 // S3-1 boundary
"/settings/scope3/commuting",       // S3-9
"/settings/scope3/sold-products",   // S3-10
"/settings/scope3/investments",     // S3-11
"/reports/ghg",                     // S3-13 Scope 3 and Methodology tabs (open each tab)
// "/settings/scope3/screening",    // S3-12, once routeMap has it
// "/suppliers",                    // S3-6, once routeMap has it
// "/data/approvals?view=close",    // S3-15 part 2 close month, once built
```

## Known gaps, for whoever places this

- Written against the shapes the spec and this handover describe, not
  against `xi-probes.cjs`, `run-audit.sh` or `route-sweep.mjs`, which no
  session in this lane could read (no copy in any ESG-lite ref). Check the
  helper names (`record` / `pass` / `na` / `manual` / `probe`), the JSON
  envelope (`{probe, counts, results}`) and the exit-code convention against
  `xi-probes.cjs` and adjust if they differ.
- `pg` and `jsonwebtoken` resolve from the ESG-lite checkout (no
  `node_modules` needed in the audit folder).
- The live golden step uses the typed path for every case; the plan paths
  (commuting survey, sold-products and investments plans) are covered by the
  owners' API tests, not by the probe.
- S3-08, S3-16 and S3-18 become `manual` (not `pass`) when their modules land,
  until someone teaches the probe the supplier, base-year and lock APIs.
- S3-15 reads R1 only from a rendered PDF; the audit host needs Playwright's
  Chromium (`npx playwright install chromium`) and `pdftotext`.
