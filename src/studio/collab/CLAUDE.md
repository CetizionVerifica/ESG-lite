# DS-13 · Collaboration: comments, @mentions, tasks, approval, version history, locks, brand controls

> **Module spec**, lane L2, wave 5. Copy to `ESG-lite/src/studio/collab/CLAUDE.md`.
> **PR titles:** `[DS-13 k/m]`, five PRs:
> 1. comments + mentions + tasks;
> 2. approvals + require-review switch;
> 3. version history (autosave snapshots, restore);
> 4. template locks, save as template or layout, brand controls;
> 5. FE review UI.
>
> **Depends on:** DS-5, DS-6, DS-12 · **Owns:** `report_comment` (+mentions, tasks), `report_approval`, `company.report_require_review`, `company.brand_controls`, `src/studio/collab/*`, FE `studio/review/*`
> **Base:** RS-10 (comments, review status, drift, templates from a doc, locks). Kept. Changes are below.

## Changes from RS-10
1. **@mentions:**
   - autocomplete of company users with studio access;
   - a mention sends an in-app notification and an email (`notificationService`, a new `studio_mention` type) with a deep link to the page and element.
2. **Tasks:** "Assign as task" on a comment sets an assignee and notifies them; tick done; a filter for "My tasks"; open tasks show as an info check.
3. **Approval** (D14):
   - Request approval (reviewer = a Manager, optional due date, note);
   - the reviewer sees the approval bar → Approve / Request changes (note required);
   - a request is tied to `rev`, and an edit after approval marks it "Approved an earlier version";
   - with `report_require_review`, a final needs an approval for the current rev.
4. **Version history** (D16):
   - autosave snapshots every 10 minutes of activity and on named saves;
   - a list grouped by day; read-only preview; **Restore** makes a new rev;
   - pruning job: 90 days or the last 200; finals and named versions are kept.
5. **Brand controls** (`company.brand_controls`, Superadmin): colour and font pickers limited to the brand kit (DS-3 hook), and template-locked elements are not unlockable by Admins.
6. **Drift:** RS drift for both sources (GHG data hash).

## Tests
- **API:** a mention notifies only users with access; approval roles; a restored version makes a new rev; pruning keeps finals.
- **Playwright:** mention a colleague, assign a task, request approval, approve, generate the final.

## Done when
A team can review, assign and approve a report inside the studio, and roll back any edit from history.

## As built (2026-10-20, branch `ds-13-collab` in ESG-lite and ESG-lite_FE, local only)

### Files
**ESG-lite**
- Tables (entities registered in `src/config/data-source.ts`, `// DS-13`): `src/entities/StudioReportComment.ts` (`report_comment`: RS columns + `company_id`, pin `x`/`y` in mm, `mentions int[]`, `task_assignee_id`, `task_done_at`, `task_done_by`, `deleted_at`), `src/entities/StudioReportApproval.ts` (`report_approval`: §3 columns + `company_id`, `decision_note`, `decided_by`), `src/entities/StudioDataBaseline.ts` (`report_data_baseline`: the figures a doc showed under one data hash, for drift "before"); `Company.ts` + `report_require_review`, `brand_controls` (`// DS-13`). Migration `src/scripts/migrateDs13Collab.ts` → `npm run migrate:ds-13-collab` (TypeORM's own SQL, IF NOT EXISTS; run twice and `ci/schema-diff.cjs` clean).
- Contracts: `src/studio/contracts/collab.ts` (request schemas, `ReportComment`, `StudioPerson`, `ReportApproval`, `ApprovalsResponse`, `ReviewSettings`, `DriftResponse`, template/layout bodies, `STUDIO_NOTIFICATION_TYPES`), exported from `contracts/index.ts`; `contracts/checks.ts` + `COLLAB_CHECK_IDS = ['OPEN_TASK']` (info). `ci/studio-contracts.json` regenerated (FE copy updated). **Needs a DS-0 follow-up to land in 01-contracts §4/§6.**
- `src/studio/collab/`: `people.ts` (who can be mentioned/assigned/asked: company Managers and Admins who can read every site of the design), `notify.ts` (in-app `createNotification` + email via `sendEmailForApprove`, deep link, `notification_preferences.email_studio = false` mutes the email), `comments.ts`, `approvals.ts` (+ `approvalFinalGate`), `drift.ts` (+ DATA_CHANGED/OPEN_TASK checks), `history.ts` (pruning job), `locks.ts`, `templates.ts`, `settings.ts`, `versionPreview.ts`, `router.ts`.
- Shared lines (`// DS-13`): `src/studio/router.ts` (one `router.use`), `src/index.ts` (`startStudioHistoryScheduler()`), `src/studio/docs/service.ts` (`registerPatchGuard`, run in `patchDoc` before the save), `src/studio/checks/service.ts` (`registerCheckProvider`, appended to `evaluate`), `package.json` (`migrate:ds-13-collab`), `ci/api/tests/ds-lib.cjs` and `ci/golden/ds/lib/routes.cjs` (the new routes), `ci/unit/ds-0-contracts.test.cjs` (check count), `ci/golden/ds/contracts/*.json` (OPEN_TASK in the check-id lists: intended).
- Tests: `ci/api/tests/ds-13-collab.test.cjs` (13), `ci/unit/ds-13-collab.test.cjs` (8).

**ESG-lite_FE** (see `src/features/studio/review/CLAUDE.md`)
- `src/features/studio/review/`: `api.ts`, `store.ts`, `logic.ts` (+test), `MentionInput.tsx`, `ReviewPanel.tsx` (Comments | Data changes), `CommentPins.tsx`, `CommentsButton.tsx`, `register.ts`, `ReviewLinks.tsx`, `DriftBanner.tsx`, `ApprovalBar.tsx`, `RequestApprovalDialog.tsx`, `ReviewSettingsCard.tsx`, `SaveTemplateDialog.tsx`, `TemplateUnlock.tsx`, `VersionsPage.tsx`, `review.test.tsx`; `e2e/ds-13-review.spec.ts`.
- Shared lines (`// DS-13`): `editor/plugins.ts`, `editor/TopBar.tsx` (Comments n replaces the Comment button; File ▾ Version history, Save as template…, Save this page as a layout…), `editor/Editor.tsx` (ApprovalBar, DriftBanner, ReviewLinks, ReviewPanelHost), `editor/SelectionLayer.tsx` (the shell's local pin only while the stub handler is registered), `editor/PositionPanel.tsx` (TemplateUnlock), `share/ShareMenu.tsx` (People and comments, Request approval), `checks/FinalForm.tsx` (the approval block), `lib/studio/outputs.ts` (DS_APPROVAL_PENDING reasons), `home/HomePage.tsx` (ReviewSettingsCard), `routes.tsx` (`studio-versions`), `lib/studio/contracts.ts` + snapshot, `test/msw/studio.ts` (+ its test).

### Endpoints (behind `requireDesignStudio`; role R unless noted; the doc is loaded first: another company → 404, sustainability with KPI off → DS_KIND_OFF, unreadable sites → 404)
| Route | Notes |
|---|---|
| `GET /docs/:id/people` | `StudioPerson[]` `{id, name, role, canApprove}` (no emails) |
| `GET /docs/:id/comments?resolved=1&tasks=mine\|open` | oldest first; a resolved root hides its thread unless `resolved=1` |
| `POST /docs/:id/comments` | `{pageId, elementId?, x?, y?, parentId?, body ≤ 4000, mentions?, taskAssigneeId?}` → 201; mentions outside `people` (Users, other companies, unknown ids, yourself) are dropped and never notified; an assignee outside it is DS_VALIDATION; a reply joins its thread's root (one level) and its page/element |
| `PATCH /comments/:id` | `{body}` author only (DS_ROLE); `{resolved}` anyone on the design |
| `DELETE /comments/:id` | author or a Manager → 204 (soft) |
| `POST /comments/:id/task` · `PATCH /comments/:id/task` | `{assigneeId \| null}` (notifies a new assignee once) · `{done}` |
| `GET /docs/:id/approvals` | `{approvals, current, stale, rev, requireReview}` |
| `POST /docs/:id/approvals` | `{reviewerId, dueAt?, note?, rev}` → 201; reviewer = a Manager in `people`, not yourself; stale `rev` → DS_VERSION_CONFLICT; a final design → DS_FINAL_IMMUTABLE; withdraws the open request |
| `POST /approvals/:id/decide` | **M** (`requireManager` first, so an Admin gets DS_ROLE before the tenant check, ds-probes DS-P04), then only the named reviewer (or a Superadmin); `{decision: approve\|request_changes, note}` (note required for changes) |
| `DELETE /approvals/:id` | the requester (or a Superadmin) withdraws an undecided request → 204 (`state = none`) |
| `GET /docs/:id/drift` | `{dataHash, changed[{elementId, pageId, pageName, text, basedOnHash, before, after, figures[]}]}` |
| `GET /docs/:id/versions/:n/preview.html?mode=paged\|sheet` | the version's own doc, read-only, same renderer and CSP as DS-11's preview |
| `GET /review-settings` · `PUT` | `{requireReview}` M · `{brandControls}` Superadmin; audited (`design_studio`/`review_settings`) |
| `POST /templates/from-doc` · `POST /layouts/from-page` · `DELETE /templates/:id` | company template (+ one layout per free-form page) · company layout · archive (system templates 404) |
| `POST /docs/:id/jobs {kind:'final'}` (DS-11) | with `report_require_review` on: 409 DS_APPROVAL_PENDING `{reason: none\|requested\|changes_requested\|stale, approvalId}` unless the newest request is approved **for this rev**; runs before DS-12's checks gate |

### Decisions and deviations
1. **Approval and `report_doc.status`.** The approval lives in `report_approval` only; DS-13 doesn't set `report_doc.status` to `in_review`/`approved` (an edit after approval would need DS-5's PATCH to reset it). "Approved an earlier version" is `current.rev !== doc.rev`. The FE shows the bar from `GET /approvals`.
2. **Approving ties the approval to the rev the reviewer approved** (the design as it is when they click Approve), not the request's rev: the reviewer looks at the live design. A new request withdraws the open one (state `none`, kept for history).
3. **Notifications:** types `studio_mention`, `studio_task`, `studio_approval_requested`, `studio_approval_decided`; the email is sent directly with `sendEmailForApprove` (skipped when mail isn't configured), not through the RabbitMQ email consumer, so `emailConsumer.ts` stays untouched. Links: `/studio/:id?page=&el=&comment=` (comments, tasks) and `/studio/:id?approval=` (approvals).
4. **Pins:** `report_comment` gets `x`, `y` (mm) beside RS's page/element anchor, so C + click keeps its spot.
5. **Drift (both sources):** DS-5 stamps `basedOnHash` only on bound elements and texts with chips, so a typed text without a stamp is measured against the design's build hash (`report_doc.data_hash`). A text is "about data" when it holds chips, or typed digits on a page that shows figures. "Before" comes from `report_data_baseline` (figures recorded under each hash whenever drift or the checks resolve the doc); when the old hash's figures weren't recorded, the text is listed with "before" unknown. With a baseline, a text is listed only when a figure **on its page** changed. "Mark as checked" is an editor edit (the element gets the current hash; autosave saves it), as RS-10 describes; no separate endpoint.
6. **DATA_CHANGED** (warning, RS-10) and **OPEN_TASK** (info, new) come from a check provider registered with DS-12's `evaluate`; a final needs DATA_CHANGED acknowledged like any warning. The fixture GHG doc's `p-summary.body` (stamped `sha256:abc`) now raises DATA_CHANGED in DS-11/12 tests; their `readyForFinal` acknowledges it.
7. **Version history:** DS-5 already makes the 10-minute autosaves and prunes the doc it saves; DS-11 lists, names (snapshot) and restores. DS-13 adds the nightly pruning job for every design (`pruneAllHistory`, 03:20, `STUDIO_HISTORY_JOB=off`; `node dist/studio/collab/history.js` runs it once), the read-only version preview, and the FE screen. The preview of an old version resolves figures against today's approved data (a version keeps only its data hash); a final's figures as printed are in its stored PDF.
8. **Brand controls:** `PUT /review-settings {brandControls}` (Superadmin) rather than the client page's company PUT; DS-3's `BrandKit.brandControls` already reads the column. With it on, an Admin's PATCH that moves, edits, removes or unlocks a template-locked element answers 403 DS_ROLE `{reason: 'template_locked', elementIds}`; Managers may unlock. Colour/font limits are the DS-3 FE hook (`useBrandControls`); the server doesn't police colours in PATCH.
9. **Template locks:** a template is saved from a design; elements the author locked (`locked`) become `templateLocked` in the template ("Lock locked elements for everyone", default on). `basedOnHash` and `reviewed` are dropped from template docs. A re-save is version n+1 of the same slug (older archived, as DS-4's loader does).
10. **Require review** is set by Managers (and the Superadmin) on the studio home (RS said Admins; finals and approvals are M decisions in DS, so the switch that gates them is too).
11. **Routes added outside 01-contracts §4** (listed in `ds-lib.cjs`/`routes.cjs` as "awaiting a DS-0 contracts follow-up"): `GET /docs/:id/people`, `GET/POST /docs/:id/comments`, `PATCH/DELETE /comments/:id` (RS routes), `GET /docs/:id/approvals`, `GET/PUT /review-settings`, `DELETE /templates/:id`, `GET /docs/:id/versions/:n/preview.html`.
12. **FE:** the top bar's "Comment" button became "Comments n" (opens the panel; C still drops a pin; the panel has "Pick a spot (C)"). The review panel and the checks panel share the spot beside the canvas (the newer one wins). "Ask AI to update" selects the text and opens the AI drawer (DS-9's chat); it doesn't pre-fill a prompt.

### Tests run
- `test-lane.sh ds-13-be` (at `ba314e6`): build ok, unit ok, scope3-golden 32/32, calculation snapshot matches (23 entries, 6 reports), API 775 pass / 0 fail (ds-13: 13), workflow 55 pass / 0 fail / 9 skipped + 29 pass (DS-W10 probes: 0 findings after the decide route took `requireManager`).
- Migration: run twice on a throwaway DB, then `ci/schema-diff.cjs`: "Nothing to migrate".
- `test-lane.sh ds-13-fe` (at `3351b93`): typecheck ok, lint:new ok, vitest 1978 pass (210 files). Playwright: `ds-13-review` 2/2; `ds-0-switch`, `ds-5-reports`, `ds-6-editor`, `ds-11-outputs`, `ds-12-checks` 16/16.

### Not done
- **Real-time:** comments and approvals refetch every 60 s and after each action; no SSE push into an open editor (the notification bell gets the SSE push).
- **Email templates:** a plain inline HTML email (`notify.ts`), not a branded template in `src/templates/`; no digest (one email per mention/task/approval event).
- **Commenter view for Users (D5/D13 "if changed")**: not built (Users still can't see the studio).
- **Server-side colour/font enforcement under brand controls** (only template locks are enforced on PATCH).
- **"Ask AI to update" with the old text as input** (RS-10 §5): opens the AI drawer on the selected text only.
- **Version preview "as it was"**: figures resolve to today's data; no per-version data snapshot except finals.
- **Real-backend Playwright**: the e2e mocks the API, as every FE spec does.
