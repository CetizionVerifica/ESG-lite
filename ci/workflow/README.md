# End-to-end data workflow test

One local run onboards a brand-new client through the API, in the order of the
client onboarding workflow (Superadmin → client Admin → Manager → Users), and
checks that every stored row, every Category 3 twin and every report figure is
the tCO₂e worked out by hand in `scenario.cjs`. It answers one question after a
lane: **does the data still flow correctly from setup to the report?**

## Run it

```bash
bash ci/workflow/local.sh            # creates ci_workflow if needed, builds, runs
```

or, with your own throwaway Postgres:

```bash
createdb ci_workflow
export CI_THROWAWAY_DB=true DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres DB_NAME=ci_workflow TZ=UTC
npm run build && npm run test:workflow
```

It refuses any database that isn't a local `ci_*` one (`ci/lib/throwaway-db.cjs`), empties it,
builds the schema from `dist/` and runs `migrate-all` as a deploy does. It needs no network.
About 15 seconds. The API runs on port 3997; set `WORKFLOW_PORT` if that port is taken.

## Rule: run it after every lane

- Every lane (Scope 3, simple entry, or any module that touches setup, entry, the engine, review or reports)
  runs `bash ci/workflow/local.sh` on its branch, with `production` merged in, before it asks for review,
  and says "Workflow test: N passed, M skipped" in its last PR body.
- A red step blocks the PR, exactly like a failing API test. Fix the code, or, if the workflow itself
  changed on purpose, change `scenario.cjs` and list the moved figures in the PR.
- **The lane that builds a module turns its skipped step into real checks** in the same PR. Skipped steps
  name the module they wait on (`# waits on S3-12`). A new calculation adds its inputs and hand-worked kg to
  `scenario.cjs`; never read an expected figure back from the engine.

## What it checks

| Step | Role | Checks |
|---|---|---|
| 0.1–0.3a | Superadmin | categories keep their GHG numbers (a Scope 1 category can't take one); country; USEEIO library loaded by the deploy; the deploy seeded the price index for the spend year |
| 1–5 | Superadmin | onboarding creates the company, main site and Admin, who can sign in; Smart import and Claude imports start off |
| 6–7 | Superadmin | second site; categories assigned to both sites |
| 10 | Admin | 15 boundary rows, 13–15 start Not relevant, an exclusion needs a reason, every category in use has its number and is Included, consolidation approach saved |
| 11–12 | Superadmin | site factors for both factor years (with Category 3 WTT and T&D factors); USEEIO sector copied to a site |
| 15a | deploy | the next deploy adds the standard Category 6 form and its DEFRA 2025 factors |
| 20 | Admin | Manager and Users invited and signed in; a User gets their sites' categories |
| 25–25d | Users | every row's tCO₂e, its 3a/3b/3c twins, a Category 6 flight, a Category 1 INR spend row (rate on the invoice date, deflated); a User can't enter for another site or approve |
| 26–26c | Manager | approve, reject and pending rows (twins follow their parent); Scope 3 table per category (kg summed then rounded), statuses and reasons, GWP sets; Scope 1/2/3 totals; another client sees nothing |
| 24 | Admin | base year preview per category, only the Admin freezes it |
| 27 | audit | when `audit/harness/scope3-probes.cjs` is reachable (`SCOPE3_PROBES`, the shared audit folder or this checkout): the S3-16 probes in a scratch `<DB_NAME>_probes` database with the API fixture and their own server (`SCOPE3_PROBE_PORT`, default 3996); red on a harness error, `fail` rows listed (red with `SCOPE3_PROBES_STRICT=1`) |
| skipped | — | 5a SE-2, 5b S3-15 parts 3–4, 9 S3-12, 14 S3-6, 16–17 and 25e S3-3, 18 SE-4 |

Front-end checks (what a User sees, SE-1) belong to the Playwright tests in ESG-lite_FE, not here.

## Facts the test pins down (true on `production` today)

- **Factor year.** A row uses the factor of the year before its calendar year
  (`emissionWrite/resolve.ts` `targetYearFor`): April–December 2025 rows use 2024 factors,
  January–March 2026 rows use 2025 factors. A financial year needs factors for two years.
- **Reports name a financial year by the year it ends.** April 2025 – March 2026 is FY 2026.
- **Category 3 has no fallback year.** The main factor falls back to the nearest year with a warning;
  a missing FERA factor year means no Category 3 row at all (`FERA_FACTOR_MISSING` warning only).
- **The FERA category is found by its name**, "FERA", on the site (`emissionWrite/context.ts`).
- **A T&D-loss factor needs its own name** ("… T&D losses") and the activity as its global name. The
  single-factor create has no global name, so it must come through the factor import.
- **US CPI-U is seeded through 2025** (`migrate:scope3-spend`). A year without an index isn't deflated
  (`NO_DEFLATOR` warning) until a Superadmin adds it (`POST /scope3/deflators`).
- **USEEIO library factors have no GWP set**, so the report's GWP list doesn't name one for spend rows.
- **People get their sites' categories when they are invited**, so sites and categories come before people.
- **Standard Scope 3 forms (Categories 6, 7, 8, 13, 14) arrive with the next deploy**, not when a
  category is assigned.

## Files

- `run.cjs` boots the stack on the empty database and runs the test.
- `workflow.test.cjs` the steps, numbered as in the onboarding workflow document.
- `scenario.cjs` the client, its inputs and the hand-worked figures.
- `lib.cjs` sign-in, HTTP, database and redeploy helpers.
- `local.sh` one command for a laptop.
