---
id: copy-client-setup
title: Copy setup from one client to another
roles: [Superadmin]
paths: [/clients]
keywords: [copy setup, copy setup here, copy client setup, copy forms, copy factors, copy from another client, reuse setup, same setup, setup file, download setup, json file, start from, factor years, goes to, same name form, another environment]
---
Copying gives a client the forms, units, factors, mappings and threshold another client already has. Only a Superadmin can do it.

**Where to start**
- New client: the **Start from** step of [Onboard client](/clients/new). The first source site fills the new client's main site, and the others become new sites.
- Existing client: open it in [Companies](/clients) and choose **Copy setup here**. This is off while the client is inactive.

**Copy onto an existing client**
1. Under **Source**, choose **An existing client** and pick it, or **A setup file** and add the .json file (up to 5 MB).
2. Under **What to copy**, tick **Data-entry forms**, **Units**, **Emission factors**, **Category mappings**, **Threshold**, **Products** and **Material factors (PCF)**. All but material factors start ticked.
3. For factors, check the **Factor years**. The newest and the current year start ticked; tick older years to copy them too.
4. Choose what happens **When a form with the same name is already here**: keep the existing form, or add the copy as "… (copy)".
5. Under **Sites**, the table previews each source site. In **Goes to**, choose a new site, **Skip this site** or one of this client's sites.
6. Choose **Copy setup**. It stays off until there's something to copy and the preview shows no errors.

**What's safe**
Nothing already on the client is changed. Items it already has stay as they are and show as "kept". People and entries are never copied, and neither are the brand theme or licensed material factors.

**Using a setup file**
**Download setup** on a client's page saves its setup as a .json file. Upload that file with **A setup file**, for example on another environment.

**Afterwards**
Use **Check sites**, **Check forms** and **Check factors**. Grid and fuel factors may differ by country.
