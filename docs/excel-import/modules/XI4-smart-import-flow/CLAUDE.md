# XI4 · Smart import flow on the Bulk upload page (ESG-lite_FE)

> Goes to `ESG-lite_FE/src/features/bulk-upload/CLAUDE.md` (section "Smart import"). Depends on XI0 (mocked proposal until XI2/XI3 merge) and on IM11 FE #152 being merged. Lane L3. Two PRs: 1/2 route, switch and screens on a mocked proposal; 2/2 wired to `/v1/excel/propose` and profiles.

## Outcome
A Manager opens Capture → Bulk upload, drops any workbook, sees what the app worked out, fixes what it got wrong, reviews the planned rows, commits, and lands in Review rows. Superadmin and Admin get the same flow; User keeps the prefilled contributor path.

## Screens (same stepper shell as P27, `?mode=smart` is the default when `ai_import_enabled`)
1. **Upload**: Site picker (one of the caller's sites, required; prefilled when the caller holds one site) and FileDrop; no category picker (categories come from the sheet). A line "Rows for other sites will be skipped; upload the file again for each site." When the client switch is off, the old one-site-one-category stepper shows with a note Superadmin can turn Smart import on (P17 client detail switch, added in this module).
2. **Confirm mapping**: one card per sheet. Category (fixed or "from column X"); when the sheet has a site column, a line per other site found: "Plant 9: 40 rows will be skipped (this upload is for Plant 2)", period, field → column table with chips Matched / Remembered / Suggested / Check (confidence < 0.8 or empty required field), activity matches table (sheet wording → factor, change / skip, "Save for this client" tick per decision 5), "Last time you mapped this as…" when the source is a profile, with Change. Continue is disabled while any Check chip remains on a required part. Sheets can be excluded.
3. **Review rows**: the plan from `/v1/excel/preview` (existing IM11 preview step): rows with factor, unit, tCO₂e, issues; filters by issue code including `SITE_NOT_ALLOWED`; per-row skip and edit (PATCH), "Skip all rows with this issue"; totals by category and month. Commit is disabled while error rows remain unskipped.
4. **Import**: commit; result shows imported / skipped, a link "Review rows" to `/data/approvals?period=all&batch=<id>` (P07) and the note that rows are pending.

## Rules
- Route roles: `bulk-upload` becomes `["Superadmin", "Admin", "Manager", "User"]`; the API is the gate, the route is cosmetic.
- Everything in `src/ui` tokens, four themes, 390px; no hex, no `isDark`.
- Row issues now have a third severity `info` (`PIVOT_EMPTY_CELL`); the issue filter and chips must render it.
- A suggested match carries `confidence` and `source` but no reason text (XI0 as built); if the confirm screen needs a one-line reason, XI2 adds `reason?: string` to `FieldMapping` and `ProposedActivityMatch` through an XI0 follow-up first.
- Loading, empty (a workbook with no usable sheet) and error (403 `AI_IMPORT_DISABLED_FOR_CLIENT`, rate limit, model unavailable → fall back to the manual mapper, never a dead end) states.
- TanStack Query hooks in `hooks/`; `api.ts` wraps the python endpoints.

## Own tests
`logic.test.ts` (chip rules, Continue gating, exclusion, issue filters); Playwright `e2e/smart-import.spec.ts` with mocked propose/preview/import: manager path upload → confirm → review → commit → Review rows link; out-of-scope site shown and skipped.

## Audit rows
XI-07 manager end-to-end on staging, P27-01..04 re-run.
