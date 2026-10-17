# 04 · Decisions for Shyam

Each lane builds on the **default**. Changing one later is a KPI-0 follow-up plus the listed work. D1 and D2 are fixed by Shyam (2026-10-17); the rest are proposed defaults to accept or change.

| # | Question | Default (built) | If changed |
|---|---|---|---|
| D1 | Who enters KPIs? | **Fixed:** the same company users who enter emission data, with the same roles and site access. No new role and no separate login. Contributors enter, Managers review, Admins set up. | — |
| D2 | Who turns the feature on? | **Fixed:** the Superadmin, with one switch per client (`company.kpi_tracking_enabled`, default off), on the client's Overview tab next to Smart import. | — |
| D3 | What happens when the switch is turned off later? | KPI pages, nav, endpoints and exports disappear; the data is kept and comes back when switched on. | Delete on switch-off: a separate, confirmed Superadmin action with a typed-name modal. |
| D4 | Where are values entered? | Per KPI: `site` (energy, water, waste, safety) or `company` (revenue, headcount, board, pay). Company values are entered by Admins and Managers. | Everything per site: more entry work for HR data. |
| D5 | How often? | Each KPI has a default frequency (most annual; energy and water monthly when the client wants it). The year follows the company's CY/FY. | — |
| D6 | Which framework versions? | GRI Standards (2021 Universal + topic standards in force), BRSR (SEBI format incl. BRSR Core, 2023), ESRS (2023 delegated act set). The library is versioned, so the simplified ESRS (EFRAG, expected 2026) is added as a new version and a client switches when ready. | Seed the simplified ESRS first if it's adopted before KPI-2 lands. |
| D7 | Standards text in the app? | Codes, our own plain-language titles and help, and a link to the official text. No copied paragraphs. | A licence for full text (GRI permits some reuse with attribution; check before copying). |
| D8 | Can clients add their own KPIs? | Yes, Admins add company KPIs (any type, unit, frequency), optionally mapped to a disclosure. The AI can suggest the mapping (KPI-12). | Superadmin only. |
| D9 | Can auto KPIs be overridden? | No. An auto value is read-only and links to its source data. Fix the source (emission rows, production), and the KPI refreshes. | An override with a reason, shown as "adjusted" in exports. |
| D10 | Units? | Each KPI stores a canonical unit. Contributors may type any allowed unit (converted and shown). Exports use each framework's display unit (e.g. BRSR energy in GJ, ESRS in MWh). | — |
| D11 | Review? | KPI values always go Draft → Pending → Approved/Rejected, independent of the emissions `review_workflow_v2` switch. Managers approve; Admins can't (as for emissions). | Admin approval allowed: a role change in KPI-8. |
| D12 | Exports first? | XLSX for all three frameworks plus a PDF GRI content index (existing Playwright printer). BRSR XLSX follows SEBI's table layout for the indicators covered. | BRSR XBRL filing format: a later module. |
| D13 | Materiality? | Light: per ESRS topic (E1–E5, S1–S4, G1), material yes/no with a reason; it filters `if_material` datapoints. A full double-materiality assessment is out of scope. | A DMA module later (impact/financial scoring). |
| D14 | Which emission rows feed GHG KPIs? | Approved rows only, the same functions as the GHG report. The dashboard also shows "pending, not yet in KPIs". | Include pending: not recommended for reporting. |
| D15 | Evidence rules? | Evidence is required to submit a BRSR Core KPI value. Elsewhere it's optional, but missing evidence holds the value in review (`KPI_EVIDENCE` check). | Required everywhere: one company setting. |
| D16 | Due dates and reminders? | Values are due on `due_day` (default the 15th) after the period ends. Contributors get a reminder 5 days before and on the due day, through existing notifications. | Per-KPI due dates. |
