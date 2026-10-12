# IM3 · Import context API (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/imports/context/CLAUDE.md`.
> Depends on: IM0. Blocks: IM7. Lane L3.

## Outcome
One call tells Claude (or the P27 page) everything needed to map a workbook for **every category assigned to the client**: sites, categories, period modes, form fields, units, activity names, and whether each category is ready to import.

## Build
- `GET /imports/context`, `GET /imports/context/activities`, `GET /imports/readiness` (`01-contracts.md` §4).
- Sites and categories: same source and filtering as the app (`site.categories`, `utils/filterUserCategories.ts` for Users, manager sites for Managers, company for Admin, any for Superadmin with `company_id`).
- Form: from the site × category column config (as `GET /user/column-configs`); `calc_mode` from the calculation spec (`services/calculationSpec.ts`) or `distance` for distance-based configs; fields with key, label, type, unit, required, options.
- Period modes: monthly always; yearly where the yearly entry rules allow it (`docs/yearly-data-entry.md`).
- Activities: factor names (`emission_category_name`, `global_category_name`) for the site × category, plus the company's P23 mappings (company name → global), with units and latest year. Search `q` is case-blind contains, ranked exact → prefix → contains; limit 10–50.
- Readiness: form present; factor years available; flags the categories with neither and returns the app link that fixes it (P24 `/capture/forms?site=&category=`, P22 `/factors?client=&site=&category=`).
- Cached per company for 60 s in memory; bust on factor, mapping or form changes is not required (60 s staleness is fine).

## Own tests
`ci/api/tests/im3-context.test.cjs`: each role sees exactly its sites and categories; a User sees only categories granted to them; Superadmin without company_id → 400; company 2 token → no company 1 data; readiness flags a category with no form and one with no factor for the year; activities search ranks and limits; mappings of company 2 never appear for company 1 (repeat of F-08 rule).

## Audit rows
MCP-07, MCP-08, MCP-20.

## Acceptance
For the fixture client every assigned category appears with the right period modes and form, and readiness matches what P16 Console shows as gaps.

## As built (2026-10-12, lane L3)
- Files: `service.ts` (scope, context, activities, readiness, 60 s cache), `controller.ts`, `router.ts`; mounted from `src/imports/router.ts` under `/imports` (behind `authenticate`).
- Scope mirrors the app: Superadmin needs `company_id` (`IMPORT_COMPANY_REQUIRED`), Admin gets their company, Managers their managed sites, Users their site(s). A non-empty `user_categories` set narrows every non-Superadmin role (as `filterUserCategories.ts` does at login); empty = all. A `company_id` that is not the caller's → `IMPORT_FORBIDDEN`. Not found and not yours look the same.
- `company.mcp_enabled` arrives with IM5; until that migration runs it reads as `false` (undefined-column error is caught).
- `period_modes` is always `["monthly", "yearly"]` (yearly entry is allowed for every category, docs/yearly-data-entry.md).
- Form fields: the first column config by `config_name` (same row the data-entry page and `calculationSpec.ts` use), loaded for all sites in one query (`loadForms`; `loadForm` for one cell, used by IM7). Columns come first (`key` = column name, `type` = column type; select options from `column_options` by column id; a dependent select carries `depends_on` and the union of its parent's option sets from `dependent_options`), then `extra_fields` with their own `required`, `options` and `show_for`. `unit` is not filled: configs carry no per-column unit. `required` means the backend rejects a row without the field (the FE validates nothing else): with a calculation spec, the `method_column` and the fields in every method's `multiply`; a field only some methods need has `required: false` and `required_for` (the per_method names or per_unit unit keys); without a spec, the common quantity column (`activityValue.ts` names: quantity, value, amount, consumption, activity_value, activity_data) or the only number column, and nothing when several unnamed number columns exist (any one positive number is accepted). Select columns are never required. `calc_mode`: `per_method` (with `method_column`), `per_unit`, `distance` (a `per_unit` spec with a `km`/`tonne.km` method) or `single`.
- Units: the site × category `unit` rows plus the factors' `denominator_unit`s, de-duplicated case-blind.
- Activities: factor `emission_category_name` and `global_category_name` plus the client's P23 mappings (`company_category_name`, with `maps_to` the global name; site-specific or company-wide). A mapping takes the units and latest year of the factor it maps to. Search `q` is case-blind contains, ranked exact → prefix → contains, then alphabetical; `limit` default 20, max 50. Superadmin may omit `company_id` here: the site names the client.
- Readiness: factors are looked up for `year - 1` (as Add data does), with any-year fallback, so `ready` = form present and at least one factor. Each cell is the IM0 `ReadinessCell` plus `site_name`, `category_name`, `lookup_year`, `factor_for_year` and `ready`; `missing` is `[{ what: "form" | "factor" | "factor_for_year", fix_page }]`, where `factor_for_year` means the newest factor would be used. Fix links use `FRONTEND_URL` (the backend's existing name for the FE base): `/capture/forms?site=&category=` and `/factors?client=&site=&category=`. `year` is required (IM0 `ReadinessQuerySchema`).
- The context cache is per company + scope for 60 s; tests that change forms or factors and read the context again within a minute see the old value (seed before the first call).
- Query strings are parsed with IM0's `ContextQuerySchema`, `ActivitiesQuerySchema`, `ReadinessQuerySchema` (bad input → `IMPORT_VALIDATION` 400); services throw `ImportError`. The form object is IM0's `CategoryForm` plus `method_column` for `per_method` specs.
- Response supersets of the IM0 shapes (`method_column`, `depends_on`, `show_for`, `required_for`, readiness names/`lookup_year`/`factor_for_year`/`ready`) are documented here; contracts.ts stays IM0's to change.
- Tests: `ci/api/tests/im3-context.test.cjs` (7 tests; responses are checked against the IM0 zod schemas). Audit rows MCP-07, MCP-08, MCP-20.
