# S3-0 · Contracts, golden cases, engine split

> Module spec. Lane L1. Copy to `ESG-lite/src/scope3/contracts/CLAUDE.md` as the first commit. PR titles `[S3-0 k/m] …` (1/3 ESG-lite, 2/3 ESG-lite_FE, 3/3 python_AI_service root block only).
> Depends on: nothing · Owns: `src/scope3/contracts/*`, `src/scope3/router.ts`, `ci/golden/scope3/*`, `docs/scope3/*`, `emissionWrite/methods/` split, root CLAUDE.md blocks · Touches: `package.json` scripts, `src/index.ts` (one mount)

## Job to be done
Give every other lane one shared vocabulary (categories, methods, factor types, DQ, codes, check ids), a place to plug in each calculation method, and a golden test set from the guidance's own worked examples, so six lanes can build in parallel without colliding.

## Build
### Backend (ESG-lite)
1. Already done (2026-10-15, plan PRs): `docs/scope3/` is in ESG-lite, the root `CLAUDE.md` blocks and the layer `CLAUDE.md` files are in all three repos. Start at step 2.
2. `src/scope3/contracts/`: `ghgCategory.ts` (the §1 table as a typed const: n, key, name, direction, methods in specificity order, plain labels), `factor.ts` (§2 enums and the allowed-types map), `dq.ts` (§3 types plus `overallOf()`), `errors.ts` (§7 codes, in the `src/imports/errors.ts` shape), `checks.ts` (§8 ids), `schemas.ts` (zod for every §4 column and §5 body). Unit tests: every Scope 3 category has ≥1 method, and the keys are unique.
3. `src/scope3/router.ts`, mounted once at `/scope3` in `src/index.ts`, behind `authenticate`. It's empty until the modules add routes.
4. **Engine split, with no behaviour change:** move the bodies of `compute.ts` into `emissionWrite/methods/activity.ts`, `spec.ts` and `fera.ts`. Leave `compute.ts` as a dispatcher (`01-contracts.md` §6). Add stub files `spend.ts`, `supplier.ts`, `hybrid.ts` and `proxy.ts`, which fall back to `activity` and add a TODO line naming the owning module. `ComputedRow` gains the optional fields (`total_kgco2e`, `method`, `dq`, `data_type`), still unset here. `ci/golden` must be byte-identical: run it before and after, and paste both hashes in the PR.
5. `ci/golden/scope3/cases.json`: transcribe the worked examples listed in `01-contracts.md` §9 from `reference/scope3-calculation-guidance.txt` (search "Example [") with `guidance_ref` (example number and line), inputs, factors and the expected kgCO₂e as printed. Every case starts `"status": "skip"`, with `owner` set to the S3 module that will run it. Add `ci/golden/scope3/run.cjs`, which runs the `run` cases through `computeRow` with an in-memory context and fails on more than 0.5 kg difference or 0.1 % (whichever is larger).
6. `package.json`: scripts `test:scope3-golden`. Add the step to CI.

### Frontend (ESG-lite_FE)
1. Paste the FE block into the root CLAUDE.md. Add `src/lib/scope3/contracts.ts` (types plus label maps from the same table: `categoryLabel(n)` → "Category 1 · Purchased goods and services", `methodLabel(key)`, `dqLabel(score)`).
2. `src/features/scope3/routes.tsx`, registered per `src/features/README.md`. Add a "Scope 3" item under Settings (Admin and Superadmin) that shows the placeholder until S3-1 lands.
3. `src/test/msw/scope3.ts`: mock handlers for every `01-contracts.md` §5 endpoint with realistic sample data, so waiting lanes can build their FE parts.
4. Add `src/lib/scope3` and `src/features/scope3` to `lint:new`.

### AI service
Root CLAUDE.md block only.

## Golden cases
None run here. The file exists with every case skipped and owned.

## Tests
Contracts unit tests. The golden suite hash is unchanged. The MSW handlers type-check against `src/lib/scope3/contracts.ts`.

## Done when
- `docs/scope3/` and all three root blocks are merged.
- `compute.ts` dispatches to `methods/*`, with the existing golden totals unchanged (hashes in the PR).
- `cases.json` holds at least 15 transcribed examples, each with its line ref and owner.
- FE labels and MSW mocks exist, and the nav placeholder shows for Admin.
