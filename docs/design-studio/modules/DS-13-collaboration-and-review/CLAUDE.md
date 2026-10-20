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
