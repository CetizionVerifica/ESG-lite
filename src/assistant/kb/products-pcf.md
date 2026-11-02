---
id: products-pcf
title: Products (PCF): product carbon footprints
roles: [Manager, Superadmin]
paths: [/products, /setup/products]
keywords: [product footprint, product carbon footprint, pcf, carbon footprint, new footprint, start a footprint, product, products, add product, add a product, declared unit, mass per declared unit, bom, import bom, bill of materials, cradle to gate, submit for review, approve footprint, publish footprint, new version, out of date, export declaration, pact, epd, supplier request, supplier requests, ask supplier, supplier footprint, supplier figure]
---
A product carbon footprint (PCF) is the kgCO₂e of one declared unit of a product, from raw materials to your factory gate (cradle to gate). Cradle to grave isn't available yet.

Managers build footprints for their own sites in [Products (PCF)](/products). Superadmins set up products in **Setup** › [Products](/setup/products) and have no footprint screens. Admins and Users can't open either page.

**Set up a product (Superadmin)**
1. Choose **Add product** and enter the **Product name**, **Site** and **Default unit**.
2. Under **Product footprint**, set the **Declared unit** and **Mass per declared unit**. Footprints need them to calculate.

Managers see "Ask your admin to add products", but only a Superadmin can add one.

**Build a footprint (Manager)**
1. Choose **New footprint**, or **Start** on a product's row.
2. Choose the **Producing site**, **Product** and **Reference period**, then **Start footprint**.
3. Work through the steps from **Scope** to **Review**. It saves as you go. **Import BOM** on **Materials (A1)** reads xlsx, csv or pdf.
4. On **Review**, choose **Calculate**, then **Submit for review**.

Plant energy needs the site's approved data for that period, including this product's production.

**What happens next**
- Someone who didn't create or calculate it chooses **Approve** or **Send back**, so the site needs a second Manager. Nobody is alerted, so tell them.
- Once approved, choose **Publish**.
- **Export declaration** gives a PDF, PACT JSON or CSV. Before approval, the PDF and CSV carry a DRAFT mark and PACT JSON isn't available.
- Only a draft can be edited. Otherwise use **New version**, which also fixes **Out of date** (approved data changed since calculating).

**Supplier requests**
1. Choose **Supplier requests**, then **Ask supplier**.
2. Choose the **Footprint**, enter the **Material** and **Supplier email**, then **Send**. If email sending is off, the page says so: copy the link from the request, which shows once.
3. The supplier needs no account. They upload a file or type the value.
4. At **Received**, open it and choose **Accept figure** or **Reject**. The supplier isn't told about a rejection. To ask again, use **Ask supplier**: a rejected request can't be re-sent.
