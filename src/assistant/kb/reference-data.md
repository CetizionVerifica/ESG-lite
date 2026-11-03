---
id: reference-data
title: Reference data: countries, categories and units
roles: [Superadmin]
paths: [/setup/reference]
keywords: [reference data, country, countries, add country, add a country, delete country, delete a country, iso code, category, categories, add category, add a category, new category, edit category, delete category, delete a category, scope of a category, ghg protocol category, unmapped, assign category to sites, saving category, unit, units, add unit, add a unit, new unit, unit for a site, delete unit, delete a unit, fits no emission category]
---
Reference data holds the lists that sites and data entry draw on. Only a Superadmin can open it. **Setup** › **Countries**, **Categories** and **Units** open the three tabs of one page. Select a row to edit or delete it.

**Countries**
Sites pick their country from [this list](/setup/reference?tab=countries).
1. Choose **Add country**.
2. Enter the **Country name** and two-letter **ISO code**, like BH or IN.
3. Choose **Add country**.

Renaming a country changes it on every site that uses it. A country used by a site can't be deleted: move those sites first.

**Categories**
[Categories](/setup/reference?tab=categories) are the activities clients report, like fuel or electricity, with their scope and the sites that report them.
1. Choose **Add category**.
2. Enter the **Category name** and pick the **Scope**: **Scope 1**, **Scope 2**, **Scope 3** or **None – counts as saving**, which isn't counted as emissions.
3. For **Scope 3**, pick the **GHG Protocol category**. Left empty, it shows as **Unmapped**.
4. Under **Sites**, tick the sites, or tick **Assign to all sites**.
5. Choose **Add category**. Tick **Add another after this** to keep going.

People enter data for a new category only once it has a [data-entry form](/capture/forms).

Taking a category off a site hides it from people there, but their entries, factors and configs are kept. A category still in use can't be deleted: take it off its sites and remove its data first.

**Units**
[Units](/setup/reference?tab=units) are what people can pick when they enter data, set per site and category.
1. Choose **Add unit**.
2. Choose the **Site** and **Category**. Only that site's categories are offered.
3. Enter the **Unit name** as people will see it, like kWh or litres. **Description** is optional.
4. Choose **Add unit**.

**Fits** shows which emission categories can use the unit. **Fits no emission category** means a row can't use it in **Add data**.

Moving a unit to another site or category, or deleting it, changes where people can pick it. Entries already saved keep their unit.
