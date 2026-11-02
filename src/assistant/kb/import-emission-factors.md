---
id: import-emission-factors
title: Import emission factors and delete an import
roles: [Superadmin]
paths: [/factors]
keywords: [import factors, import emission factors, upload factors, factor sheet, simple sheet, AI read, any other layout, DEFRA, workbook, read sheet, read with AI, check layout, re-analyze, map to categories, batch, import batch, delete batch, imported factors, uploaded sheets, imports tab, not saved, recalculate entries, wrong factor, save to]
---
**Import factors** on [Emission factors](/factors) loads many factors from one sheet. Only a Superadmin can do it.

**Start an import**
1. Choose **Import factors**.
2. Pick the **Client**, then **Save to**: one site, or all sites of the client. All sites only gets factors where the site reports the category.
3. Under **What kind of sheet is it?**, choose one:
   - **Simple sheet**: one row per factor with columns year, factor_value, unit, source and emission_category_name.
   - **Any other layout (AI read)**: DEFRA-style workbooks with sub-columns, groups or several sheets.
4. Add the **Sheet** (.xlsx or .xls, up to 10 MB), then choose **Read sheet** or **Read with AI**.

**AI read only**
- **Check layout**: check the sheet and columns. If you change a column, choose **Re-analyze** before **Continue**.
- **Map to categories**: each group becomes factors of one category. Groups left empty are skipped.

**Preview and save**
On a simple sheet, pick the **Category** here. Edit cells, or untick **Include** to leave a row out. Fix or exclude flagged rows. Every included row is saved, whatever the filters show. Factors that already exist for the same site, category, year and name are skipped. Choose **Save factors**, and the **Result** shows what was added and skipped per site.

**The Imports tab**
- **Imported factors**: each import's factors by site and category. Factors added by hand don't appear here.
- **Uploaded sheets**: sheets read by AI. "Not saved" means it was read but no factors were created from it.

**Delete an import**
Under **Imported factors**, choose the bin icon on the row, then **Delete batch**. Every factor that import created goes, even across several sites and categories. Entries already calculated keep their totals, and product footprint inputs that used them lose their factor link. This can't be undone.

**After correcting a factor**
Saved entries keep their old totals until you recalculate. Saving a new value offers this, or choose **Recalculate entries** on a factor or on selected rows. Approved entries stay approved, and entries in a locked month are left as they are.
