# src/studio (ESG-lite): Design Studio backend layer

> **Layer spec.** Goes to `ESG-lite/src/studio/CLAUDE.md`.
> **Read it** after the root CLAUDE.md and `docs/design-studio/00-plan.md`, `01-contracts.md` and `04-decisions.md`, then your module's CLAUDE.md.
> **Base:** `docs/design-studio/rs-base/layers/ESG-lite-src-kpi-studio/CLAUDE.md`. Its rules hold, with paths moved from `src/kpi/studio` to `src/studio`.

## Shape
```
src/studio/
  CLAUDE.md
  contracts/     enums, schema (zod, ReportDoc v2 + v1 upgrader), sources, errors, checks, ai (DS-0)
  router.ts      mounted at /studio in src/index.ts; authenticate → requireDesignStudio; kind guard per doc (DS-0)
  guard.ts       requireDesignStudio, requireKind(doc|body) → requireKpiTracking for 'sustainability' (DS-0)
  sources/       resolve.ts (dispatch by source) · ghg.ts · kpi.ts · inputs.ts · derived.ts · hash.ts (DS-2)
  brandkit/      brand kit read/write, palettes, style presets (DS-3)
  library/       templates, layouts, elements, assets, seeds loader (DS-4)
  docs/          CRUD, autosave, readiness (per kind), auto-build, duplicate (DS-5)
  resize/        format mapping, element transfer, AI summarise hook (DS-10)
  jobs/          enqueue, worker, R2 keys, versions, PDF/PNG download (DS-11)
  share/         share links, public viewer (DS-11)
  ai/            actions, prompts (per kind), chat router, schemas, token guard, budget (DS-9)
  checks/        layout.ts, number.ts, ghg.ts, sustainability.ts, gate.ts (DS-12)
  collab/        comments, mentions, tasks, approvals, history, drift, template locks (DS-13)
```

## Rules
1. **Tenant first.** Every query filters by `company_id` from the session (Superadmin: from the route), and by `accessibleSiteIds` for site lists. An id from another company answers 404 (`DS_DOC_NOT_FOUND`), never 403.
2. **Kind guard.** Any handler that loads a doc calls `requireKind(doc)`. Creating a doc checks `body.kind`. A sustainability doc for a company with KPI tracking off answers `DS_KIND_OFF`, even when reached by id.
3. **Data is read, never written.** `sources/ghg.ts` calls `computeGhgTables`, `computeScope3`, `computeGhgByFuelType`, `getPeriodRange` and the base-year service exactly as `/reports/ghg` does, with the same filters. EDE intensity is reached through an extracted pure helper (DS-2 moves the logic out of `emission.controller.ts` into `src/reporting/intensity.ts` with identical output, and a golden proves it). No studio code writes to `emission`, `kpi_*` or `company_base_year`.
4. **Approved only.** Sources use approved rows and approved KPI values. Pending counts appear only in readiness and checks.
5. **The data hash** is `sha256(sorted resolved values + inputs + period + sites)`. It is stored on autosave and versions. A final stores the full `data_snapshot` (RS R18).
6. **Docs are whole-JSON with `rev`** (optimistic). PATCH validates with zod and caps at 2 MB. Autosave snapshots for version history are made by `collab/history.ts`, never by the client.
7. **AI** goes through `src/lib/openrouter.ts` only, with prompts in `ai/prompts/<kind>/`. Report text and brand voice are fenced as untrusted data. Output is checked by the token guard and logged in `report_ai_call`.
8. **Errors** use `{code, message, details}` with codes from `contracts/errors.ts` only.
9. **Migrations** are `src/scripts/migrateDs<N><Name>.ts`, idempotent, registered as `migrate:ds-<n>-<name>`, and run twice in CI.
10. **Tests:** `ci/api/tests/ds-<n>-*.test.cjs` covering tenant isolation, roles, switch-off and kind-off for every endpoint; `ci/unit/ds-*.test.cjs` for pure logic. GHG source goldens compare against `/user/ghg/tables` for the seed companies.
