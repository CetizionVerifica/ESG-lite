# Copy client setup

Superadmin only. Copies what was built for one client (sites, their categories,
data-entry forms, units, emission factors, category mappings, threshold,
products and the client's own material factors) to another client, from the
live client or from a downloaded `.json` file. Plan and decisions:
ESG-lite_FE `docs/redesign/pages/P17-clients/CLAUDE.md` ("Copy setup") and the
project file `client-copy/00-plan.md`.

Never copied: people, entries, production, PCF studies, documents, audit log,
notifications, brand, MCP and OAuth data, licensed (`ecoinvent`) material
factors.

## Endpoints (`/admin`, Superadmin)

| Method | Route | What |
|---|---|---|
| GET | `/companies/:id/setup-bundle` | The client's setup as a downloadable file (`esglite-setup-<client>-<date>.json`). |
| POST | `/setup-copy/preview` | What a copy would create. Body `{ source, target_company_id?, options? }`. Nothing is written. Without a target the plan is built against an empty client (the onboarding step). |
| POST | `/companies/:id/setup-copy` | Apply the copy to client `:id` in one transaction. Body `{ source, options? }`. |

`source` is `{ company_id }` (read live) or `{ bundle }` (an uploaded file; up to 5 MB,
shape-checked, ids inside it ignored).

`options`:

- `sites: [{ key, target }]` — `target` is `"create"` (a new site, or the target's
  site of the same name), `"main"` (the target's only site, when it has exactly one;
  otherwise a new site), `"skip"`, or a site id of the target client. Default `"create"`.
- `include: { units, forms, factors, mappings, threshold, products, material_factors }`
  — all default `true` except `material_factors`.
- `factor_years: number[] | null` — null = every year in the bundle.
- `form_conflict: "skip" | "rename"` — a form whose name exists at the target site and
  category is skipped (default) or added as `"<name> (copy)"`.

## Rules

- The preview and the copy run the same code: the preview runs it in a transaction
  that is rolled back, so the report it shows is the report the copy returns.
- Nothing existing is modified. Every item is created or skipped; the report counts
  both, lists skipped form, unit and product names and warns about things to check
  (a site whose country differs from the source's, forms copied without factors).
- Categories, countries and the column library are global. A bundle naming a category
  this database does not have is refused before anything is written; a missing
  country creates the site without one (warning); a missing library column is created.
- Mappings get the target's `company_id` and `company_name`; `emission_factor_id` is
  re-resolved against the target's factors, never copied.
- Option ids inside a form's JSON are kept as they are (entries store them).
- Only ids and counts are logged, never bundle contents.
