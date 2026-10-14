# XI1 · Workbook reader (python_AI_service)

> Goes to `python_AI_service/app/services/workbook/CLAUDE.md`. Depends on XI0. Blocks XI2. Lane L1.

## Outcome
Any .xlsx/.xls/.csv becomes a deterministic, model-free description: every sheet, its header row, cleaned data rows, candidate columns and a fingerprint. Messy layouts stop being the model's problem.

## Build
- `app/services/workbook/reader.py`: `read_workbook(path) -> Workbook` with `sheets: Sheet[]`; each `Sheet` has `name`, `header_row`, `header_depth` (multi-row headers joined with " / "), `columns: Column[]` (name, dtype guess, distinct count, sample values, fill ratio, numeric ratio, unit tokens found in header or cells like "(L)", "kWh"), `rows` (merged cells forward-filled, subtotal/total/blank/"grand total" rows dropped with their row numbers kept in `dropped_rows`), `layout` ("rows" or "months_as_columns" when ≥ 6 header cells parse as months), `fingerprint` (01-contracts §1), and `row_refs` (`Sheet!A12` for every kept row).
- Header detection per sheet: the first row where ≥ 60 % of non-empty cells are text and the next row has a different dtype profile; falls back to row 1. Reuses the existing header logic from `excel_parser` where it fits, then replaces it.
- Hidden sheets and sheets with < 2 data rows are listed with `skipped_reason`.
- Nothing here calls ESG-lite or an LLM.

## Own tests
`ci/tests/test_workbook_reader.py` on a fixture set of 12 layouts (single sheet monthly; electricity bills with a date column; multi-site one sheet; one sheet per category; yearly CY; yearly FY; months as columns; mixed units; two-row merged header; subtotal rows; a hostile cell; 15,000-row ledger). Fingerprint stable across sheet rename and row count; identical headers in a different order give the same fingerprint.

## Acceptance
Every fixture produces the expected `Sheet` description (golden JSON per fixture, checked in).
