# IM7 · Read tools (ESG-lite)

> Blueprint spec. Goes to `ESG-lite/src/mcp/tools/read/CLAUDE.md`.
> Depends on: IM3 (services), IM6 (registry). Lane L3.

## Outcome
Claude can find out, without guessing, which clients, sites and categories the user can import into, what each category's form needs, which activity names exist, and what's missing before an import.

## Build
Tools `whoami`, `list_sites_and_categories`, `get_category_form`, `find_activity`, `check_readiness` (`01-contracts.md` §8), scope `imports:read`, annotations `readOnlyHint: true, openWorldHint: false`.
- Descriptions say when to use each, in one or two sentences, e.g. "Call before plan_import to get site_id and category_id; names are not accepted by plan_import."
- Results: a one-line human summary in `content[0].text` and the full object in `structuredContent` (with `outputSchema`). Sheet or user text never goes into the summary line.
- `check_readiness` returns, for gaps, the app page that fixes them (P24 forms, P22 factors) as full URLs from `FE_BASE_URL`.
- Keep outputs small: no activity lists in `list_sites_and_categories`; `get_category_form` returns the 50 most used names; `find_activity` up to 10.

## Own tests
`ci/mcp/im7-read-tools.test.cjs`: each tool as Superadmin; missing `company_id` → `IMPORT_COMPANY_REQUIRED`; client with `mcp_enabled` off → `MCP_DISABLED_FOR_CLIENT`; `get_category_form` with a site of another client than `company_id` → `IMPORT_FORBIDDEN`; non-Superadmin token → 403; output validates against `outputSchema`; summary line has no sheet text.

## Audit rows
MCP-07, MCP-08, MCP-20.
