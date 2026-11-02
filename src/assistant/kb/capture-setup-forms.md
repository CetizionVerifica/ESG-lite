---
id: capture-setup-forms
title: Data-entry forms (capture setup)
roles: [Superadmin]
paths: [/capture/forms, /capture/columns]
keywords: [data-entry forms, data entry form, capture setup, column config, form builder, fields, choices, factor match, calculation, auto-generate, columns, new form, contributor view, methods offered, total only]
---
Data-entry forms decide what contributors fill in for each site and category, and how ESGLite calculates it. Only Superadmins set them up.

**Forms list**
[Data-entry forms](/capture/forms) lists each client's forms with a coverage matrix of sites × categories, so you can see which categories still have no form. Filter by client and site.
- **New form**: start a form for a site and category.
- **Auto-generate**: pick a site and category and ESGLite proposes the fields, choices and factor matches. You review them in the builder before saving.

**The form builder**
Open a form to edit it. Its tabs:
1. **Fields**: which fields show and in what order, with each field's label, help and default, and whether it's hidden, read-only or required.
2. **Choices**: the options of each dropdown, including options that depend on an earlier choice.
3. **Factor match**: rules that turn a contributor's choices into the factor name the row uses.
4. **Extra details**: extra fields shown under "More details".
5. **Calculation**: **None**, **Per method** or **Per unit**; for Scope 3 forms, the methods offered and the units each takes; allowed units or a fixed unit; the currency.
6. **Test**: enter sample values and see the tCO₂e with the real factor.

The preview beside the builder updates as you edit. Switch between **Contributor view** (exactly what a User sees) and **Reviewer view**. Choose **Save form** when you're done.

**Columns**
[Columns](/capture/columns) is the library of fields that forms can use, with each column's type and default options.

**What contributors see**
On the client's page under **Clients**, **Contributors see** is either **Total only** (Users see their fields and the total) or **Full calculation**.

**Changing a form**
Entries already saved don't change when a form changes.
