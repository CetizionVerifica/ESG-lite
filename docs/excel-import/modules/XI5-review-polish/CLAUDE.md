# XI5 · Review and approval polish (ESG-lite + ESG-lite_FE)

> Goes to `ESG-lite_FE/src/features/approvals-ledger/CLAUDE.md` (section) and `ESG-lite/src/imports/CLAUDE.md` (section). Depends on XI0. Lanes L2 (backend) and L3 (FE). One small PR each.

## Outcome
After commit, the manager reviews the batch one row at a time, sees first the rows the AI was least sure about, and approves the rest together. Existing per-row approve/undo, reject-with-reason and batch "Approve pending" stay as they are.

## Build
- ESG-lite: `GET /user/emissions?batchId=` gains `attention=1`, returning rows whose `import_plan_row.input.meta.confidence < 0.8` or whose plan row was edited before commit (join on `upload_batch_id` + `row_ref` stored on the emission's audit entry by IM1; add `emission.import_row_ref text null` through `migrate:ai-import` if the audit join is too slow). Summary gains `attention` count. Approving a row whose uploader is the approver writes the audit reason "Approved by the uploader" (decision 6).
- FE Review rows (P07): filter chip "Needs attention (n)" default-on when n > 0; row drawer shows "Matched by: remembered / suggested (confidence) / rules" and the sheet reference `Sheet!Cell`; batch "Approve pending" confirmation names the attention count ("12 of 300 pending rows were AI-matched below 80 %; review them first?") with Review first / Approve all.

## Own tests
API test for the attention filter and tenant isolation (company 2 batch id → empty); FE logic test for the chip and dialog copy; Playwright on the Review rows path with a mocked batch.

## Audit rows
XI-08 attention filter scoped, P07 rows re-run.
