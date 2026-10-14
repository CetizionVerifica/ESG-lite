# ESG-lite backend

## Redesign and PCF work

- All redesign and PCF PRs target the long-lived staging branch `production` (formerly `redesign/integration`), not `main`. Branch from it and open PRs against it.
- Specs for this repo: `docs/pcf/foundation/E1-data-and-engine/CLAUDE.md` (PCF data model and engine) and `docs/redesign/00-entity-map.md` (entities, endpoints, backend items B1–B8).
- The full plans live in ESG-lite_FE under `docs/redesign/` and `docs/pcf/`.

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
