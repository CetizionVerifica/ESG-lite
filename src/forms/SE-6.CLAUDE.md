# SE-6 · Form templates and copy

> Module spec. PR titles `[SE-6 1/2]` (ESG-lite), `[SE-6 2/2]` (FE), `Completes: SE-6`.
> Depends on: SE-4 · Owns: `form_template` table, `/admin/form-templates`

## Job to be done
A Superadmin sets up a category once and applies it to many sites or clients.

## Build
1. `form_template` (name, category name, config json, created_by/at). "Save as template" from a form; list, rename, delete (Superadmin).
2. "Apply to…" a template or a form: pick client → sites × category; preview the SE-4 check for each target; apply creates or updates those forms (each a new version). Choice ids and factor-match rules keep names; targets with no matching factor show the check error, not a silent skip.
3. Global templates (no client) seed new clients.

## Tests
API tenant isolation (a template applied to company 1 can't touch company 2 unless Superadmin), check run per target; Playwright apply to two sites.

## Done when
One form can be copied to N sites in one action with each passing the check.
