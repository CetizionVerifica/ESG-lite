# SE-2 · Form config model (backend)

> Module spec. ESG-lite. Copy to `ESG-lite/src/forms/CLAUDE.md`. PR title `[SE-2 1/1] …`, `Completes: SE-2`.
> Depends on: S3-3 part 1 (`column_config.method_options` column) if merged; if #135 is still a draft, SE-2 adds the column using the existing `MethodOptionsSchema` and S3-3 rebases on it · Owns: `migrate:entry-forms`, the new form schemas (added to `src/scope3/contracts/schemas.ts` beside `MethodOptionsSchema`; new error codes in `src/scope3/contracts/errors.ts`) · Touches: `ColumnConfig.ts`, `Company.ts`, `emissionWrite/compute.ts` (`methodFileFor`), `emissionWrite/context.ts`, `imports/contracts.ts`, admin column-config and company endpoints

## Job to be done
Everything a contributor no longer chooses is stored on the form or the company and applied by the server.

## Build
1. `migrate:entry-forms` (idempotent, additive) on `column_config`:
   - `method_options jsonb null` (only if S3-3 hasn't added it), validated by the existing `MethodOptionsSchema` (`src/scope3/contracts/schemas.ts`): `[{ method, units[] }]`, most specific first; `[0]` is the form default and each method's `units` is the list the form offers for it.
   - `method_by_choice jsonb null`: `{ column: string, map: { [choiceId]: Method } }`.
   - `field_settings jsonb not null default '{}'`: `{ [field]: { label?, help?, default?, hidden?, readonly?, required? } }` for columns and extra-field keys.
   - `units jsonb null`: `{ fixed?: string }` only (allowed units per method stay in `method_options[].units`).
   - `currency jsonb null`: `{ fixed?: string }`.
   - `version int not null default 1`.
   On `company`: `default_currency varchar(3) not null default 'INR'`, `entry_detail varchar(8) not null default 'total'` (`total` | `full`).
2. Schemas for the new fields go in `src/scope3/contracts/schemas.ts` (reuse `MethodSchema` from `src/scope3/contracts/ghgCategory.ts` and `MethodOptionsSchema`); new codes (`UNIT_NOT_ALLOWED`, `FORM_CHECK_FAILED`) in `src/scope3/contracts/errors.ts` first (repo rule: methods and error codes live only there). `PUT /admin/column-configs/:id` and create validate them (unknown column in `field_settings` / `method_by_choice.column`, method not in `method_options`, choice id not in the column's options, fixed unit not in that method's `units` → 400 with a field path). Superadmin only.
3. Method order in `methodFileFor` (01-contracts §6 after SE-0): Admin/Superadmin import or MCP row `method` (must be in `method_options`, else the existing `METHOD_NOT_ALLOWED`; Managers' smart Excel imports count as importers, Users' manual bulk upload does not) → `method_by_choice` answer → `method_options[0]` → `eeio_spend` factor (S3-5) → `activity`. A typed entry from a User: any `method` / `@method` is ignored when the form fixes one. A `per_method` spec whose `method_column` is a normal select keeps working unchanged.
4. Server-side defaults: before compute, fill hidden fields from `field_settings.default`, use `units.fixed` as `activity_unit` when the row has none (a row with a different unit is rejected with `UNIT_NOT_ALLOWED`, never overwritten), and currency = row unit if it is a currency → `currency.fixed` → `company.default_currency`. Same path for typed entries, bulk upload, smart import and MCP (`buildWriterContext`/`context.ts`).
5. `GET` endpoints the FE uses for forms (user and admin) return the new fields; `GET` company/site returns `entry_detail`, `default_currency`. `PUT /admin/companies/:id` accepts both (Superadmin).

## Tests
- Unit: method order (each step), defaults filling, currency fallback, schema validation errors.
- API: Superadmin-only writes; tenant isolation (company 2 token on company 1 config); migration run twice.
- Golden (`ci/golden`) unchanged.

## Done when
A form can fix its method, map a choice to methods, hide/default fields, fix unit and currency; a User's entry with only field values gets the same total as today's equivalent entry.

## As built (2026-10-17)
- **`src/forms/formConfig.ts`** (pure, owned here): `readFormSettings` (tolerant: a value that doesn't fit its schema is skipped, never a reason to refuse rows), `methodByChoice` (the answer matched by choice id or label, without regard to case), `namedMethodFor` (the method order), `applyHiddenDefaults`, `fixedUnitFor`, `defaultCurrencyFor`, and `parseFormSettingsInput` for the Superadmin writes.
- **Method order** (`prepareEntry`, with `EntryInput.method_source`):
  - `caller` (default: imports by Admins, Superadmins and Managers, MCP, recalculations, a reviewer's edit): the row's `method`, else its `@method`, else the choice's method. As before for every row that names one.
  - `contributor` (a User's typed entry, own edit, live checks, manual bulk upload): where the form **fixes** the method (a choice map, or only one method in `method_options` on a form that carries SE-2 settings: `FormSettings.configured`, `formFixesMethod`) what the row sends is ignored. The choice's method decides; an answer the map doesn't name (or none) gets the form's default as for a row that names none. A User's own `@method` is replaced with the form's (the choice's, else S3-8's method for the row's unit, else `method_options[0]`), since the spec and S3-5's spend fields read `@method` too.
  - A form with **no SE-2 settings** (no choice map, field settings, fixed unit or currency) fixes nothing, even with one method: a User's method it doesn't offer is `METHOD_NOT_ALLOWED` and a `supplier_specific` row with no supplier is refused, exactly as before SE-2.
  - **Deviation:** a form with several methods and no choice map fixes none. A User's row there keeps today's S3-3 rule: an offered method is used, another is refused with `METHOD_NOT_ALLOWED`. S3-5's spend fields send `spend_based` this way until SE-3 replaces them.
  - The engine's later steps are unchanged: `method_options[0]`, S3-8's method by unit, S3-5's `eeio_spend` rule, activity. Labels only; no stored total moves (golden unchanged).
- **Server-side defaults** (every channel goes through `prepareEntry`):
  - Hidden fields with a `default` are filled when the row leaves them empty. Columns go in `activity_data`, extra fields in `extra_data`; a value the row has (in either place) is never overwritten.
  - `units.fixed` fills a row with no unit and refuses another (`UNIT_NOT_ALLOWED`, 400, field `activity_data_unit`). The same unit written another way ("KM") is kept. A spend row's unit is its currency, so the fixed unit doesn't apply to it.
  - A spend row with no currency takes `currency.fixed`, else `company.default_currency`. A row whose unit is a currency keeps it.
  - **Rollout note:** `company.default_currency` defaults to INR for every company, so a spend row with a spent value and no currency now gets an INR total where it used to be refused or saved at zero. A client whose spend isn't in INR needs its `default_currency` set before rollout.
- **Edits** (`updateEmission`, `managerUpdateEmission`, both through `recalculateEntry`): what is stored is what was calculated (`entry.input.activity_data` / `extra_data`, so hidden defaults, a default currency and the form's `@method` are saved), and the FERA and T&D-loss twins are recalculated from that data. An edit keeps the row's stored method (`editKeepsMethod`, passed to the engine as the caller's `method`) unless what decides it changed: the answer to the choice, or a `@method` the editor may set (a User's own `@method` on a form that fixes the method is put back). A stored method the form no longer offers, or none, is decided as for a new row. When the calculated method differs from a stored one, `emission.method`, `dq` and `data_type` follow it; legacy rows with no method keep none.
- **Writes** (`POST`/`PUT /admin/column-configs`, Superadmin only):
  - `method_by_choice`, `field_settings`, `units` and `currency` are checked against the form as it will be after the write. Absent keeps what is stored; `null` clears it.
  - A shape error is `FIELD_INVALID`; a mismatch with the form is `FORM_CHECK_FAILED`. Both name the field path, e.g. `method_by_choice.map.trip` or `units.fixed`.
  - A choice map needs the form's `method_options`. A fixed unit must be offered by every method a row can take: each mapped choice's method, else the form's default. This is checked against the form as it will be: the body's choice map and unit over the stored ones, whenever the unit, the choice map or `method_options` change.
  - `PUT /admin/companies/:id` takes `default_currency` (a currency ESGLite converts) and `entry_detail` (`total` | `full`).
  - `version` isn't writable yet; SE-4 publishes.
- **Reads:** the form endpoints return the entity, so the new fields come back to the User's form. The session user's `sites.company` (and `site.company`) carries `entry_detail` and `default_currency`, which SE-1 reads; so do `GET /user/sites/:id` (`company`), `GET /user/companies` and `POST /user/companies/by-sites` (`entry_detail`, `default_currency` beside `companyName`).
- **`migrate:entry-forms`** is listed right after `migrate:scope3-row-quality`, before any migration that loads `ColumnConfig` or `Company`. It adds only columns. Current clients get INR and `total`.
- **Error codes:** `UNIT_NOT_ALLOWED` is in `scope3/contracts/errors.ts` and is also a row issue (`imports/errors.ts`). `FORM_CHECK_FAILED` is in the contracts.
- **Where the order lives:** spec item 3 names `methodFileFor`; steps 1–2 (caller's method, the choice) and the contributor rule run in `prepareEntry` instead, which hands the result to the engine as `row.method`. `methodFileFor`'s dispatch (proxy → spend/supplier/hybrid → spend quote → spec → activity) and `methodFor`'s labelling (row → `@method` → S3-8's unit → `method_options[0]` → `average_data`) are untouched, so no stored total and no golden moves. Two differences from the spec's list: S3-8's method-for-unit sits between the choice and `method_options[0]`, and the last step records `average_data` (S3-3), not `activity`. An `eeio_spend` factor still makes the row `spend_based` whatever the label (the spend file's own word, S3-5).
- **Tests that encode the old order and still hold:** `ci/api/tests/s3-3-row-quality.test.cjs` (a User's `method` the form doesn't offer → `METHOD_NOT_ALLOWED`, multi-method forms with no choice map), `ci/api/tests/s3-15-workflow.test.cjs` (live checks, same rule), `ci/unit/s3-3-dq-defaults.test.cjs` (`methodFor`). None needed changing.
- **Tenant isolation:** a company 2 token on company 1's form gets 403, not 404: the column-config writes are Superadmin-only (`requireSuperAdmin`), and the User read goes through the existing `guardSiteParam`, which answers 403 for another company's site. An unknown form id is 404 for the Superadmin.
- **Migration order:** `migrate:entry-forms` is listed right after `migrate:scope3-row-quality` (before `migrate:scope3-row-quality-backfill` and every later migration), because TypeORM selects every declared column and later migrations load `ColumnConfig` / `Company`.
- **Tests:** `ci/unit/se-2-form-config.test.cjs` (reading, the contributor rule, defaults, fixed unit, currency, write checks with field paths), `ci/unit/se-2-method-order.test.cjs` (each step of the method order through `prepareEntry`, defaults, the currency fallback, a form without settings), `ci/api/tests/se-2-form-config.test.cjs` (role matrix, tenant isolation, 400s by field, migration columns, typed and bulk entries, a User's field-values-only entry equal to the explicit one, company and site reads). Workflow step 5a is real.
