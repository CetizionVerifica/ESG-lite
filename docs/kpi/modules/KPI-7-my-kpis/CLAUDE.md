# KPI-7 · "My KPIs": the contributor's to-do list and one-question entry

> Module spec. Lane L3. Copy to `ESG-lite_FE/src/features/kpi/my-kpis/CLAUDE.md` and `ESG-lite/src/kpi/values/KPI-7.CLAUDE.md`. PR titles `[KPI-7 k/m]` (1/3 ESG-lite `GET /kpi/my` + template endpoints, 2/3 FE list + entry card, 3/3 FE table view + template upload + My month card).
> Depends on: KPI-3, KPI-4 (FE starts on mocks in wave 1) · Owns: FE `kpi/my-kpis`, `components/KpiQuestionCard`, `FrameworkBadges`, `FromYourDataChip`, `src/kpi/values/my.ts`, `src/kpi/values/template.ts` · Touches: `my-month` (a "KPIs due" card only)

## Job to be done
The same person who enters their site's fuel and electricity enters its KPIs. They open one page and see what's due, answer plain questions one at a time, attach evidence and submit, **without knowing anything about GRI, BRSR or ESRS** (D1, 05-ux S3).

## Today
- **My month** (`features/my-month`: `Checklist`, `DueBanner`, `DraftsPanel`, `SentBackPanel`) is the contributor's home, built on `contributorObligations.ts`.
- **Entry patterns:**
  - add-data (`EntryRow`, `DynamicField`, `FileDrop`, `UnitInput`, `useUnsavedGuard`);
  - drafts and submit (S3-15 part 2);
  - bulk upload templates (`bulk-upload`).

## Build
### Backend
1. `GET /kpi/my?period=&site=` returns what the caller owes:
   - one item per assigned KPI × site × due period, carrying the `kpi` (question, help, unit, allowed units, value type, breakdowns, `needs_evidence`, frameworks badges), `site`, `period` (label, start, end, due date), and `value` (current draft or submitted value, status, review comment), `last_value` (same period last year) and `source`;
   - plus the counts `{due, sent_back, done, auto}`.
2. `GET /kpi/my/template?period=` gives an XLSX with one row per due item and the columns KPI, Site, Period, Unit, Value, Breakdown…, Comment. `POST /kpi/my/template` uploads it, plans it like a bulk upload (row issues with codes), and commits as drafts.
3. Entry writes go through KPI-4 (`PUT /kpi/values`, `POST /kpi/values/submit`, evidence).

### Frontend (`05-ux.md` S3 is the spec)
1. `/kpi` My KPIs:
   - **Header:** a progress bar plus site and period pickers (`ContextChips`).
   - **Tabs:** Due / Sent back / Done.
   - **Rows:** due date, last value, status or auto chip.
   - **Empty state:** "Nothing due. You're all caught up." When nothing is assigned: "No KPIs are assigned to you yet…".
2. **`KpiQuestionCard`:**
   - the question, help, `InfoTip`, value input with `UnitInput` and a live conversion line, and last period's value with % change;
   - optional sections (breakdown with a running sum, evidence `FileDrop`, comment, estimate);
   - `FrameworkBadges`; "Save draft" and "Save and next".
   - Drafts autosave on blur and after 1 s idle. The change-limit nudge ("3× last year") is non-blocking and takes a reason.
   - Sent-back values show the reviewer's comment on top.
   - The card is a drawer on desktop and full screen at 390 px.
3. **Auto and formula items:** read-only rows with `FromYourDataChip` (link to the source rows) or `FormulaExplainer` (KPI-6), never a card.
4. **Submit all:** a confirm modal summarising what goes to whom, then a toast and a progress update.
5. **Table view:** a keyboard grid (Tab/Enter) of due items × periods, with the same validation, and a row drawer opening `KpiQuestionCard`. Download and upload template, reusing the bulk-upload drop-and-review UI.
6. **My month card:** "KPIs due: 4 · Sent back: 1 → Open My KPIs", shown only when `kpiTrackingOn`.

## Tests
- **API:**
  - `/kpi/my` lists only assigned KPIs on the caller's sites and topics;
  - last-value lookup;
  - template round trip (planned issues, committed drafts);
  - tenant isolation, switch off.
- **Unit:** grouping, due-date labels, change-limit nudge, breakdown sum.
- **Playwright:**
  - enter, autosave, reload and the draft is kept;
  - "Save and next" through 3 KPIs, then Submit all;
  - fix a sent-back value;
  - an auto row is read-only;
  - table view by keyboard;
  - template upload;
  - 390 px;
  - switch off → not available, and no My month card.

## Out of scope
Review (KPI-8). AI suggestions (KPI-12, which adds chips to the card).

## Done when
A contributor finishes a month's KPIs from one page in plain language, with nothing lost and everything evidenced, next to their emission work.
