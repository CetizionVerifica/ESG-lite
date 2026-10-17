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

## As built (2026-10-17)
- **`src/forms/migrateForms.ts`** (pure): `planFormMigration(form, questionColumn)` → what to write, a reason the form can't be moved, or null (already in the new model).
  - **"@method" formula, several methods**:
    - Adds the library select "Record type" (created once, as SE-3's builder adds it), with the label "What does your record show?" (`field_settings`).
    - Its answers' **ids are the method keys** and their labels describe the record ("Trip distance", "Fuel used", "Amount spent", "Average figures", "Waste by treatment", …). The formula keeps its keys; only `method_column` moves to the question.
    - Also writes `method_by_choice` (answer → method) and `method_options`.
  - **"@method" formula, one method**: only `method_options`. SE-2 fixes the method, and "@method" stays the row's.
  - **`method_options` when the form has none**: the category's list from the module that wrote the standard form (travel 6/7, sold products 10–12, transport 4/9), kept to the formula's methods. When a method's units can't be told, the form is left as it is, with the reason logged.
  - **Transport forms (per unit, Category 4/9) with no `method_options`**: S3-8's list, each method kept to the units the formula calculates. An older form with km and tonne.km gets `distance_based` only. Spend only with its fields.
  - **Spend forms** ("spent_value" + "currency" extras) whose methods are bare keys: each method with its units (the currencies for spend, the form's units otherwise).
- **Engine, "@method" as the answer** (`formConfig.ts methodByChoice`): a row with no answer whose "@method" names one of the question's answers has answered it. Today's screens and sheets, which send "@method", keep working on a moved form until SE-3's question reaches them; a builder-made question (answer ids that aren't method keys) keeps SE-2's rule. Found by the every-category workflow test.
- **Engine** (`calculationSpec.ts resolveSpecMethod`): when the form's question has no answer on a row, the row's method (`method`, else `activity_data["@method"]`) picks the formula, if the formula has it. That is exactly what decided before, so rows saved before the move calculate the same. A form whose own column picks the formula (Use of sold products' "Method") is unaffected, because its keys aren't methods.
- **`src/scripts/migrateEntryFormsData.ts`** (`migrate:entry-forms-data`, listed right after `migrate:scope3-transport`, the last migration that writes standard forms):
  - The run is one transaction under an advisory lock. Every saved row of each changed form is calculated with the old and the new form, in memory (`prepareEntry`, as a recalculation does), and the results are compared by kgCO₂e and by refusal code.
  - Any difference rolls the run back and logs `WARNING: form(s) … would calculate saved rows differently; nothing was changed`.
  - Any error is logged too. The script always exits 0.
  - `--dry-run` lists what it would change and rolls back.
- **Standard forms:** the move breaks the S3-9/S3-10 `standard_hash`, so their migrations treat the form as customised and leave it. A site that gets a standard form later is moved by the same start's SE-5 run.
- **Deviations:**
  - The spec's file name `migrateEntryForms.ts` is SE-2's columns migration. SE-5 is `migrateEntryFormsData.ts`.
  - **A one-method "@method" form keeps `method_column: "@method"`.** There is nothing to ask, and SE-2 fixes the method.
  - **Old rows don't get an answer written.** Rows are never touched. They calculate from their "@method", and an edit in a screen that asks the question will ask it.
- **Tests:**
  - `ci/unit/se-5-migrate-forms.test.cjs` (6): the question, idempotence, one method, skips with reasons, transport units, spend units, and the engine fallback.
  - `ci/api/tests/se-5-migrate-forms.test.cjs` (5): the real script on a real database. Covers rows saved with "@method", the dry run, the move with rows unwritten and a second run, a User answering and an old row edited, and a seeded difference rolled back and logged with exit 0.
