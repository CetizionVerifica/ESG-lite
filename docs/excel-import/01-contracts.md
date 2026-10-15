# Contracts for the smart Excel import (XI0)

> **As built (ESG-lite #121, python_AI_service #33, 2026-10-14).** Code: ESG-lite `src/imports/mapping.ts` (+ `contracts.ts`, `errors.ts`, `limits.ts`), python `app/schemas/mapping.py`; tests `ci/unit/xi0-mapping.test.cjs` and `ci/tests/test_mapping_contracts.py`; fixtures `ci/fixtures/xi0/` in both repos. Names below are the as-built ones: `MappingProposal.site_id` (one site per upload), `SheetProposal.site_id` + `site_column` instead of a resolved site, `ProposedActivityMatch` has no `site_id` (the sheet's site applies), row code `SITE_NOT_ALLOWED` (existing) instead of `SITE_OUT_OF_SCOPE`, `MappingProfile.site_id` always set. XI1–XI6 build from these.

Additive to `/mnt/project-files/mcp-import/01-contracts.md` (IM0, built in ESG-lite `src/imports/contracts.ts`). `ImportRow`, `PlannedRow`, `RowIssue`, the plans endpoints and their error codes stay as they are.

## 1. Sheet fingerprint
`sha256` of: sheet position-independent header names (normalised: lower case, collapsed whitespace, punctuation removed, in sheet order) + the detected header row depth. Two files from the same client export system give the same fingerprint even when the sheet name or row count differs.

## 2. MappingProposal (python → FE; FE → python after confirmation)
```
MappingProposal {
  document_id: int
  sheets: SheetProposal[]
  model: { name: string, calls: int, cached_profile_hits: int }   // telemetry only
}
SheetProposal {
  sheet_name: string
  fingerprint: string
  header_row: int                     // 1-based
  data_rows: int                      // after dropping subtotal/total/blank rows
  layout: "rows" | "months_as_columns"
  site_id:  int                        // the site chosen on screen 1; the proposal never changes it
  site_column: { column: string, values: { text: string, matches_site: boolean }[] } | null   // informational; rows whose text does not match the chosen site get SITE_NOT_ALLOWED
  category: Resolved<category_id>     // one category per sheet, or a column
  period:   { kind: "column", column: string }
          | { kind: "monthly_fixed", date: "YYYY-MM-DD" }
          | { kind: "yearly", year_type: "CY"|"FY", year: int }
          | { kind: "months_as_columns", columns: { column: string, date: "YYYY-MM-DD" }[] }
  fields: FieldMapping[]              // one per form field of the category (value, unit, extra_*)
  activities: ProposedActivityMatch[] // distinct sheet wordings → factor names
  confidence: number                  // 0..1, min over required parts
  source: "profile" | "rules" | "llm" | "mixed"
}
Resolved<T> = { kind: "fixed", id: T, label: string, confidence, source }
            | { kind: "column", column: string, values: { text: string, id: T|null, confidence, source }[] }
FieldMapping { key: string, label: string, required: boolean, column: string|null, confidence, source, skipped: boolean }
ProposedActivityMatch { sheet_text: string, category_id: int, factor_name: string|null, confidence, source, save_mapping: boolean }   // site = the sheet's site_id
```
Rules:
- Every `site_id`, `category_id`, field `key` and `factor_name` must exist in the caller's `ImportContext` (IM3). The engine drops anything else from the model's output and records it as `NOT_IN_CONTEXT` on the sheet so the FE can show "The sheet names Plant 9, which you cannot import into".
- `confidence < 0.8` on a required part marks the sheet "needs confirmation" (decision 4).
- The proposal is an input to `rows_from_proposal`; it is never stored by python beyond the request. The FE sends the confirmed proposal back with `/v1/excel/preview`.

## 3. MappingProfile (ESG-lite, table `import_mapping_profile`)
```
import_mapping_profile (
  id uuid pk, company_id int not null, site_id int null, category_id int null,
  fingerprint text not null, sheet_proposal jsonb not null,   // SheetProposal minus activities' per-row values
  confirmed_by int null (ON DELETE SET NULL), confirmed_at timestamptz, uses int default 0,
  created_at, updated_at,
  unique (company_id, fingerprint, site_id, category_id)   -- site_id is always set (site-wise imports)
)
```
- Written on successful commit of a plan whose proposal was confirmed (XI3 listens to `onBatchCommitted` and receives the confirmed proposal through a new plan field `import_plan.mapping jsonb null`, set by `POST /imports/plans` when `channel = "bulk_upload"` and the body carries `mapping`).
- Read only through the caller's writer context: `GET /imports/mapping-profiles?fingerprint=` returns the company's profiles for that fingerprint whose `site_id` is null or in `allowed_site_ids`.
- Superadmin passes `company_id` as everywhere else.

## 4. New endpoints
| Method | Path | Repo | Who | Notes |
|---|---|---|---|---|
| POST | `/v1/excel/propose` | python | any role with `ai_import_enabled` on their company | `{ document_id, site_id }` → `MappingProposal`. `site_id` must be in the caller's context (else 403 `IMPORT_FORBIDDEN` from ESG-lite). Calls ESG-lite context and profiles with the caller's token. One LLM call per sheet at most. |
| POST | `/v1/excel/preview` | python (exists) | same | Accepts `proposal: MappingProposal` instead of `site_id/category_id/mappings` (old shape still accepted for the contributor path). |
| POST | `/v1/excel/import` | python (exists) | same | Unchanged; the plan carries `mapping`. |
| GET | `/imports/mapping-profiles` | ESG-lite | scoped | §3 |
| DELETE | `/imports/mapping-profiles/:id` | ESG-lite | Admin, Superadmin, or the Manager who confirmed it | "Forget this mapping" |
| PATCH | `/admin/companies/:id` (exists) | ESG-lite | Superadmin | `ai_import_enabled` boolean, like `mcp_enabled` |

## 5. New row issue codes (added to `ROW_ISSUE_CODES`)
| Code | Severity | When |
|---|---|---|
| `SITE_NOT_ALLOWED` (existing IM0 code, reused) | error | The row names a site other than the one chosen for this upload (held by the caller or not) |
| `CATEGORY_NOT_ASSIGNED` | error | The category is not assigned to that site, or not in the User's grants |
| `NOT_IN_CONTEXT` | error | The model named something the context does not contain (sheet-level, mirrored on rows) |
| `LOW_CONFIDENCE_MATCH` | warning | Activity or column matched by the LLM below 0.8 and confirmed by the user; shown in "Needs attention" (XI5) |
| `PIVOT_EMPTY_CELL` | info | A months-as-columns cell was blank; no row made |

New API error: `AI_IMPORT_DISABLED_FOR_CLIENT` (403), mirrors `MCP_DISABLED_FOR_CLIENT`.

## 6. Limits (added to `limits.ts` and the python twin)
- 20 sheets per workbook; 15 sample rows per sheet to the model; 200 distinct values per candidate column to the model; 8,000 tokens of prompt per sheet; 1 LLM call per sheet per propose; `propose` 10 per user per 10 minutes.

## 7. Plan row provenance
`ImportRow.row_ref` stays `"Sheet!Cell"`. XI0 adds optional `ImportRow.meta: { source: "profile"|"rules"|"llm", confidence }` (stripped from what the engine sees; kept on `import_plan_row.input` for XI5's filter and for learning).
