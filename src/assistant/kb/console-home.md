---
id: console-home
title: The Console: client health and setup gaps
roles: [Superadmin]
paths: [/console]
keywords: [console, superadmin home, home page, client health, setup gaps, setup completeness, setup percentage, setup bar, stuck in setup, clients table, recent activity, entries this month, this month, no column config, no threshold set, no logo on dark, theme fails contrast]
---
[Console](/console) is the Superadmin's home page. It shows client health, setup gaps and recent uploads across every client. **Onboard client** starts a new client.

**Totals**
- **Clients (active)**, with the total number of clients.
- **Sites**.
- **Users**, not counting Superadmins.
- **Emission factors**: site factors, plus global spend factors when there are any.
- **Entries this month**, with how many are pending review.

**Clients table**
The columns are **Client**, **Sites**, **Users**, **Setup**, **This month** and **Theme**. Select a row to open the client. The least complete clients come first, and inactive ones go to the bottom.

**Setup** is the share of these checks that pass. Hover over the bar to see what's missing.
1. Sites exist
2. Each site has categories
3. Each site × category has a column config
4. Factors exist for last year
5. Units exist
6. Threshold set
7. Brand theme set: a saved theme with both logos, and colours that pass contrast

A check that couldn't run is left out of the percentage, and the page says so.

**Setup gaps**
This list shows what's missing for active clients, least complete first. Each line links to the page that fixes it. It shows 8 lines, then "and N more in the clients table". When nothing is missing it says "Every active client is fully set up."

Where each gap is fixed:
- "no sites yet" or "no categories enabled": [Sites](/setup/sites)
- "no column config": [Data-entry forms](/capture/forms)
- "no emission factors" or "latest factors are for" an older year: [Emission factors](/factors)
- "no threshold set": [Thresholds](/factors/thresholds)
- "no units set up": [Units](/setup/reference?tab=units)
- "no brand theme set", "no logo", "no logo on dark" or "theme fails contrast": the client's brand theme

**Recent activity**
This lists bulk uploads, factor uploads and newly onboarded clients.
