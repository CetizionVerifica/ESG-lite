# S3-16 · ready to place in the shared audit folder

Built and tested from the local ESG-lite checkout, but **nothing here is in a
repo**: every file S3-16 owns lives in `/mnt/project-files/audit/`, which this
session cannot reach. Place these from a session that has the audit folder
mounted.

| This file | Goes to |
|---|---|
| `scope3-probes.cjs` | `/mnt/project-files/audit/harness/scope3-probes.cjs` |
| the module spec | `/mnt/project-files/audit/harness/scope3-probes.CLAUDE.md` (copy of `docs/scope3/modules/S3-16-audit-probes/CLAUDE.md`) |
| §14 below | appended to `/mnt/project-files/audit/e2e-workflow-audit.md` |
| the `run-audit.sh` line below | after the `xi-probes` step |
| the route list below | `/mnt/project-files/audit/harness/route-sweep.mjs` |

## What was verified

Run twice in a row against a throwaway Postgres and the compiled ESG-lite
stack, with the branch of S3-3 part 1 in `dist`:

```
s scope3-probes "3 pass / 0 fail / 0 error / 19 n/a / 3 manual"
exit=0
```

- Both runs byte-identical; the fixture is reused, not duplicated.
- 25 rows: S3-01 to S3-24 and E2E-12.
- Every one of the 19 `na` rows names the module that owes it.
- Zero `error`, exit 0 — a `fail` belongs to the owning lane, so only a
  harness error stops the audit.

Three rows ran for real because this checkout carries S3-3 part 1: S3-05
(method on every Scope 3 row), S3-19 (tenant isolation on the routes that
exist) and S3-21 (`migrate:scope3-row-quality` twice clean). Against today's
`production` head, S3-05 and S3-21 go back to `na`, which is what the spec's
acceptance test asks for.

Four things the local run settled, each of which would have made the probe lie:

1. The golden suites seed their own companies, so they need a database of
   their own — run in the probe's database they collide with the shared
   fixture. They also need `ci/schema-sync.cjs` first, the way the CI job
   does it.
2. The stack under audit has to be migrated before any row is judged
   (production runs `migrate:all` on container start), or S3-05 reports a
   backfill as missing only because nothing had run it yet.
3. Route detection has to ask with a token. An anonymous 401 says nothing,
   and `/reports/ghg/scope3` is answered today by the existing
   `/reports/ghg/*` prefix, so only the authenticated answer separates
   "built" from "not built".
4. A thing that is not built yet is `na` naming its module, never `fail` —
   including a missing `ci/golden/scope3/cases.json`.

## §14 for e2e-workflow-audit.md

Rows in the doc's own format, Pre-audit ⏸ planned, Result blank until the
hourly audit fills it.

```markdown
## 14. Scope 3 (GHG Protocol categories) — modules S3-0–S3-15

The Scope 3 plan lives at `/mnt/project-files/scope3/` (plan, contracts,
decisions, one spec a module). Harness: `audit/harness/scope3-probes.cjs`
(`node audit/harness/scope3-probes.cjs <ESG-lite dir> <out.json>`), run from
`run-audit.sh` after `xi-probes`. Extra setup: it builds the schema from
`dist/`, loads `ci/api/fixture.sql` when the database is empty, and runs every
`migrate:scope3-*` script, so the rows are judged on a migrated stack. The
golden suites run in a database of their own. A row whose module has not
merged is `na` and names the module that owes it.

| # | Expected behaviour | Layers | Own test (module) | Audit check | Pre-audit | Result |
|---|---|---|---|---|---|---|
| S3-01 | Every worked example the app supports reproduces to the kgCO₂e; `ci/golden` stays byte-identical unless the PR lists the changes | ESG-lite | `ci/golden/run.cjs`, `test:scope3-golden` (all) | `scope3-probes` S3-01 | ⏸ planned | |
| S3-02 | Every Scope 3 category carries a number 1–15 or reads Unmapped; `scope` is one of the four values | ESG-lite | taxonomy unit tests (S3-1, S3-4) | `scope3-probes` S3-02 | ⏸ planned | |
| S3-03 | 15 boundary rows a company; an exclusion with no reason is `EXCLUSION_REASON_REQUIRED`; a Manager PUT is 403 | ESG-lite, FE | boundary API tests (S3-1, D12) | `scope3-probes` S3-03 | ⏸ planned | |
| S3-04 | New factors carry type, GWP set, geography and dataset; the snapshot copies them; `FACTOR_TYPE_MISMATCH` only warns | ESG-lite, FE, AI | factor API tests (S3-2) | `scope3-probes` S3-04 | ⏸ planned | |
| S3-05 | Every new Scope 3 row from every channel carries a method, a DQ and a data type; old rows are backfilled | ESG-lite | `ci/api/tests/s3-3-row-quality.test.cjs` (S3-3) | `scope3-probes` S3-05 | ⏸ planned | |
| S3-06 | `UNIT_REQUIRED` on a factor with no unit; historical import goes through the engine; every row carries `total_kgco2e` | ESG-lite | engine tests (S3-4) | `scope3-probes` S3-06 | ⏸ planned | |
| S3-07 | Spend rows store the `fx` rate and date and are reproducible; `FX_RATE_FALLBACK` and `NO_DEFLATOR` warn | ESG-lite | spend tests (S3-5) | `scope3-probes` S3-07 | ⏸ planned | |
| S3-08 | A supplier factor outside its boundary is `SUPPLIER_FACTOR_BOUNDARY`; hybrid allocates by the chosen key | ESG-lite, FE | supplier tests (S3-6) | `scope3-probes` S3-08 (manual until the API lands) | ⏸ planned | |
| S3-09 | Cat 3 twins carry `scope3_sub`; `WTT_ALREADY_IN_FACTOR` warns; no total moves without the PR list | ESG-lite | FERA tests (S3-7, D6) | `scope3-probes` S3-09 | ⏸ planned | |
| S3-10 | Transport and warehousing forms compute their golden cases through the API | ESG-lite, FE | form tests (S3-8) | `scope3-probes` S3-10 | ⏸ planned | |
| S3-11 | Travel and commuting forms compute their golden cases through the API | ESG-lite, FE | form tests (S3-9) | `scope3-probes` S3-11 | ⏸ planned | |
| S3-12 | Sold-products forms compute their golden cases through the API | ESG-lite, FE | sold-products tests (S3-10) | `scope3-probes` S3-12 | ⏸ planned | |
| S3-13 | Leased assets, franchises and investments compute their golden cases through the API | ESG-lite, FE | asset tests (S3-11) | `scope3-probes` S3-13 | ⏸ planned | |
| S3-14 | Screening estimates never become rows; proxy rows are Pending, secondary and carry their basis | ESG-lite, FE | screening tests (S3-12) | `scope3-probes` S3-14 | ⏸ planned | |
| S3-15 | `/reports/ghg/scope3` and the PDF carry checklist items R1–R10 or say "Not tracked" | ESG-lite, FE | report tests (S3-13) | `scope3-probes` S3-15 | ⏸ planned | |
| S3-16 | A base year freezes; a proposal at or above the threshold; approval re-freezes; rows untouched | ESG-lite, FE | base-year tests (S3-14) | `scope3-probes` S3-16 (manual until the API lands) | ⏸ planned | |
| S3-17 | Every check id is held and released; "approve all ready" approves only ready rows | ESG-lite, FE | review tests (S3-15·1) | `scope3-probes` S3-17 | ⏸ planned | |
| S3-18 | Drafts stay out of queues and reports; `PERIOD_LOCKED` on create, edit, delete, approve, reject, batch, import commit and MCP commit; unlock needs a reason | ESG-lite, FE | lock tests (S3-15·2) | `scope3-probes` S3-18 (manual until the lock lands) | ⏸ planned | |
| S3-19 | Company 2's token on company 1's ids answers 403 or 404 on every `/scope3/*`, `/periods/*` and `/reports/ghg/scope3` endpoint | ESG-lite | tenant-isolation tests (all) | `scope3-probes` S3-19 | ⏸ planned | |
| S3-20 | The role matrix holds for User, Manager, Admin and Superadmin | ESG-lite | role tests (all, D12) | `scope3-probes` S3-20 | ⏸ planned | |
| S3-21 | `migrate:all` runs twice clean with every `migrate:scope3-*` script | ESG-lite | CI data-safety job (all) | `scope3-probes` S3-21 | ⏸ planned | |
| S3-22 | One Scope 3 row typed, bulk, smart import and MCP gives the same `total_kgco2e`, `method` and `dq` | ESG-lite | parity tests (S3-3 to S3-11) | `scope3-probes` S3-22 (manual) | ⏸ planned | |
| S3-23 | No sheet text, supplier names, prices or survey refs in the API or AI logs | ESG-lite, AI | layer rule 7 (all) | `scope3-probes` S3-23 (manual) | ⏸ planned | |
| S3-24 | Scope 3 routes are in the sweep, in four themes, at 390 px, with no console errors | FE | `route-sweep.mjs` (S3-0 to S3-14) | `route-sweep` plus a look | ⏸ planned | |
| E2E-12 | A Scope 3 month end to end: contributor drafts and submits; manager approves ready rows, fixes a held one, locks the month; Admin screens, sets status, reads the report and the base year | all | manual on staging | walked by hand, dated here | ⏸ planned | |
```

Also add, as step 6 of the spec asks:

- §0.2: a line for `scope3-probes.cjs` beside `xi-probes.cjs`, with the same
  two arguments and the throwaway-database guard.
- §10/§11: a line each for the S3 modules, pointing at §14.

## run-audit.sh

One step after `xi-probes`, same summary line:

```sh
s scope3-probes "$(node "$AUDIT_DIR/harness/scope3-probes.cjs" "$ESG_LITE_DIR" "$RESULTS_DIR/runs/$TS-scope3-probes.json")"
```

The script already prints the summary in `run-audit.sh`'s own format
(`s scope3-probes "… pass / … fail / … error / … n/a / … manual"`), so the
step only has to pass it through — match the surrounding steps' quoting.

## route-sweep.mjs

Add to the route list (S3-24):

```js
"/settings/scope3",
"/settings/scope3/screening",
"/settings/scope3/sold-products",
"/settings/scope3/investments",
"/settings/scope3/commuting",
"/suppliers",
// the close-month view, once S3-15·2 names its path
```

## Known gaps, for whoever places this

- The probe was written against the shapes the spec describes, not against
  `xi-probes.cjs` itself, which this session cannot read. Check the helper
  names (`record` / `pass` / `na` / `manual` / `probe`), the JSON envelope and
  the exit-code convention against that file and adjust if they differ.
- Step 3's live golden runner is stubbed where it needs endpoints that do not
  exist yet: S3-01 runs `ci/golden/run.cjs` and `test:scope3-golden`, but
  posting each `run` case through `POST /user/emissions` and writing
  `audit/results/runs/<ts>-scope3-golden.json` needs `cases.json` from S3-0
  before it can be written against anything real.
- `jsonwebtoken` and `pg` are required from the harness's own folder; the
  local run used `NODE_PATH=<ESG-lite>/node_modules`. Check how the other
  probes resolve theirs.
