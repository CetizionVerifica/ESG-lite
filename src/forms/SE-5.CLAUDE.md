# SE-5 · Migrate existing forms

> Module spec. ESG-lite. PR title `[SE-5 1/1] …`, `Completes: SE-5`.
> Depends on: SE-3 · Owns: `src/scripts/migrateEntryForms.ts` (`migrate:entry-forms-data`)

## Job to be done
Forms that make Users pick a method today move to the new model without changing any stored total.

## Build
1. Idempotent, additive script registered as `migrate:entry-forms-data`, so `migrate-all` applies it on start (no hand-run step; it runs on staging and later on the real prod DB). It only changes `column_config` rows; it never touches emission rows. `--dry-run` is an opt-in flag that lists every form it would change.
2. `per_method` specs with `method_column: "@method"` (S3-9 travel/commuting from `migrateScope3Travel.ts`; S3-10 Cat 10/12 from `soldProducts/configs.ts`, merged): one method → `method_options: [{ method: m, units }]`; several → add a select column "What does your record show?" with plain choices (e.g. "Trip distance", "Fuel used", "Amount spent"), `method_by_choice`, and point `method_column` at it. Existing rows keep `activity_data["@method"]`; the engine still reads it for old rows.
3. Transport `per_unit` forms (S3-8): set `method_options` from the unit → method list in `transport/configs.ts`.
4. Spend: forms whose extras include `spent_value` + `currency` and whose method is spend get the spend recipe fields.
5. Inside the same run, before committing: recompute every row of each migrated form with the old and the new config, **in memory only** (never write a recomputed total or factor snapshot; stored totals stay as they are). Any difference rolls back that run's transaction, logs the form ids as a warning (ids only) and **exits 0**: `migrate-all` stops at the first non-zero exit, so a failure here must never stop the API from starting. The next start tries again.

## Tests
Script twice → no second change; dry run changes nothing; a seeded total difference → rolled back, warning logged, exit code 0; golden unchanged.

## Done when
No live form uses `@method` and no differences are logged on staging.
