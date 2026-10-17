# KPI-8 · Review and close (Manager): checks, approve all ready, period lock

> Module spec. Lane L4. Copy to `ESG-lite/src/kpi/review/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/review/CLAUDE.md`. PR titles `[KPI-8 k/m]`.
> Depends on: KPI-4, KPI-7 · Owns: `src/kpi/review/*` (`checks.ts`, `approve.ts`, `lock.ts`), FE `kpi/review` · Touches: `approvals-ledger` (a "KPIs" tab), `notificationService` (kinds `kpi_submitted`, `kpi_rejected`, `kpi_due`)

## Job to be done
The Manager who approves a site's emissions approves its KPIs in the same place and the same way:
- approve everything that passes the checks in one action;
- look only at what needs attention;
- close the period when it's complete (D11, 05-ux S4).

## Today
- **Approvals** has Ready / Needs attention groups from row `checks`, `useApproveAllReady`, `RecordDrawer`, `RejectReasonModal` and `useUndoableApprove`.
- **Close month:** `CloseMonthView`, `/periods/lock`.
- **Change limit:** the company setting `Threshold.threshold_percentage`.

## Build
### Backend
1. **`checks.ts`:** the 01-contracts §5 checks, computed on submit and on evidence changes and stored in `kpi_value.checks` as `{ready, held: [...]}`.
2. **Approve and reject:** `PUT /kpi/values/approve` and `PUT /kpi/values/reject`.
   - `approve` takes `{ids, only_ready?}`; `reject` takes `{ids, reason}`. The reason is required (`KPI_REASON_REQUIRED`).
   - Scope: a Manager's own sites, or Superadmin. Admins can't approve (D11).
   - A Manager approving their own entry is refused, as for emissions.
   - Approval triggers KPI-6 recompute and KPI-5 staleness where relevant.
   - Notifications: `kpi_rejected` to the owner with the reason; `kpi_submitted` to reviewers (one per submit batch).
3. **Period close:** `GET /kpi/periods/lock` returns what's left per site (missing, draft, pending, rejected). `POST /kpi/periods/lock` refuses while anything is left (`KPI_PERIOD_INCOMPLETE`). `POST /kpi/periods/unlock` takes a reason and is audited.
4. **Reminders:**
   - a daily job (using the existing scheduler or cron pattern) sends `kpi_due` 5 days before and on the due date to owners with missing values (D16);
   - owners can mute it in notification preferences.

### Frontend
1. **Approvals tab "KPIs"** (`?view=kpi`), shown only when `kpiTrackingOn`:
   - **Groups:** Ready (n) / Needs attention (n).
   - **Rows:** site, KPI, period, value plus unit, change vs last year, reason chips.
   - **Approve all ready:** with an undo. Keyboard J/K/A/R as in emissions.
2. **Drawer:**
   - question, value, conversion, breakdown, evidence (`DocumentViewer`), a 6-period mini chart, history (`AuditTimeline`) and the formula explainer for calculated values;
   - Approve / Reject (with reason chips "Wrong unit", "Missing evidence", "Looks too high", "Wrong period").
3. **Close KPI period:** the `CloseMonthView` pattern with KPI wording.

## Tests
- **API:**
  - each check held and passed;
  - `only_ready`;
  - self-approval refused;
  - reject needs a reason;
  - approve triggers recompute;
  - lock refuses while incomplete, and unlock needs a reason;
  - tenant isolation, roles (Admin can't approve), switch off.
- **Playwright:**
  - approve all ready, with undo;
  - reject with a reason, after which the contributor sees it in Sent back (with KPI-7);
  - close the period;
  - the tab is hidden when the switch is off.

## Out of scope
Multi-level approval chains. External assurance workflows (assurer access, a later module).

## Done when
KPI values get reviewed with the same speed and safety as emissions, and a complete period can be locked.
