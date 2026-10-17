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
| 1–5b | Superadmin | onboarding creates the company, main site and Admin, who can sign in; Smart import, Claude imports and review workflow v2 start off (no month can be closed) |
| 6–7 | Superadmin | second site; categories assigned to both sites |
| 9 | Admin | screening for FY 2026: 15 rows; a Category 7 headcount saved for FY (CY 2026 stays empty) gives the hand-worked commute estimate (not saved as a row); a Table II tick on Category 6 suggests Included; the suggestion is applied only by the Admin's own boundary change |
| 10 | Admin | 15 boundary rows, 13–15 start Not relevant, an exclusion needs a reason, every category in use has its number and is Included, consolidation approach saved |
| 11–12 | Superadmin | site factors for both factor years (with Category 3 WTT and T&D factors); USEEIO sector copied to a site |
| 14 | Admin (for the Manager) | a supplier and its own cradle-to-gate figure; a figure that isn't cradle-to-gate is refused without `confirm_boundary` (S3-6) |
| 15a | deploy | the next deploy adds the standard Category 6 form and its DEFRA 2025 factors |
| 20 | Admin | Manager and Users invited and signed in; a User gets their sites' categories |
| 25–25f | Users | every row's tCO₂e, its 3a/3b/3c twins, a Category 6 flight, a Category 1 INR spend row (rate on the invoice date, deflated); a User can't enter for another site or approve; a Category 1 purchase with the supplier's own figure (quantity × figure, supplier and snapshot on the row; another client's supplier refused) |
| 26–26d | Manager | approve, reject and pending rows (twins follow their parent); Scope 3 table per category (kg summed then rounded), statuses and reasons, GWP sets; Scope 1/2/3 totals; supplier coverage of Categories 1–2 and the top suppliers; another client sees nothing |
| 24 | Admin | base year preview per category, only the Admin freezes it |
| 29a–29e | Superadmin, User, Manager | review workflow v2 on: a User's August rows (and twins) are Drafts the Manager doesn't see; the month can't close while Drafts or missing categories are left; submit makes them Pending with one notification; "Nothing this month" and approval complete it; the Manager closes it; a closed month refuses writes with `PERIOD_LOCKED` until reopened with a reason |
| skipped | — | 5a SE-2, 18 SE-4, 27 S3-16 |

## Every category (`categories.test.cjs`)

Runs after the workflow on the same stack, for a second client that reports every Scope 1 and Scope 2
source and all 15 Scope 3 categories. For each category the Superadmin sets up the client's own
activities (or the deploy seeds the standard form), the User sees that activity in their list
(`GET /user/emission-factors/site/:site/category/:category`), picks it and enters a month, and the
stored tCO₂e, its Category 3 rows, the approval and both reports match the kg in `categories.scenario.cjs`.
Each category is its own test, so one broken category doesn't hide the others.

| Category | Entry | Hand-worked figure |
|---|---|---|
| Scope 1 stationary, mobile | litres (mobile in kl, converted), + 3a twin | litres × combustion factor |
| Scope 1 refrigerants, process | kg leaked × GWP; kg of limestone against a per-tonne factor | |
| Scope 2 electricity, steam | kWh, + 3b and 3c twins; steam in MWh against a per-kWh factor, + 3b | |
| 1, 2 | average-data, tonnes against a per-kg factor | |
| 3 | the twins of the Scope 1 and 2 rows | sum of the twins |
| 4, 9 | tonne.km (9 in kg.km, converted) | |
| 5 | kg of waste against a per-tonne factor | |
| 6, 7 | standard forms: hotel nights; commuting average-data | seeded DEFRA 2025 values |
| 8 | lease form, sub-metered electricity × area share | |
| 10, 11, 12 | sold-products forms: site-specific processing; refrigerant released (AR6); end of life | seeded AR6 / DEFRA values |
| 13, 14, 15 | asset forms: tenant, franchise sample and investee reported emissions | identity factors |

Spend, supplier-specific and hybrid rows are covered in the workflow (Category 1 spend) or wait on
S3-6; the transport and waste standard forms wait on S3-8. Those lanes add their rows to `ROWS`.

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
- `categories.test.cjs` and `categories.scenario.cjs` every category, one row each.
- `lib.cjs` sign-in, HTTP, database and redeploy helpers.
- `local.sh` one command for a laptop.
