# 04 · Decisions for Shyam

**Accepted 2026-10-15: Shyam chose the default for every decision (D1–D13).** Changing one later costs what the "If changed" column says.

| # | Question | Default (built) | If changed |
|---|---|---|---|
| D1 | How do existing categories get their GHG number (1–15)? | S3-1 proposes a number from the name (the map in `src/utils/defaultExtraFields.ts:130-146` plus fuzzy match). A Superadmin confirms per company on the Boundary page. Unconfirmed categories show "Unmapped" in reports. | Auto-apply without confirmation: one-line change in S3-1. |
| D2 | Data quality scale | 1–3 per indicator, the same as PCF DQR, five indicators (technology, geography, time, completeness, reliability). | 1–5 pedigree matrix: contract change plus S3-3 and S3-13 rework (M). |
| D3 | Spend-based (EEIO) factor source | USEEIO v2 (US EPA, public domain) per USD, with a deflator. Clients can upload their own spend factors (for example DEFRA spend or EXIOBASE) as `eeio_spend` factors. | EXIOBASE as the built-in source needs a licence check. |
| D4 | Consolidation approach | Operational control for every client (today's report text), editable per company by Superadmin or Admin. | None; it's a setting. |
| D5 | Reporting unit precision | Keep `total_emission` at 2-dp tCO₂e (golden unchanged) and add `total_kgco2e` (4 dp). Reports sum kg and then round. | Switching reports to sum kg changes some totals by up to 0.01 t per row: list them in the S3-13 PR. |
| D6 | WTT inside freight factors (Cat 4/9) vs the FERA twin (Cat 3) | S3-7 flags it (`WTT_ALREADY_IN_FACTOR`) and moves nothing. New freight factors are uploaded as two types (life_cycle without WTT, plus a wtt factor) so WTT lands in Cat 3. Old rows are left as they are. | Recalculate old rows: Shyam said "Leave as is" for old kg-to-ton totals (2026-10-14); same default here. |
| D7 | GWP set | AR6 for new factors. The Cat 11 refrigerant factors are re-seeded at AR6 (R134a 1530, R410A 2256) as new 2026 factor rows; old rows keep AR4 and say so. | AR5 everywhere: re-seed values. |
| D8 | Supplier entity | New company-scoped `supplier` table. PCF supplier requests link to it by name and email, and C06 accept writes a `supplier_factor` too. | Reuse supplier_request rows only: no supplier list page, weaker Cat 1 reporting. |
| D9 | Review workflow v2 (Draft, checks, month lock) | Behind `company.review_workflow_v2`, default off. Shyam turns it on per client. | Default on for all: change the default and announce it to contributors. |
| D10 | Cats 13, 14 and 15 for current clients | Built as a simple average-data and equity entry. Each client's status defaults to `not_relevant`, with the reason "No leased-out assets, franchises or investments" to confirm. | Skip S3-11 entirely: lanes drop to 5. |
| D11 | Month lock scope | Per site and month. A company-wide lock is a shortcut that locks every site. | Company-only lock: simpler, less flexible. |
| D12 | Who may confirm exclusions and the boundary | Admin and Superadmin. Managers see them read-only. | Managers too: a role change in S3-1. |
| D13 | Partner-reported Scope 1+2 (Cat 8 lessor, 13, 14, 15) | Entered as an activity figure with an identity factor (kgCO₂e), calculated by the engine like any row and marked primary data. | Treat it as a client-sent total and refuse it: those categories fall back to average-data only. |
