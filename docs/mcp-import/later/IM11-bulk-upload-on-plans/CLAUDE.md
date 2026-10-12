# IM11 · Bulk upload (P27) on the plans API (python_AI_service + ESG-lite_FE)

> Blueprint spec. Section appended to `python_AI_service/app/services/CLAUDE.md` and `ESG-lite_FE/src/features/bulk-upload/CLAUDE.md`.
> Depends on: IM2 part 2. Lane L2, after MI-2. Lowest priority.

## Outcome
The in-app Bulk upload page uses the same plans and calculation as Claude. The Python import calculation is retired, so there is one engine.

## Build
- AI service keeps: upload, header detection, column mapping, unique categories. Its `/v1/excel/preview` and `/v1/excel/import` turn mapped sheet rows into `ImportRow`s and call ESG-lite `POST /imports/plans` (+ append, commit) with the caller's token (forwarded Bearer), `channel: "bulk_upload"`. `excel_parser` calculation code paths stay until the switch PR, then are removed in the same PR (definition of done 6).
- FE Preview step shows the plan's issues and totals (same components as the IM10 batch view where shared, via src/ui); Import step commits the plan.
- Snapshot: the current `ci/tests` import snapshots must give the same totals through the plan path (or the PR lists every moved figure and why).

## Own tests
python `ci/tests/test_excel_plan_client.py` (mapping → rows, chunking, error passthrough); ESG-lite API test with `channel: "bulk_upload"`; FE e2e for preview and import with mocked plans.

## Audit rows
MCP-26; existing P27-01 to P27-04 re-run.
