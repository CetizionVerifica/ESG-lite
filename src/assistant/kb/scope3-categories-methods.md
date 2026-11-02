---
id: scope3-categories-methods
title: Scope 3 categories, the boundary and calculation methods
roles: [Manager, Admin, Superadmin]
paths: [/settings/scope3, /settings/scope3/screening, /suppliers]
keywords: [scope 3 categories, category 1, purchased goods, calculation method, methods, spend based, amount spent, supplier specific, average data, scope 3 boundary, included, excluded, not relevant, FERA, category 3, fuel and energy related, screening, unmapped]
---
Scope 3 has 15 GHG Protocol categories. ESGLite names them by number and name, from "Category 1 · Purchased goods and services" to "Category 15 · Investments".

**The Scope 3 boundary**
[Scope 3 boundary](/settings/scope3) records, for each category, whether it's **Included**, **Excluded** or **Not relevant**, with the reason. Reports list exclusions with these reasons. Admins and Superadmins change it; Managers can read it.
- A Superadmin confirms which GHG Protocol category each of the company's own categories belongs to. Until then, reports show it as Unmapped.
- **Consolidation approach** decides what counts in Categories 8, 13, 14 and 15.
- **Screening** helps you judge the size of each category.

**Calculation methods**
Each Scope 3 entry records how it was calculated. Methods include, most specific first:
- **Supplier's own figure** and **Supplier's energy and materials** (Categories 1 and 2)
- **Average data** (worded per category, for example "Average for the material")
- **From the amount spent**: the amount, converted to the factor's currency, times a spend-based factor
- **From fuel used** and **Distance travelled** for transport and travel
- **By waste type and treatment** for waste and end of life
- Asset-, site-, franchise-, investment- and project-specific methods in the downstream categories

A Superadmin chooses which methods each data-entry form offers. Contributors never pick a method: they answer the form's questions and the form decides. Managers see the method under "How it was calculated" in the entry drawer.

**Category 3 (fuel- and energy-related activities, FERA)**
When a fuel or electricity entry is saved, ESGLite can add a linked Category 3 entry for the upstream emissions, and for electricity the transmission and distribution losses. This happens only when a matching factor exists for that year. The linked entry follows its parent's status.

**Suppliers**
[Suppliers](/suppliers) holds your suppliers and their own figures, which the supplier methods use.
