---
id: approvals
title: Approve and reject entries (Managers)
roles: [Manager]
paths: [/data/approvals, /data/ledger]
keywords: [approve, approval, approvals, reject, sign off, review entries, pending, send back, rejection reason, bulk approve, approve all ready, needs attention, held, undo, keyboard shortcuts, upload batches, emissions ledger, delete entry]
---
Managers approve or reject the data entered for their sites in [Approvals](/data/approvals). Only Approved data counts in reports.

**The queue**
The **Approvals** tab lists Pending entries, oldest first. Narrow it with the site, category and period chips, the search box and the filters. Pending entries are split into:
- **Ready**: they pass every automatic check.
- **Needs attention**: held back by at least one check, such as "No evidence", "Over your 5% change limit", "Possible duplicate" or "Unit doesn't match". The reason shows on the row.

**Approve**
- One entry: open it and choose **Approve** (or **Approve and next**). "Entry approved" appears with **Undo** for 8 seconds.
- Several: tick them and choose **Approve** in the bar that appears.
- Everything that passes: **Approve all N ready**.

**Reject**
1. Choose **Reject** for one entry, or for several ticked ones.
2. Write a **Reason** of at least 5 characters, or start from a suggestion: Wrong unit, Missing invoice, Duplicate, Wrong period.
3. Confirm with **Reject**. The person who entered it is told why, and it goes back to them to fix.

**The entry drawer**
Select a row to see **Why held**, **Activity**, **Calculation**, **Evidence** and **History**. **Edit** lets you correct it; a reason is required and the change is logged.

**Keyboard**
J and K move, A approves, R rejects, Space selects, Enter opens.

**Upload batches**
Rows from bulk upload or Claude imports arrive as batches on the **Upload batches** tab. **Review rows** opens one batch's rows; **Approve pending** approves only the rows still pending; **Reject…** asks for a reason. If you uploaded a batch yourself and its rows were changed after the upload, ask another manager to approve it.

**Emissions ledger**
The [Emissions ledger](/data/ledger) shows entries of every status. Search, sort, **Export**, edit with a reason, or delete entries.
