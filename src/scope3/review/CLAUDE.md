# S3-15 · Review workflow: Draft, automatic checks, month lock

> Module spec. Lane L5. Copy to `ESG-lite/src/scope3/review/CLAUDE.md`, `ESG-lite_FE/src/features/approvals-ledger/S3-15.CLAUDE.md` and `ESG-lite_FE/src/features/my-month/S3-15.CLAUDE.md` as the first commit. PR titles `[S3-15 k/m] …` (part 1: 1/4 ESG-lite checks, 2/4 FE review queue; part 2: 3/4 ESG-lite draft, submit, lock, 4/4 FE My month, fix, close month).
> Depends on (merged): S3-0 (part 1), S3-3 (part 2) · Owns: `src/scope3/review/*` (checks, period lock), `Emission.status` adds `draft`, `period_lock` table, FE my-month and approvals-ledger changes from the canvas · Touches: `emission.controller.ts` approve/reject, `emissionWrite/index.ts` (status on insert)

## Job to be done
A contributor fills the month as drafts, fixes what was sent back and submits it in one go. A manager approves everything that passes the automatic checks in one action, looks only at the rows that need attention, and locks the month once every site and Scope 3 category is complete (canvas https://claude.ai/artifact/D8kfAoEqCUvRJNjwFjwzqW, 6 screens).

## Guidance (what the GHG Protocol expects)
- Collected data should be reviewed and its quality assessed with the same approach every period, prioritising low-quality, high-emission activities (L1402-1409).
- Data quality must be described in the report (L1410-1411); a locked, approved month is what the report reads.
- Corrections to approved base-year data are a recalculation trigger (L1420-1422), so reopening a locked month needs a reason and an audit trail (S3-14 reads it).

## Today (evidence)
- Statuses are Pending, Approved, Rejected in a Postgres enum, not varchar (`ESG-lite/src/entities/Emission.ts:15-19, 42-47`); rows are inserted as pending (`src/services/emissionWrite/index.ts:157`).
- Approve and reject routes: single, bulk, batch, with `requireReviewer` (`src/routes/user.routes.ts:122-136`); FERA twins follow the parent (`src/utils/feraFold.ts:1-21`).
- Company change threshold exists (`src/entities/Threshold.ts:24-25`, default 5 %) but no check uses it on review; XI5 "needs attention" for smart-import rows (`src/controllers/emission.controller.ts:79-101`).
- My month: per-category todo/pending/approved/rejected/covered, due 10th, escalation 15th (`src/controllers/myMonth.controller.ts:9-20, 41-60`); FE has `DueBanner`, `SentBackPanel`, `Checklist` (`ESG-lite_FE/src/features/my-month/components/`).
- Approvals FE has keys, undo approve and reject reasons (`src/ui/hooks/useRowKeys.ts:22`, `src/ui/hooks/useUndoableApprove.ts`, `src/ui/review.ts:4`) but no ready/attention split, no check reasons, no lock.

## Build
### Backend (ESG-lite)
Part 1 (checks, read-only; status flow unchanged):
1. `migrate:scope3-review-checks`: `emission.checks jsonb null`; backfill pending rows in batches of 1,000.
2. `review/checks.ts`: pure `computeChecks(row, ctx) → {ready, held: CheckId[]}` for the §8 ids: `FACTOR_FOUND` (snapshot factor for the target year, no `FACTOR_FALLBACK_YEAR`), `UNIT_OK`, `EVIDENCE_ATTACHED`, `WITHIN_THRESHOLD` (vs the previous month, same site, category and `emission_category`; no previous month passes), `NO_DUPLICATE`, `IMPORT_MATCH_SURE` (reuse the XI5 `attentionSql` rule), `METHOD_GIVEN` and `DQ_ACCEPTABLE` (pass as "not applicable" until S3-3 fields exist). Ready = nothing held.
3. Recompute and store `checks` on insert (`emissionWrite/index.ts`), edit, evidence add or remove, and when the previous month changes. `GET /user/emissions` returns `checks` and `summary.{ready, attention}`. S3-0 follow-ups: list filter `ready=1|0` and `PUT /user/emissions/bulk-approve {ids, only_ready: true}` (skips rows not ready, returns them) in §5.
Part 2 (behind `company.review_workflow_v2`, default off, D9):
4. `migrate:scope3-review-workflow`: `company.review_workflow_v2`, `ALTER TYPE emission_status_enum ADD VALUE IF NOT EXISTS 'draft'` (TypeORM's default enum name, confirm with `\dT`; run outside a transaction; S3-0 follow-up: §4 says "still varchar", correct it), `period_lock` (§4, unique on company, site, year, month).
5. Insert: with the switch on, rows typed by a User are saved `draft`; imports, bulk, Claude and Manager entries stay pending. A contributor's edit of a rejected row makes it `draft` again. Drafts never appear in manager queues, reports, thresholds or My month totals; FERA twins share the parent's status.
6. `POST /user/emissions/submit {ids}`: own drafts only → pending, checks recomputed, one notification to the site's managers. Per-id result `{submitted, refused: [{id, code}]}` with `NOT_DRAFT`, `PERIOD_LOCKED`.
7. `review/lock.ts`: `GET /periods/lock?year&month` → per site: categories owed (`contributorSiteCategories`) with counts by status, "Nothing this month" markers, Scope 3 grid (15 cells: S3-1 status × data present), and `left: [{site, category, reason}]`. `POST /periods/lock {site_id | null, year, month}`: Manager for own sites, Admin and Superadmin company-wide (null = every site, D11); refused while `left` is not empty. `POST /periods/unlock {site_id, year, month, reason}` (≥ 5 chars else `UNLOCK_REASON_REQUIRED`). Audit rows `scope3_period_lock`.
8. Guard: every write to a row in a locked site-month (create, edit, delete, approve, reject, bulk, batch, import commit, MCP commit) → `PERIOD_LOCKED`; yearly rows use their period-end month, as My month does.
S3-0 follow-ups for part 2: error `PERIOD_INCOMPLETE` (lock with items left); table and endpoint for "Nothing this month" (`POST/DELETE /user/my-month/nothing {site_id, category_id, month}`); a dry-run `POST /user/emissions/check` for the live checks panel; a 6-month history read `GET /user/emissions/:id/history?months=6`; notification kind for submitted drafts; `AuditLog.entity_type` gains `scope3_period_lock`.

### Frontend (ESG-lite_FE)
Part 1:
1. `src/lib/scope3/checks.ts`: fixed label and hint per check id ("No factor for 2026", "Over your 5 % change limit").
2. Approvals tab (`src/features/approvals-ledger/`): two groups "Ready (n)" and "Needs attention (n)" (`?group=`); reason chips per held row (word + icon, never colour alone); sticky bulk bar "Approve all N ready" (undo toast 8 s via `useUndoableApprove`); J/K/A/R, Space, Enter shown in the shortcuts hint. With `?batch=` the XI5 chip keeps working; its rows are the `IMPORT_MATCH_SURE` held ones.
3. Record drawer becomes the single-entry review (canvas 5): "Why held" (each check with pass or fail), Calculation, 6-month mini chart (`ChartFrame`), Evidence, History, reject reason chips (`SUGGESTED_REASONS`), "Approve and next".
Part 2 (hidden unless the company switch is on):
4. My month (canvas 2): due banner, Sent back on top, Draft rows with checkboxes and a sticky "Submit N rows", "Nothing this month" per category (confirm + undo), status words Draft / Pending / Approved / Rejected / Missing / Locked; a locked month is read-only with a Locked banner.
5. Fix and resubmit (canvas 3): "Fix" opens the rejected row in add-data with method radio cards (S3-3), evidence `FileDrop`, live checks panel and DQ line, "Save and submit". Add-data is outside §4 for S3-15: list it under "Deviations".
6. Close month (canvas 6), Approvals tab `?view=close&period=`: site completeness table, Scope 3 category grid, "Left before you can lock" list with links, Lock disabled until the list is empty (the reason in text beside it), Reopen dialog with a required reason (focus trapped, Esc closes).

### AI service
None.

## Golden cases
None calculate. `ci/golden` stays byte-identical with the switch off (default) and on (drafts are excluded until approved anyway).

## Tests
- API (`ci/api/tests/s3-15-review.test.cjs`): each check id held and passed; company 2 token on company 1 submit, lock, unlock → 404; User lock → 403; Manager lock on another manager's site → 403; `NOT_DRAFT`, `PERIOD_LOCKED` on every write path, `UNLOCK_REASON_REQUIRED`; switch off = today's statuses; enum migration twice.
- Unit: `computeChecks`, lock completeness; FE grouping, chip labels, submit selection.
- Playwright: `e2e/approvals-ledger.spec.ts` (approve all ready by keyboard, held row opens with "Why held"), `e2e/my-month.spec.ts` (submit 3 drafts, mark one category "Nothing this month"), close-month lock disabled then enabled.

## Out of scope
Turning the switch on for clients (Shyam, D9). Changing who may approve. Year-level locks.

## Done when
- Every pending row carries checks; managers can approve all ready rows in one action and see why the rest are held.
- With the switch on: drafts, submit, and lock/unlock work as on the canvas, and locked months refuse every write with `PERIOD_LOCKED`.
- With the switch off, contributor behaviour and golden totals are unchanged.
