---
id: bulk-upload
title: Upload many rows from a spreadsheet (bulk upload)
roles: [User, Manager, Admin, Superadmin]
paths: [/capture/upload]
keywords: [bulk upload, upload spreadsheet, excel, csv, xlsx, import rows, template, download template, many rows, sheet, upload file, map columns, skipped rows]
---
**Bulk upload** imports many rows from a spreadsheet at once for one site and category. Rows are saved as Pending for the site's manager to approve.

**Open it**
- Users: in [Add data](/data/new) step 2, choose **Upload it in bulk**. The site, category and period are filled in for you.
- Managers and Admins: **Bulk upload** in the menu. Superadmins: **Capture** › **Bulk upload**.

If smart import is on for your client, Managers, Admins and Superadmins start in smart import. Choose **Manual upload** in the page header for the steps below.

**Steps**
1. **Upload**: choose the **Site** and **Category** (Superadmins pick the **Client** first). Under **Period**, choose **Monthly** with a **Reporting month**, or **Yearly** with a calendar and **Year**. Choose **Download template** for a sheet with the right columns and fill it in. Drop it in **Spreadsheet** (.xlsx, .xls or .csv, up to 100 MB; one sheet, header row first). Choose **Upload and map columns**.
2. **Map columns**: match each field the form needs to a column of your sheet. Columns named as in the template map themselves (**Matched**); anything marked **Check** needs a look. Every row needs a category and a unit. Choose **Preview rows**.
3. **Preview**: see the first rows with their tCO₂e. Rows marked "Won't import" have an issue: fix the file, or import without them.
4. **Import**: choose **Import N rows**.

On a monthly upload, rows without their own date are filed in the reporting month; map a date column to file rows month by month. A yearly upload files each row as one entry for the whole year.

**After the import**
The result shows what was imported and what was skipped. **Download skipped rows** lists the reasons; **Start another upload** begins again. Rows are checked again and saved together, so a failed import saves nothing. You can leave the page while it runs; you'll get a message when it's done.

The site's manager approves the rows in Approvals, under **Upload batches**.
