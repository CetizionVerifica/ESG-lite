---
id: client-feature-switches
title: A client's page: feature switches, deactivate and delete
roles: [Superadmin]
paths: [/clients]
keywords: [feature switch, feature switches, turn on, switch on, switch off, enable a feature, client page, client settings, Smart import, KPI tracking, Design Studio, Insights, Help assistant, Attach files, Claude imports, Allow Claude imports, Contributors see, Total only, Full calculation, Default currency, ESG-Mitra, deactivate client, reactivate client, delete client, Danger zone, Edit details]
---
Open **Clients** › [Companies](/clients) and select a client. Its tabs are **Overview**, **Sites**, **People**, **Brand theme**, **Threshold**, **Mappings** and **Danger zone**. **Edit details** changes the company's details, including **ESG-Mitra access**.

**Switches on the Overview tab**
These apply to this client only and save at once. Only a Superadmin can change them, and every on/off switch starts off.
- **Data entry**: **Contributors see** is **Total only** (the default) or **Full calculation**. **Default currency** is for an amount spent when the row and its form name none.
- **Smart import**: Managers and Admins can drop any workbook on Bulk upload. Sheet headers and a few sample rows go through a hosted model.
- **KPI tracking**: the client's Admins choose frameworks and KPIs, and its Users enter values.
- **Design Studio**: Admins and Managers design reports from approved data. It works without KPI tracking, except for sustainability reports.
- **Insights**: one page for Managers and Admins. It works without KPI tracking, except for the ESG panels.
- **Help assistant**: shows "Ask ESGLite" to the client's people. Questions go to an outside AI service. One more switch appears below it once it's on; tell the client before turning it on:
  - **Attach files** ("Let people attach files"): what's in a file goes to that service.
- **Claude imports**: ESGLite staff connected to Claude can import this client's activity data. Rows wait for the site managers' approval.

Turning off KPI tracking, Design Studio or Insights asks you to confirm. Their values, designs or timeline events are kept and come back when it's on again.

**Deactivate or delete (Danger zone)**
- **Deactivate**: its people can't sign in or use ESGLite until you choose **Reactivate**. Nothing is deleted.
- **Delete client**: removes the client with its sites, its people's accounts, brand theme and category mappings. Only a client with no reporting history can be deleted; deactivate one that has data. You type its name to confirm, and this can't be undone.
