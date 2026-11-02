---
id: units
title: Units: pick the one on your bill
roles: [User, Manager, Admin, Superadmin]
paths: [/data/new, /data/mine]
keywords: [unit, units, litres, kWh, kg, tonnes, wrong unit, unit error, convert, conversion, unit converted, choose a unit, unit cant be used, unit missing]
---
Every row needs a **Unit**: the unit of the amount you're entering.

**Pick the unit on your bill**
1. In [Add data](/data/new), make the row's choices first. The **Unit** list stays empty until then ("Make your choices above first" or "Choose the emission category first").
2. Open **Unit** and pick the unit your bill or meter uses, for example litre or kWh.
3. Type the amount exactly as it appears on the bill. Don't convert it yourself.

If ESGLite calculates in a different unit, it converts your amount and shows "unit converted" under the row's total.

Some forms fix the unit. Then the unit is shown as text instead of a list, and you enter the amount in that unit.

**Unit messages**
- "This unit can't be used here. Choose another unit." The unit can't be converted for this row. Pick another one from the list.
- A unit marked "(no longer offered)" isn't on the form any more. Pick another one.
- If the unit you need isn't in the list, ask your administrator.

**Bulk upload**
Every row of a sheet needs a unit. In **Map columns**, map the column that holds it to **Activity unit**.

**For Managers, Admins and Superadmins**
You also see which unit the calculation uses, and a hint when a row's unit is converted. In [Approvals](/data/approvals), an entry whose unit doesn't fit is held under **Needs attention** with the reason "Unit doesn't match".
