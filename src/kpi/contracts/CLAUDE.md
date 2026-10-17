# KPI-0 · Contracts, docs copy, mocks and empty routers

> Module spec. Lane L1. Copy to `ESG-lite/src/kpi/contracts/CLAUDE.md` as the first commit. PR titles `[KPI-0 k/m]` (1/2 ESG-lite, 2/2 ESG-lite_FE + python root snippet).
> Depends on: — · Owns: `src/kpi/contracts/*`, `src/kpi/router.ts` (empty), `docs/kpi/*`, FE `src/lib/kpi/contracts.ts` + `labels.ts`, `src/features/kpi/routes.tsx` (empty), `src/test/msw/kpi.ts` · Touches: the three root `CLAUDE.md` files

## Job to be done
Every other lane can start on day one against fixed names, shapes and codes, with mocks that answer every endpoint.

## Today
- No KPI, framework or materiality code exists in any repo (survey 2026-10-17: no GRI, BRSR, ESRS or CSRD hits).
- Patterns to copy:
  - `src/scope3/contracts/*` for contracts;
  - the `src/scope3/router.ts` mount in `src/index.ts`;
  - the FE `src/lib/scope3/contracts.ts`;
  - `src/test/msw/scope3.ts`.

## Build
### Backend (ESG-lite)
1. Copy `plans/kpi/*` to `docs/kpi/` (README, 00–05, layers, modules) and add the `## KPI tracking` block from `02-root-claude-snippets.md` to the root `CLAUDE.md`.
2. `src/kpi/contracts/`:
   - `enums.ts` (01-contracts §1 as `as const` arrays plus types);
   - `errors.ts` (§4: code → status, a `KpiError` class, `sendKpiError`);
   - `checks.ts` (§5);
   - `schemas.ts` (zod for every §3 request body and query);
   - `labels.ts`;
   - a unit test that the FE copy matches (`ci/unit/kpi-contracts.test.cjs` reads the FE file's exported arrays from a fixture, as the S3 contracts test does).
3. `src/kpi/router.ts`, mounted at `/kpi` in `src/index.ts`, with `GET /kpi/status` answering `{enabled:false, setup_completed:false}` until KPI-1. Copy `layers/ESG-lite-src-kpi/CLAUDE.md` to `src/kpi/CLAUDE.md`.

### Frontend (ESG-lite_FE)
1. `src/lib/kpi/contracts.ts` and `labels.ts`, with unit tests for labels (every enum value has a label).
2. `src/features/kpi/routes.tsx` with no pages yet. Copy the layer file to `src/features/kpi/CLAUDE.md`. Add the root snippet.
3. `src/test/msw/kpi.ts`: handlers for every §3 endpoint with realistic data. Use two sites, GRI + BRSR + ESRS, 30 KPIs (8 auto, 4 formula), and a September with 4 due, 1 sent back and 7 done. Register them in the MSW server.

### AI service
1. Add the root snippet. Copy the python layer file to `app/kpi/CLAUDE.md` (empty package).

## Tests
- The contracts parity unit test.
- `GET /kpi/status` as each role.
- Every MSW handler returns data that matches its TypeScript type (a vitest that parses each through the zod-mirrored types).

## Out of scope
Any table, migration or UI page.

## Done when
`docs/kpi/` is the plan of record in ESG-lite. Contracts exist in both repos and match. Every lane can mock every endpoint.
