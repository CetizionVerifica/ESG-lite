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
