# SE-4 · Form check and versions

> Module spec. PR titles `[SE-4 1/2] Form check endpoint and versions` (ESG-lite), `[SE-4 2/2] Check panel and history` (FE), `Completes: SE-4`.
> Depends on: SE-2 · Owns: `src/forms/check.ts`, `column_config_version` table · Touches: column-config endpoints, `Emission.ts` (`form_version`), notifications

## Job to be done
A form can't go live half-configured, and anyone can see what changed and which version a row used.

## Build
### Backend
1. `src/forms/check.ts` (pure) + `GET /admin/column-configs/:id/check?year=`: errors and warnings with a field path:
   - a choice path (factor-match rule) with no factor for the year → error; only an older year → warning (`FACTOR_FALLBACK_YEAR`);
   - a method in `method_options`/`method_by_choice` whose recipe fields are missing or not numeric → error;
   - spend method without currency (form or company) or without an `eeio_spend` factor → error;
   - unit (fixed or allowed) not convertible to the factor's unit → error;
   - hidden + required field without a default → error;
   - `method_by_choice` choice with no method → error.
2. Saving a draft always works (today's `PUT` keeps its behaviour). **Publish** runs the check; errors block publish (`409 FORM_CHECK_FAILED`, code defined in `src/scope3/contracts/errors.ts`); warnings publish. Existing live forms that fail the new check stay live and get a warning mark on the forms list until fixed. Each publish bumps `version` and writes `column_config_version` (config json, by, at, note).
3. `emission.form_version int null` (migration), written by `emissionWrite`.
4. When a User's entry hits a missing factor, notify all Superadmins once per site × category × month (`notification` kind `form_needs_factor`).

### Frontend
1. Builder "Check" panel (runs on open and before save), errors link to the tab/field.
2. "History" drawer: versions with who/when/note and a diff of changed settings.
3. Manager drawer shows "Form version n".
4. Forms list: red mark on forms with errors.

## Tests
Unit for every check rule; API tenant isolation, publish blocked on error, version increment; Playwright: a broken form shows the error and can't be saved.

## Done when
Every live form passes the check; rows carry `form_version`; Superadmins hear about missing factors.

## As built (2026-10-17, backend part 1/2)
- **`src/forms/check.ts`** (pure, owned here): `checkForm({form, factors, year, companyDefaultCurrency})` → `{ok, errors, warnings}`, each issue `{code, field, message}` with the field path to fix (`emission_category_mapping.Road|Van|CNG [km]`, `calculation.methods.trip`, `method_by_choice.map.rail`, `currency.fixed`, `units.fixed`, `field_settings.Vehicle`). Codes (`CHECK_CODES`): `NO_FACTOR_FOR_YEAR`, `FACTOR_FALLBACK_YEAR` (the only warning), `FIELD_MISSING`, `METHOD_UNMAPPED`, `CURRENCY_MISSING`, `SPEND_FACTOR_MISSING`, `UNIT_NOT_CONVERTIBLE`, `DEFAULT_MISSING`.
  - A mapping target is looked up as the engine does (`FactorIndex.find`): none in any year is an error, only another year a warning.
  - Every formula field must be a number column of the form; every answer of the choice column (its options and dependent lists) must pick a method, and has a formula when `calculation.method_column` is the choice column.
  - Spend (offered or mapped) needs `currency.fixed` or `company.default_currency`, and an `eeio_spend` factor in the category.
  - A fixed unit must convert to the unit of every factor the mapping reaches; a hidden required field needs a default.
- **`src/forms/versions.ts`**: loads what the check reads, and publishes.
  - `GET /admin/column-configs/:id/check?year=` checks the saved form. `year` is the **factor year** (rows dated in year N use N−1); default this year − 1. The response carries `year`, `form_id` and the form's `version`.
  - `POST /admin/column-configs/:id/publish {note?}` `?year=`: errors refuse it with **409 `FORM_CHECK_FAILED`** and the check (the contracts' 400 is the SE-2 save's); warnings publish. One publish at a time per form (`FOR UPDATE`). It writes `column_config_version` (`config` = the settings and the columns by id, name and type; `note` ≤ 500; `published_by`; `published_at`) and bumps `column_config.version`.
  - `GET /admin/column-configs/:id/versions`: newest first, with who (`{user_id, name}`), when, the note and the stored config, for the FE diff.
  - Saving (`PUT`/`POST`) runs no check, as today.
- **Additions to the spec:**
  - `POST /admin/column-configs/check?year=` checks the builder's **unsaved** form: the `PUT` body with `pk_id` (keys it leaves out keep the saved form's; `column_ids` and `rename_map` give the columns) or the `POST` body of a new form. The builder runs it on open and before save without saving first.
  - `GET /admin/column-configs/checks?year=&site_id=&category_id=`: each form's error and warning counts and first error, for the forms list's red mark. Registered before `/column-configs/:id`.
- **Deviations:**
  - **History starts at the current version.** A form's first publish records version 1 (every form is version 1 today) instead of bumping to 2; each later publish adds one. Publishing a form that hasn't changed since its last version adds nothing and says so (`unchanged: true`, "Nothing changed since version n, which stays live."). Found on real data, where a second publish of an unchanged form made an empty version.
  - **Recipe fields:** the server checks the formula's fields. Recipes (SE-3) are FE config that become the formula, so a recipe field the form lacks shows as `FIELD_MISSING` on the formula that uses it.
  - **Allowed units** aren't checked against factors: which factor a unit reaches depends on the row's answers. SE-2's save already checks a fixed unit against the methods; the check adds the fixed unit against the factors.
- **`emission.form_version`** (`migrate:form-versions`, listed right after `migrate:entry-forms`; additive, idempotent): `prepareEntry` returns the context's form version (`LoadedContext.form_version`, `form_id`) and `insertEntry` writes it on the parent row. Twins keep null (their category has no form). An edit recalculated through `applyComputed` records the version it now follows. Rows from before SE-4 keep null.
- **`form_needs_factor` notifications** (`src/forms/needsFactor.ts`; the type is lower case as written in the spec, like `pcf_stale`): when a **User's** row is refused with `NO_FACTOR_FOR_YEAR` on save (`POST /user/emissions`) or in the live check (`POST /user/emissions/check`), every Superadmin is notified once per site × category × month (bell + SSE). An advisory lock on the key keeps two checks at once from both notifying; a per-process memo skips the database for repeats. The link is `/capture/forms/:id?tab=check`. Neither the save nor the check waits on it or fails because of it. Rows by anyone else don't notify (they can fix the form).
- **Tests:** `ci/unit/se-4-form-check.test.cjs` (every rule, the codes, the version snapshot, the check year, key-order-free comparison), `ci/api/tests/se-4-check-versions.test.cjs` (migration, role matrix on all five endpoints, 409 with no version written, the draft check with renames, the list counts, history from 1 and the unchanged publish, warnings publish, `form_version` on save and edit, notifications once per month by save and live check, none for a Superadmin's row). Workflow step 18 is real, and 25e checks every row's `form_version`.
