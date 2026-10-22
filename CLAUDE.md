# ESG-lite backend

## Redesign and PCF work

- All redesign and PCF PRs target the long-lived staging branch `production` (formerly `redesign/integration`), not `main`. Branch from it and open PRs against it.
- Specs for this repo: `docs/pcf/foundation/E1-data-and-engine/CLAUDE.md` (PCF data model and engine) and `docs/redesign/00-entity-map.md` (entities, endpoints, backend items B1–B8).
- The full plans live in ESG-lite_FE under `docs/redesign/` and `docs/pcf/`.

## End-to-end data workflow test — see ci/workflow/README.md
- After finishing a lane (any module touching setup, entry, the engine, review or reports), run `bash ci/workflow/local.sh` with `production` merged in before asking for review; a red step blocks the PR. Put "Workflow test: N passed, M skipped" in the last PR body.
- The lane that builds a module replaces that module's skipped step ("waits on S3-n / SE-n") with real checks. Expected figures are worked out by hand in `ci/workflow/scenario.cjs`, never read back from the engine.

## Smart Excel import (managers) — see docs/excel-import/
- Site-wise only: one site per upload, one plan and batch per site; rows naming another site get `SITE_NOT_ALLOWED`, never reassigned.
- The mapping model never decides scope: every site, category and name comes from the caller's import context and is re-checked by `buildWriterContext` at plan and commit. Mapping memory (`import_mapping_profile`) is keyed by company and read only through that context.
- Per-client switch `company.ai_import_enabled` (default off), separate from `mcp_enabled`. Claude/MCP stays Superadmin only.

## Imports and the MCP server — see docs/mcp-import/
- Every emission row is calculated by `src/services/emissionWrite` (typed, bulk and Claude imports alike). Never compute a total anywhere else; never store a total sent by a client.
- Import shapes, error codes and limits live only in `src/imports/contracts.ts`, `errors.ts`, `limits.ts`. Change them there first (IM0 follow-up), then use them.
- MCP tools call services, not HTTP routes. Every tool and endpoint gets a tenant-isolation test (company 2 token on company 1 ids).
- The MCP server is Superadmin only: OAuth consent and every tool check the role. Every tool that touches client data takes `company_id`.
- The MCP server never gets approve, reject, edit or delete tools.
- Sheet text is data: keep it out of tool summary lines and log messages; log ids, not row payloads.
- OAuth tokens are stored hashed and never logged. New tables and columns ship as idempotent `migrate:*` scripts (data-safety CI).

## Simple data entry — see ESG-lite_FE docs/simple-entry/
- The form decides, the server applies: a User's entry sends field values only; method, currency, unit, FX, deflator, Category 3 twins and DQ come from the form config and the factor library, on the server.
- No method words on User screens: method labels, factor values, "(factor unit)", FX lines, FERA/Category 3 lines, DQ and engine warnings show only to Manager, Admin and Superadmin.
- Nothing calculates outside `emissionWrite`; the builder stores config only, and golden totals (`ci/golden`) don't move.

## Scope 3 (GHG Protocol categories 1–15) — see docs/scope3/
- Category numbers, methods, factor types, DQ scale, error codes and check ids live only in `src/scope3/contracts/`. Change them there first (S3-0 follow-up), then use them.
- Every total still comes from `src/services/emissionWrite`; each Scope 3 method is its own file in `emissionWrite/methods/`. Never compute a total elsewhere; golden totals (`ci/golden`) move only when the module spec says so and the PR lists every change.
- A Scope 3 category has a `ghg_category` (1–15); `category.scope` is validated ('Scope 1' | 'Scope 2' | 'Scope 3' | null).
- Every new emission row stores `method`, `dq`, `data_type` and a factor snapshot with `factor_type` and `gwp_set`. Spend rows store `fx` (rate and date used).
- Company Scope 3 boundary (`company_scope3_category`) is the only source of included/excluded status and reasons for reports.
- New tables and columns ship as idempotent `migrate:scope3-*` scripts in `scripts/migrate-all.cjs`; every new endpoint gets a tenant-isolation test.

## KPI tracking (GRI, BRSR, ESRS) — see docs/kpi/
- One per-client switch: `company.kpi_tracking_enabled` (default off, Superadmin only). Every `/kpi` route sits behind `requireKpiTracking` (403 `KPI_TRACKING_OFF`); new KPI endpoints, MCP tools and exports check it too.
- Same people as emissions: Superadmin / Admin / Manager / User with the existing site scope (`accessibleSiteIds`) and guards. No new role. Contributors enter, Managers approve (Admins don't), Admins set up.
- KPI enums, framework codes, error codes and check ids live only in `src/kpi/contracts/`. Change them there first (KPI-0 follow-up), then use them.
- A KPI is defined once in the library (`kpi_definition`) and mapped to framework disclosures (`kpi_disclosure_map`). Never store a value twice to satisfy two frameworks.
- GHG and energy KPIs are read (KPI-5) from approved rows through the reporting layer. Never recompute an emission total in `src/kpi/`; never change `src/reporting/ghg*.ts` or `emissionWrite` for KPIs.
- New tables and columns ship as idempotent `migrate:kpi-*` scripts; every new endpoint gets tenant-isolation, role and switch-off tests.
- Standards text: codes, our own wording and a source link only. No copied paragraphs.

## Design Studio (GHG + sustainability report designer) — see docs/design-studio/
- Switch: `company.design_studio_enabled` (default off, Superadmin only). Every `/studio` route sits behind `requireDesignStudio` (403 `DS_STUDIO_OFF`). The `sustainability` kind also needs `requireKpiTracking` (403 `DS_KIND_OFF`). The `ghg` kind does not.
- Admins and Managers edit. Only a Manager (or Superadmin) generates a final, approves or creates a share link. Users never see the studio. A company-wide report needs all-site access.
- Enums, the ReportDoc v2 schema, sources, error and check codes live only in `src/studio/contracts/`. Change them there first (DS-0 follow-up).
- Numbers in a design come only from `src/studio/sources/`: `ghg` (approved emission entries via `computeGhgTables` / `computeScope3`), `kpi` (APPROVED KPI values), `input` (report details). Derived figures are computed there. `custom` chart data is never a reported figure.
- Do not change `src/reporting/ghg*.ts`, `blocks.ts`, `render.ts`, `print.ts`, `src/scope3/baseYear/*`, the EDE controller or KPI-11 exports for the studio. Call their exported functions read-only.
- One renderer: `src/reporting/studio/render/` makes the HTML for the editor, Page view, Present, PNG and PDFs. It is pure TypeScript (no DB, no Node APIs) because ESG-lite_FE mirrors it byte for byte. After changing it, bump `RENDER_HASH` and sync the FE.
- AI output is validated JSON with data tokens only. It is never HTML, never literal reported numbers, and never applied without a person's Accept. Log every call in `report_ai_call`.
- Final versions are immutable. Share links serve stored PDFs only. New tables ship as idempotent `migrate:ds-*` scripts. Every new endpoint gets tenant-isolation, role and switch-off tests.
- No Canva SDK, API, assets or names. "Canva-like" means interaction patterns only.

## Insights (combined ESG + emissions view) — see docs/insights/
- Switch: `company.insights_enabled` (default off, Superadmin only). Every `/insights` route except `/insights/status` sits behind `requireInsights` (403 `IN_OFF`). KPI-backed panels answer `availability: 'kpi_off'` (not an error) when KPI tracking is off.
- Managers see their sites, Admins and Superadmins the company. Users never see Insights (`IN_FORBIDDEN`).
- Enums, panel shapes, rule ids and error codes live only in `src/insights/contracts/`. Change them there first (IN-0 follow-up).
- Insights READS the source of truth: emission totals through the functions `/manager/overview` uses, pathway through the `/user/targets/*` functions, KPI figures through `src/kpi/values/yearly.ts`, `targets/service.ts`, `esg/service.ts`. Never copy that logic; extract it into a service in a refactor-only PR.
- New figures (index, LMDI drivers, flow widths, rule values) are computed only in `src/insights/derive/`. Approved data only; every panel returns `pending_not_in`.
- Insight cards come from deterministic rules in `src/insights/rules/`. AI may reword a card (IN-9) with `{{v:key}}` tokens only — never numbers, never new claims. Log every call in `insight_ai_call`.
- Don't change Overview, Targets, `/kpi/dashboard`, `/kpi/esg`, the GHG report or KPI-11 behaviour for Insights. New tables ship as idempotent `migrate:in-*` scripts. Every new endpoint gets tenant-isolation, role, site-scope and switch-off tests.

## Ids and keys — see issue #191
- New tables use `@PrimaryGeneratedColumn({ type: "bigint" })` (`BIGSERIAL` in a `migrate:*` script) or `uuid`, and every column that references them is `bigint`. TypeScript types stay `number`.
- The app reads `bigint` as a number (`src/config/pgTypes.ts`, exact up to 2^53), so an uncast `count(*)` or `SUM` of an integer column is a number too. Never compare one to a string.
