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
