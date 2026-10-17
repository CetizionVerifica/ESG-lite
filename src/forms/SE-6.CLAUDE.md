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

## As built (2026-10-17, backend part 1/2)
- **`form_template`** (`migrate:form-templates`, right after `migrate:form-versions`; additive, idempotent).
  - Fields: name (≤ 120, unique per client and category, case ignored), `company_id` (null = every client), category (id and name), `config` (the form as SE-4 stores a version, plus `unit_names`: the site's unit list), `created_by`, `created_at`.
  - `unit_names` is its own key because `units` is the form's SE-2 fixed-unit setting. The API test caught the two colliding.
- **`src/forms/templates.ts`**, endpoints under `/admin/form-templates` (Superadmin only):
  - `GET` lists templates (`?company_id=` gives the client's own and the global ones; `?category_id=`).
  - `POST {form_id, name, company_id?}` saves one. `company_id` omitted keeps the form's client; null makes it global.
  - `PUT /:id {name}` renames. `DELETE /:id` deletes; forms made from it stay.
- **Apply** (`POST /apply/preview` and `POST /apply`, `{template_id | form_id, site_ids, note?}`, `?year=` factor year):
  - Each site gets an action (`create`, or `update` its form, which keeps its name), its saved-row count and the SE-4 check against its own factors.
  - Sites that pass are written in a transaction (settings and fields from the source, missing unit names added) and published as a new version (`From template "…"` unless a note is given). An unchanged update adds no version (SE-4).
  - Sites that don't pass are `refused` with their check, never skipped silently.
  - **Client scope:** a client's template, and any form, reaches only that client's sites (`refused`, "belongs to another client"). A form isn't copied to its own site.
- **Seed** (`POST /seed {company_id, dry_run?}`): for each site of the client that reports a category with no form, the newest global template for it is applied if it passes.
  - A site whose rows were saved without a form is reported and left alone, as the S3-9 standard forms do. Found on real data: Midal's Saudi Arabia site has 22 Stationary rows and no form.
- **Deviations:**
  - Seeding is an action ("Fill a client's missing forms"), not a hook in onboarding. A client's sites and categories are set up in several places, and a form appearing unasked on a site with rows would change how they're edited.
  - The spec's "unless Superadmin" exception isn't built: templates are Superadmin-only, and a client's template still stays with its client. To share one, save it for every client.
- **Tests:** `ci/api/tests/se-6-templates.test.cjs` (8):
  - Migration; five roles refused on every endpoint; names (trim, unique, rename); client scope in lists and applies.
  - Preview writes nothing; apply to two sites with one refused by its check; a User's row on the copied form records form version 1.
  - An update keeps the name; an unchanged copy adds no version, a changed one does.
  - Seeding: dry run, create, a second run, and a site with rows saved without a form reported. Deleting leaves the forms.
