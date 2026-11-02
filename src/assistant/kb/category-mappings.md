---
id: category-mappings
title: Category mappings: the client's names to factor names
roles: [Admin, Superadmin]
paths: [/factors/mappings]
keywords: [category mapping, category mappings, mapping, client name, global factor name, translate names, map names, import sheet, add mapping, site mapping, no factor, wrong factor picked]
---
A category mapping translates a client's own name for something, like "HSD fuel", into the factor name entries use, like "Diesel", so entries pick the right factor. Only a Superadmin can open [Category mappings](/factors/mappings). Admins ask their Superadmin to add or change one.

**Add a mapping**
1. Open **Factors** › **Category mappings** and choose **Add mapping**.
2. Choose the **Client** and **Category**.
3. Leave **Site** on **All sites (company-wide)**, or pick one site. A site's own mapping wins over the company-wide one.
4. Type the **Client's name** exactly as it appears in their bills and sheets.
5. Pick the **Global factor name** it means.
6. Save.

**Import a sheet**
1. Choose **Import sheet**.
2. Choose the client, the category and, if needed, a site. Add an Excel (.xlsx) sheet with a column for the client's names and one for the factor names; row 1 holds the column names.
3. Review the rows read from the sheet, leave out any you don't want, then add them.

**Reading the list**
Each row shows the client, category, client's name, global factor name and site. A mapping whose factor name has no factor is marked **No factor**: add the factor in [Emission factors](/factors) or correct the name. Filter by client, category and site, or search.

**Per category and per site**
The same client name can map to different factors in two categories, or at one site. That's intended.

**Deleting a mapping**
Entries already saved keep their factor. New entries with that name won't be translated until it's mapped again.
