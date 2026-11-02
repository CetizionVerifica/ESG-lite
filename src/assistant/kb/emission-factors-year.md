---
id: emission-factors-year
title: Emission factors and the factor year rule
roles: [Manager, Admin, Superadmin]
paths: [/factors]
keywords: [emission factor, emission factors, factor year, previous year factor, which factor, factor fallback, factor source, no factor, import factors, add factor, factor library, kgCO2e, GWP]
---
An emission factor turns an activity amount into emissions, for example kg CO₂e per litre of diesel. ESGLite keeps factors per site and category.

**The factor year rule**
An entry uses the factors of the year before its reporting date. Entries for 2025 use 2024 factors. A yearly financial-year entry is dated at its end (31 March), so FY 2025-26 uses 2025 factors.

If there's no factor of the matching name for that year, ESGLite uses the newest factor of that name and adds a note, for example "No 2024 factor for … ; the 2023 factor was used." In [Approvals](/data/approvals) that entry is held under **Needs attention** as "No factor for 2024". If no factor of that name exists at all, the row can't be calculated; contributors see "We can't work this row out yet. Ask your administrator."

**Saved entries keep their factor**
Each entry stores a copy of the factor it was calculated with. Changing or adding factors later doesn't change saved entries, unless someone chooses **Recalculate entries**.

**Where to see the factor**
Managers: open an entry in Approvals or the Emissions ledger. The **Calculation** section shows the factor used. Contributors never see factor values; they see their fields and the total only.

**Managing factors (Superadmin)**
[Emission factors](/factors) lists factors by client, site, category and year.
- **Add factor** adds one; select a row to edit it.
- **Import factors** reads a sheet: a simple sheet, or any layout through the AI read, which maps groups of factors to categories. Factors that already exist for the same site, category, year and name are skipped.
- The **Imports** tab lists imported batches, and a batch's factors can be deleted together.
- A factor can record its type, GWP set, geography, dataset and an optional gas breakdown.

An entry finds its factor by name, directly or through a [category mapping](/factors/mappings).
