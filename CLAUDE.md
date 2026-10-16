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

## Scope 3 (GHG Protocol categories 1–15) — see docs/scope3/
- Category numbers, methods, factor types, DQ scale, error codes and check ids live only in `src/scope3/contracts/`. Change them there first (S3-0 follow-up), then use them.
- Every total still comes from `src/services/emissionWrite`; each Scope 3 method is its own file in `emissionWrite/methods/`. Never compute a total elsewhere; golden totals (`ci/golden`) move only when the module spec says so and the PR lists every change.
- A Scope 3 category has a `ghg_category` (1–15); `category.scope` is validated ('Scope 1' | 'Scope 2' | 'Scope 3' | null).
- Every new emission row stores `method`, `dq`, `data_type` and a factor snapshot with `factor_type` and `gwp_set`. Spend rows store `fx` (rate and date used).
- Company Scope 3 boundary (`company_scope3_category`) is the only source of included/excluded status and reasons for reports.
- New tables and columns ship as idempotent `migrate:scope3-*` scripts in `scripts/migrate-all.cjs`; every new endpoint gets a tenant-isolation test.
