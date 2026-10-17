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
  - `contributor` (a User's typed entry, own edit, live checks, manual bulk upload): where the form **fixes** the method (a choice map, or only one method in `method_options`) what the row sends is ignored. The choice's method decides, or the form's only method applies as for a row that names none. A User's own `@method` is replaced with the form's, since the spec and S3-5's spend fields read `@method` too.
  - **Deviation:** a form with several methods and no choice map fixes none. A User's row there keeps today's S3-3 rule: an offered method is used, another is refused with `METHOD_NOT_ALLOWED`. S3-5's spend fields send `spend_based` this way until SE-3 replaces them.
  - The engine's later steps are unchanged: `method_options[0]`, S3-8's method by unit, S3-5's `eeio_spend` rule, activity. Labels only; no stored total moves (golden unchanged).
- **Server-side defaults** (every channel goes through `prepareEntry`):
  - Hidden fields with a `default` are filled when the row leaves them empty. Columns go in `activity_data`, extra fields in `extra_data`; a value the row has is never overwritten.
  - `units.fixed` fills a row with no unit and refuses another (`UNIT_NOT_ALLOWED`, 400, field `activity_data_unit`). The same unit written another way ("KM") is kept. A spend row's unit is its currency, so the fixed unit doesn't apply to it.
  - A spend row with no currency takes `currency.fixed`, else `company.default_currency`. A row whose unit is a currency keeps it.
- **Writes** (`POST`/`PUT /admin/column-configs`, Superadmin only):
  - `method_by_choice`, `field_settings`, `units` and `currency` are checked against the form as it will be after the write. Absent keeps what is stored; `null` clears it.
  - A shape error is `FIELD_INVALID`; a mismatch with the form is `FORM_CHECK_FAILED`. Both name the field path, e.g. `method_by_choice.map.trip` or `units.fixed`.
  - A choice map needs the form's `method_options`. A fixed unit must be offered by every method a row can take: each mapped choice's method, else the form's default.
  - `PUT /admin/companies/:id` takes `default_currency` (a currency ESGLite converts) and `entry_detail` (`total` | `full`).
  - `version` isn't writable yet; SE-4 publishes.
- **Reads:** the form endpoints return the entity, so the new fields come back to the User's form. The session user's `sites.company` carries `entry_detail`, which SE-1 reads.
- **`migrate:entry-forms`** is listed right after `migrate:scope3-row-quality`, before any migration that loads `ColumnConfig` or `Company`. It adds only columns. Current clients get INR and `total`.
- **Error codes:** `UNIT_NOT_ALLOWED` is in `scope3/contracts/errors.ts` and is also a row issue (`imports/errors.ts`). `FORM_CHECK_FAILED` is in the contracts.
