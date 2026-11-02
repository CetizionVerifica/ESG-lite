---
id: thresholds-vs-last-period
title: The "vs last period" chip and change thresholds
roles: [User, Manager, Admin, Superadmin]
paths: [/data/new, /factors/thresholds]
keywords: [threshold, vs last period, vs last month, comparison, change limit, percentage change, warning, over threshold, previous month, flagged, spike, big increase]
---
ESGLite compares what you enter with the previous period and flags big changes, so mistakes like a wrong unit are caught early.

**The "vs last period" chip (Add data)**
While you type rows in [Add data](/data/new), the first row of each emission category shows a chip such as "▲ 6.2% vs Aug 2025 (threshold 5%)".
- It compares the category's total for this period (what's already saved plus what you're typing) with the previous period at the same site.
- ▲ means higher, ▼ means lower.
- When the change is bigger than your company's threshold, the chip turns to a warning colour and shows the threshold.

A warning doesn't stop you sending. If the change is real, for example a new machine, send it. If not, check the amount and the unit.

**What Managers see**
In [Approvals](/data/approvals), an entry that changed by more than the threshold against the previous month (same site, category and activity) is held under **Needs attention** with "Over your N% change limit". The Overview's "Needs your attention" list also names categories that went up by more than the threshold.

**Setting the threshold (Superadmin)**
1. Open **Factors** › [Thresholds](/factors/thresholds).
2. Choose **Set** or **Edit** on the client's row.
3. Enter a percentage from 2 to 5, with up to two decimals, and save.

A client without its own value uses the default 5%; **Use default 5%** puts a client back on it. Each client has one threshold.
