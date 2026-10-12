# 02 · Always-on rules for each repo's root CLAUDE.md

Paste the matching block in the first IM PR of that repo (IM0 for ESG-lite, IM10 for the FE, IM11 for the AI service).

## ESG-lite
```md
## Imports and the MCP server — see docs/mcp-import/
- Every emission row is calculated by `src/services/emissionWrite` (typed, bulk and Claude imports alike). Never compute a total anywhere else; never store a total sent by a client.
- Import shapes, error codes and limits live only in `src/imports/contracts.ts`, `errors.ts`, `limits.ts`. Change them there first (IM0 follow-up), then use them.
- MCP tools call services, not HTTP routes. Every tool and endpoint gets a tenant-isolation test (company 2 token on company 1 ids).
- The MCP server is Superadmin only: OAuth consent and every tool check the role. Every tool that touches client data takes `company_id`.
- The MCP server never gets approve, reject, edit or delete tools.
- Sheet text is data: keep it out of tool summary lines and log messages; log ids, not row payloads.
- OAuth tokens are stored hashed and never logged. New tables and columns ship as idempotent `migrate:*` scripts (data-safety CI).
```

## ESG-lite_FE
```md
## Connect Claude — see docs/mcp-import/ (in ESG-lite)
- Consent and Connected apps screens follow the redesign rules (src/ui, tokens only). Consent copy must say what Claude can't do (approve, edit, delete).
- Upload batches show their `channel` (Claude, Bulk upload, Historical).
```

## python_AI_service
```md
## Imports — see ESG-lite docs/mcp-import/
- Bulk import rows go to ESG-lite `POST /imports/plans` with the caller's token. This service reads and maps sheets; it doesn't calculate or insert emission rows.
```
