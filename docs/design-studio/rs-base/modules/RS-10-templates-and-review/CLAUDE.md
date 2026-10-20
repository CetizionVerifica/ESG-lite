# RS-10 · Templates and review: save as layout or template, locks, comments, approval, data drift

> **Module spec**, lanes L2 + L3. Copy to `ESG-lite/src/kpi/studio/review/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/studio/review/CLAUDE.md`.
> **PR titles:** `[RS-10 k/m]`, four PRs:
> 1. save as layout or template, and template locks;
> 2. review status and comments;
> 3. data drift;
> 4. FE.
>
> **Depends on:** RS-4, RS-6, RS-9 · **Owns:** `report_comment`, `src/kpi/studio/review/*`, `designs/saveAs.ts`, `GET /docs/:id/drift`, FE `studio/review/*`

## Job to be done
Clients build their own look once and reuse it every year. Teams review before publishing. Late data corrections never silently leave stale words in the report.

## Build
1. **Save as layout or template:**
   - `POST /layouts/from-page {docId, pageId, name, kind}` copies a page into a company-owned layout. Bound KPIs become role bindings where they match a headline role; otherwise they keep their codes.
   - `POST /designs/from-doc {docId, name}` copies theme overrides and every free-form page as layouts into a company design (version 1).
   - Company designs appear in the wizard and the layout gallery. They can be edited by re-saving and archived.
2. **Template locks:**
   - While editing a company design's layouts, an Admin or Manager (the **template author**) toggles "Lock for others" on elements (`templateLocked: true`) while editing a company design's layouts.
   - In reports made from that design, those elements can't be moved or edited (RS-6 honours it; `OVERLAPS_LOCKED` warns).
   - Unlocking needs editing the design itself.
3. **Review status:** `POST /submit-review` (R) → `in_review` + a review version snapshot + a notification to the company's Managers. `POST /approve` (M) → `approved`. `POST /reopen` (M) → `draft`.
   - Final generation from `in_review` is blocked unless approved (per company: `company.report_require_review`, default off, set by Admins in the studio home settings; migration `migrate:rs-require-review`).
   - Any PATCH while `approved` returns the doc to `draft` with a notice.
4. **Comments:** CRUD on `report_comment` (thread by `parent_id`, anchored to a page and element), resolve and reopen, @mention notifications (company users only). The FE shows pins on the sheet and a thread panel.
5. **Data drift:**
   - `GET /docs/:id/drift` recomputes `elementHash` (RS-2) for text elements and lists those whose `basedOnHash` differs, with before/after values of the KPIs they reference nearby.
   - Chips, tiles and charts refresh by themselves; only typed text is listed.
   - **FE:** a banner and a review panel with "Mark as checked" (updates `basedOnHash`) or "Ask AI to update" (RS-8 `body` with the old text as input), producing `DATA_CHANGED` warnings in RS-9 until handled.

## Golden cases (`ci/golden/rs/review/`)
- A page saved as a layout and reused in a new doc rebinds roles correctly.
- A drift fixture (one approved value changed after editing) lists exactly the affected text elements.

## Tests
- **API:** roles (only M approves; a User gets 403), tenant isolation on comments and company designs, status transitions, the `require_review` gate, drift.
- **Playwright:** save a page as a layout and use it in another report; a locked element can't be dragged; comment, resolve; approve, then generate final; change a KPI value, see the drift banner, mark checked.

## Out of scope
Real-time co-editing and presence beyond the R15 heartbeat. Exporting or importing templates between companies (Superadmin could later copy).

## Done when
- Clients can turn any report into their own reusable design with locked brand elements.
- Teams can comment and approve.
- Data changes after editing are always surfaced before a final.
