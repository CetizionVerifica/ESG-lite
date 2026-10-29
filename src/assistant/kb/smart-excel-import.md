---
id: smart-excel-import
title: Smart import of any workbook
roles: [Manager, Admin, Superadmin]
paths: [/capture/upload]
keywords: [smart import, smart excel import, AI import, workbook, any layout, confirm mapping, review rows, remembered mapping, forget this mapping, several sheets, check them, manual upload, mapper]
---
**Smart import** reads a workbook in almost any layout. It works out the sheets, columns, periods and activities, and lets you check them before anything is imported. It's for Managers, Admins and Superadmins, and only when a Superadmin has switched **Smart import** on for the client.

**Steps**
1. Open [Bulk upload](/capture/upload). Smart import is the default when it's on; switch with **Smart import** or **Manual upload** in the page header.
2. **Upload**: pick the **Site** and drop the workbook (.xlsx, .xls or .csv, up to 100 MB). One upload is for one site. Rows for other sites are skipped, so upload the file again for each site.
3. **Confirm mapping**: one card per sheet shows the category, the period, which column feeds each field, and how each activity wording was matched. Chips read **Matched**, **Remembered**, **Suggested** or **Check**. Fix anything on **Check**; you can't continue while a required part is on Check. You can leave a sheet out.
4. **Review rows**: the planned rows with their tCO₂e and issues. Filter by issue, skip or edit a row, or **Skip all rows with this issue**.
5. **Import**: commit. Rows that still have an issue are left out.

When the mapping model is confident, ESGLite can go straight to **Review rows** and list what it held back for you. **Check them** opens those parts; **Change mapping** goes back to Confirm mapping.

**Remembered mappings**
After an import, ESGLite remembers how that layout was mapped. Next time a card shows "Last time you mapped this as…". **Use it** applies it. **Forget this mapping** removes it for everyone at your company; only the person who confirmed it, or an admin, can do that.

**After the import**
Rows are saved as Pending. A Manager gets a **Review rows** link to the batch in [Approvals](/data/approvals). For an Admin or Superadmin, the site's manager approves them under **Upload batches**.

If the mapper isn't available, choose **Map the columns yourself** to use the manual steps.
