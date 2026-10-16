# src/scope3 (ESG-lite) — Scope 3 backend layer

> Layer spec. Goes to `ESG-lite/src/scope3/CLAUDE.md`. Read it after the root CLAUDE.md, `docs/scope3/00-plan.md`, `01-contracts.md` and `04-decisions.md`, and before your module folder's CLAUDE.md.

## Shape
```
src/scope3/
  CLAUDE.md        this file
  contracts/       ghgCategory.ts factor.ts dq.ts errors.ts checks.ts schemas.ts (S3-0)
  router.ts        mounted once at /scope3 by S3-0; one router.use per module
  taxonomy/  boundary/        S3-1
  dq/                          S3-3 (defaults.ts, score.ts)
  spend/                       S3-5 (fx job, deflator, eeio lookup)
  suppliers/                   S3-6
  commuting/                   S3-9
  soldProducts/                S3-10
  assets/                      S3-11 (leases, franchises, investments)
  screening/                   S3-12
  baseYear/                    S3-14
  review/                      S3-15 (checks.ts, service.ts, lock.ts, periodLock.ts, guard.ts, workflow.ts, liveChecks.ts, evidence.ts; /periods router)
```
Each module folder has `router.ts`, `controller.ts`, `service.ts`, `CLAUDE.md` (the module spec copy) and tests in `ci/api/tests/s3-<n>-*.test.cjs` and `ci/unit/scope3-<name>.test.cjs`.

## Rules
1. **Calculation stays in `src/services/emissionWrite/methods/`.** The modules here prepare inputs (a supplier factor, an FX rate, a deflator, a proxy basis) and pass them to the engine through the row or the context. They never multiply activity by a factor themselves. The only exception is S3-12 screening estimates, which are shown as estimates and never saved as emission rows.
2. **Company scoping in SQL.** Every query filters by the caller's `company_id` (Superadmin passes `company_id`). Another company's id gives 404.
3. **Roles.** Read: any role with access to the company's sites. Boundary, exclusions and base year: Admin and Superadmin (D12). Suppliers and locks: Manager and above, for their own sites.
4. **Validation** with the zod schemas from `contracts/schemas.ts`. Errors use the codes in `contracts/errors.ts`, in the shape `{code, message, details}` used by `src/imports/errors.ts`.
5. **Migrations:** `src/scripts/migrateScope3<Thing>.ts`, idempotent, registered as `migrate:scope3-<thing>` and in `scripts/migrate-all.cjs`. Backfills are batched (1,000 rows) and re-runnable.
6. **Audit:** changes to boundary, base year, locks and supplier factors write `audit_log` rows (entity_type `scope3_*`) with old and new values and the reason.
7. **Logging:** ids and codes only, never supplier names, prices or quantities.
8. **Imports between modules:** everyone may import `contracts/`. `review/` may read `dq/`. `screening/` may read `spend/` and `boundary/`. Nothing imports from `controllers/`.
9. **Tests every module adds:** tenant isolation, role matrix, every new error code, migration run twice, and the module's golden cases switched from `skip` to `run`.
