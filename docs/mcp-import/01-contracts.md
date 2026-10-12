# 01 · Contracts (owned by IM0)

The shapes every module codes against. A change here is an IM0 follow-up PR, merged before the module that needs it.
In code: `ESG-lite/src/imports/contracts.ts` (zod schemas + inferred types) and `src/imports/errors.ts` (codes). The MCP tool input schemas are generated from the same zod objects, so the HTTP API and the tools can't drift.

## 1. ImportRow (what Claude, or the P27 page, sends)

```ts
ImportRow = {
  row_ref: string            // where it came from, e.g. "Fuel 2025!B14". Required, unique within a plan. Shown back in issues.
  site_id: number
  category_id: number
  period:
    | { kind: "monthly", date: "YYYY-MM-DD" }            // filed in that month (any day; stored as sent, matched by month)
    | { kind: "yearly", year_type: "CY" | "FY", year: number }  // CY → Dec 31 of year, FY → Mar 31 of year (April FY, per decision 2026-10-10)
  activity_name: string      // the sheet's own wording ("HSD", "Grid – TNEB"); resolved server-side
  activity_value?: number    // single-value categories; required unless the form's calc spec uses fields
  activity_unit: string      // as written ("L", "litre", "kWh", "t.km"); normalised server-side
  fields?: Record<string, string | number>   // form fields by column key: calc-spec inputs and extra fields
  notes?: string             // free text, stored in extra_data.notes, max 500 chars
}
```
Rules:
- Any `total_emission`, `factor`, `factor_value`, `unit` (tCO₂e) key is **dropped** by the zod schema (strip, not error) and logged once per plan.
- Numbers are JSON numbers, dot decimal. Dates ISO. Claude converts sheet formats before sending.
- `site_id` and `category_id` come from the read tools; names are not accepted here.

## 2. PlannedRow (what the server returns per row)

```ts
PlannedRow = {
  row_ref: string
  state: "ready" | "issue" | "skipped"          // skipped = user chose to skip
  issues: RowIssue[]                             // empty when ready; warnings may exist on ready rows
  input: ImportRow                               // as stored (after strip/normalise)
  result?: {                                     // present when ready
    activity: { name: string, matched_by: "factor" | "mapping" | "plan_match" , factor_name: string }
    factor: { emission_factor_id: number, year: number, value: number, unit: string, fallback_year: boolean }
    activity_value: number, activity_unit: string, conversion?: number
    total_tco2e: number
    fera?: { category_id: number, total_tco2e: number }
    reporting_date: "YYYY-MM-DD", reporting_period: "monthly" | "yearly", year_type?: "CY" | "FY"
  }
}
RowIssue = { code: RowIssueCode, severity: "error" | "warning", message: string, field?: string }
```

### Row issue codes
| Code | Severity | Meaning |
|---|---|---|
| `SITE_NOT_ALLOWED` | error | Site unknown or not in the caller's scope |
| `CATEGORY_NOT_ASSIGNED` | error | Category not assigned to the site (or not to this User) |
| `NO_FORM` | error | No data-entry form (column config) for site × category |
| `UNKNOWN_ACTIVITY` | error | Activity name matches no factor or mapping; `message` lists up to 5 suggestions |
| `NO_FACTOR_FOR_YEAR` | error | No factor for that activity in the reporting year or any fallback year |
| `UNIT_NOT_CONVERTIBLE` | error | Unit can't be converted to the factor's unit |
| `MISSING_VALUE` / `NON_POSITIVE_VALUE` | error | Value absent, zero or negative |
| `FIELD_REQUIRED` / `FIELD_INVALID` | error | Calc-spec or required form field missing or not an allowed option |
| `PERIOD_INVALID` | error | Bad date, future month, or yearly row for a monthly-only category |
| `MODE_LOCK` | error | Monthly row inside an existing yearly batch, or the reverse, or CY/FY overlap |
| `DUPLICATE_EXISTING` | error | Same site, category, month and activity (and identity fields) already saved |
| `DUPLICATE_IN_PLAN` | warning | Same key twice in this plan (allowed, as today's import allows several rows per fuel and month) |
| `DISTANCE_REQUIRED` | error | Distance category row has places but no km (decision D6) |
| `FACTOR_FALLBACK_YEAR` | warning | Factor from an earlier year used ("no 2025 factor; 2024 used") |
| `CLIENT_TOTAL_IGNORED` | warning | The row carried a total; it was ignored |

## 3. Plan

```ts
ImportPlan = {
  plan_id: string (uuid), version: number, status: "draft" | "committed" | "cancelled" | "expired",
  company_id: number, created_by: number, channel: "mcp" | "bulk_upload" | "api",
  source_name: string,                 // workbook name as the user calls it
  created_at, updated_at, expires_at,  // expires 24 h after last change
  counts: { rows: number, ready: number, issue: number, skipped: number, warnings: number },
  totals: { tco2e: number, by_category: [{ category_id, name, scope, tco2e, rows }], by_month: [{ month: "YYYY-MM", tco2e }] },
  issues_summary: [{ code, count, example_row_refs: string[] }],
  committed?: { upload_batch_id: string, inserted: number, fera_inserted: number, committed_at }
}
```
Limits: 2,000 rows per request, 20,000 rows per plan, 10 open draft plans per user. Draft plans are visible only to their creator (and Superadmin).

## 4. HTTP API (ESG-lite, router `/imports`, app JWT or MCP token)

| Method and path | Module | Body / query | Returns |
|---|---|---|---|
| `GET /imports/context` | IM3 | `?company_id` (Superadmin required, else own) | `ImportContext` (below) |
| `GET /imports/context/activities` | IM3 | `?site_id&category_id&q&limit` | `[{ name, kind: "factor" \| "mapping", maps_to?, units: string[], latest_year }]` |
| `GET /imports/readiness` | IM3 | `?company_id&year` | per site × category: `{ form: bool, factor_years: number[], period_modes }` |
| `POST /imports/plans` | IM2 | `{ source_name, channel, company_id?, rows: ImportRow[] }` | `ImportPlan` + first 50 `PlannedRow`s with issues first |
| `POST /imports/plans/:id/rows` | IM2 | `{ version, rows }` (append) | `ImportPlan` |
| `GET /imports/plans/:id` | IM2 | `?state=issue&code&page&page_size≤200` | `ImportPlan` + page of `PlannedRow` |
| `PATCH /imports/plans/:id` | IM2 | `{ version, changes: [{ row_ref, set?: Partial<ImportRow>, skip?: bool }], activity_matches: [{ site_id, category_id, sheet_name, factor_name, save_mapping?: bool }] }` | `ImportPlan` (recalculated) |
| `POST /imports/plans/:id/commit` | IM2 | `{ version, skip_rows_with_issues: bool, idempotency_key: string }` | `ImportPlan` with `committed` |
| `POST /imports/plans/:id/cancel` | IM2 | — | `ImportPlan` |
| `GET /imports/batches` | IM2 | `?company_id&status&channel&page` | `[{ upload_batch_id, channel, source_name, created_by: { user_id, name }, created_at, rows, pending, approved, rejected, tco2e }]` |

`ImportContext`:
```ts
{ company: { company_id, name, mcp_enabled }, role, fy_start_month: 4,
  sites: [{ site_id, name, categories: [{
     category_id, name, scope: "Scope 1" | "Scope 2" | "Scope 3" | null,
     period_modes: ("monthly" | "yearly")[],
     form: { calc_mode: "single" | "per_method" | "per_unit" | "distance", fields: [{ key, label, type, required, unit?, options? }] } | null,
     units: string[], activity_count: number,
     readiness: { form: boolean, factor_years: number[] } }] }] }
```

## 5. API error codes (`src/imports/errors.ts`)
`IMPORT_PLAN_NOT_FOUND` 404 · `IMPORT_PLAN_EXPIRED` 410 · `IMPORT_PLAN_NOT_DRAFT` 409 · `IMPORT_PLAN_VERSION_CONFLICT` 409 · `IMPORT_PLAN_HAS_ISSUES` 422 · `IMPORT_TOO_MANY_ROWS` 413 · `IMPORT_TOO_MANY_PLANS` 429 · `IMPORT_DUPLICATE_ROW_REF` 422 · `IMPORT_COMPANY_REQUIRED` 400 (Superadmin) · `IMPORT_VALIDATION` 400 (body fails the zod schema; as built) · `MCP_SUPERADMIN_ONLY` 403 · `IMPORT_FORBIDDEN` 403 · `MCP_DISABLED_FOR_CLIENT` 403 · `CLIENT_INACTIVE` 403 (existing).
Body: `{ code, message, details? }`. Never SQL, stack or another company's names.

## 6. EmissionWriter interface (IM1 implements, IM2 consumes)

```ts
interface EmissionWriter {
  // Pure of side effects: resolves activity, factor, unit, spec, FERA, checks scope, mode lock and duplicates.
  planRows(ctx: WriterContext, rows: ImportRow[], opts: { planMatches: ActivityMatch[] }): Promise<PlannedRow[]>
  // Inside the caller's transaction: inserts ready rows (+ FERA twins, linked both ways), audit rows, returns ids.
  insertRows(tx: EntityManager, ctx: WriterContext, rows: PlannedRow[], batch: { upload_batch_id: string, channel, source_name }): Promise<{ inserted: number, fera_inserted: number, ids: number[] }>
}
WriterContext = { user_id, role, company_id, allowed_site_ids: number[], allowed_category_ids_by_site: Record<number, number[]> }
```
`createEmission` (typed entry) uses the same service for one row, so typed and imported totals are equal by construction.

## 7. Batch committed hook (IM2 emits, IM4 listens)
`onBatchCommitted({ upload_batch_id, company_id, created_by, channel, source_name, site_ids, rows, tco2e, months: string[] })`, called after the commit transaction succeeds. Errors in listeners are logged, never undo the commit.

## 8. MCP tools (IM7, IM8; schemas from the zod objects above)

| Tool | Module | Input | Output | Annotations |
|---|---|---|---|---|
| `whoami` | IM7 | — | Superadmin name, clients with Claude imports switched on, limits | readOnly |
| `list_sites_and_categories` | IM7 | `{ company_id }` | `ImportContext` without activity lists | readOnly |
| `get_category_form` | IM7 | `{ site_id, category_id }` | form fields, calc mode, units, period modes, 50 most used activity names | readOnly |
| `find_activity` | IM7 | `{ site_id, category_id, query }` | up to 10 matches with units and latest year | readOnly |
| `check_readiness` | IM7 | `{ company_id, year }` | readiness grid with what's missing and the app page that fixes it | readOnly |
| `plan_import` | IM8 | `{ company_id, source_name, rows, plan_id?, version? }` (plan_id = append; every row's site must belong to `company_id`) | `ImportPlan` + issue rows | not readOnly, not destructive (draft only) |
| `get_import_plan` | IM8 | `{ plan_id, state?, code?, page? }` | `ImportPlan` + rows | readOnly |
| `update_import_plan` | IM8 | `{ plan_id, version, changes?, activity_matches? }` | `ImportPlan` | not destructive |
| `commit_import` | IM8 | `{ plan_id, version, skip_rows_with_issues, confirm: true }` | `ImportPlan` with batch id | idempotent (server derives the key from plan_id + version) |
| `cancel_import_plan` | IM8 | `{ plan_id }` | `ImportPlan` | — |
| `list_upload_batches` | IM8 | `{ company_id, status?, page? }` | batches | readOnly |

MCP callers are always Superadmin (D4); every tool checks `role === "Superadmin"` again and requires `company_id` where it reads or writes client data.
Not exposed, ever: approve, reject, edit or delete entries; user or site management; factors or forms editing.
Tool results put sheet text inside a `data` object, never in the human-readable summary line, so cell text can't read as instructions from ESGLite.

## 9. MCP error mapping
API codes become tool results with `isError: true`, `content: [{ type: "text", text: "<code>: <message>" }]` and `structuredContent: { code, details }`. Auth failures are HTTP 401 with `WWW-Authenticate` (IM6), not tool errors.
