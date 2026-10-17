# KPI-2 · KPI library and framework catalogue (GRI, BRSR, ESRS)

> Module spec. Lane L1. Copy to `ESG-lite/src/kpi/library/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/library/CLAUDE.md`. PR titles `[KPI-2 k/m]` (1/3 tables + seeds, 2/3 API, 3/3 FE library admin).
> Depends on: KPI-0 · Owns: `kpi_definition`, `kpi_framework`, `kpi_disclosure`, `kpi_disclosure_map`, `migrate:kpi-library`, `data/kpi/*`, `src/kpi/library/*`, FE `kpi/library` · Touches: —

## Job to be done
One library defines each KPI once: its question, unit, aggregation and source. It maps each KPI to the disclosures of every supported framework version, so a client reports GRI, BRSR and ESRS from the same values. The Superadmin maintains it as frameworks change.

## Guidance (verify every code against the official source; record the URL and version on each row)
- **GRI:**
  - Universal Standards 2021 (GRI 2 general disclosures, e.g. 2-7 Employees, 2-25/2-26 remediation);
  - topic standards 302 Energy, 303 Water and effluents, 305 Emissions, 306 Waste (2020), 401, 403, 404, 405;
  - note GRI 101 Biodiversity 2024 (replaces 304 from 2026).
  - Source: globalreporting.org Standards download.
- **BRSR:**
  - SEBI's Business Responsibility and Sustainability Report format: Section A general, Section B management, Section C principle-wise Essential and Leadership indicators.
  - BRSR Core (the assured subset of key indicators across nine attributes, SEBI 2023).
  - Principle 6 (environment), Principle 3 (employee well-being and safety), Principle 5 (human rights and wages) carry most quantitative indicators.
  - Source: SEBI circulars on the BRSR format and BRSR Core.
- **ESRS:**
  - The 2023 delegated act set (ESRS 1, ESRS 2, E1–E5, S1–S4, G1).
  - Quantitative datapoints, e.g. E1-5 energy consumption and mix, E1-6 gross Scope 1/2/3, E3-4 water consumption, E5-5 resource outflows (waste), S1-6 employee characteristics, S1-9 diversity, S1-13 training, S1-14 health and safety, S1-16 remuneration.
  - Use EFRAG's IG3 datapoint list for codes.
  - The simplified ESRS (EFRAG, 2025–26) goes in as a new framework version when adopted (D6).
- **Text:** codes plus our own wording plus the source link (D7).

## Build
### Backend
1. **Tables** per 01-contracts §2 (library part), with `migrate:kpi-library` and entities `KpiDefinition`, `KpiFramework`, `KpiDisclosure`, `KpiDisclosureMap`.
   - Unique `(framework_id, code)`, `(code)` for library KPIs, `(company_id, code)` for custom ones.
2. **Seeds** in `data/kpi/` (versioned files: `frameworks.json`, `definitions.json`, `disclosures/<framework>-<version>.json`, `mappings.json`), loaded idempotently by `migrate:kpi-library-seed`. It adds missing rows, never overwrites a row a Superadmin edited (an `edited_at` flag), and never deletes.
   - v1 content is 01-contracts §7, extended to the quantitative disclosures of GRI 302/303/305/306/401/403/404/405, BRSR P3/P5/P6 Essential plus Core, and ESRS E1/E3/E5/S1 (about 60 KPIs, about 150 mappings).
   - Each mapping carries `fit`, `display_unit` and a `note` where definitions differ (e.g. BRSR energy in GJ; ESRS E1-5 in MWh).
3. **Library API** `/kpi/library/*` (Superadmin):
   - CRUD with validation (unit dimension vs canonical unit, formula codes exist, no cycles via KPI-6's parser when present, else stored and validated later);
   - `GET /kpi/catalogue` for clients (enabled framework versions only).
4. **Coverage helper:** per framework version, the count of disclosures mapped vs total, shown in the library UI.

### Frontend
1. `/setup/kpi-library` (Superadmin):
   - **KPIs tab:** a `DataTable` filtering by framework, topic and source, plus a KPI drawer (definition, mappings table, formula with a live check).
   - **Disclosures tab:** per framework version, grouped by section, with coverage ("E1 · 14 of 18 mapped") and unmapped disclosures highlighted.
2. A "Preview as client" link opens the setup wizard's KPI list in read-only mode.

## Tests
- **Seeds:** load twice with no changes; an edited row survives a re-seed.
- **Library API:** Superadmin only; tenant clients can't write.
- **Validation:** unit dimension, formula, duplicate codes.
- **Catalogue:** filtered to enabled versions.
- **Unit:** every seeded mapping points at an existing KPI and disclosure, and every disclosure has a source URL.
- **Playwright:** library list, a KPI drawer, editing a question.

## Out of scope
Client-specific KPIs (KPI-3). Values. XBRL taxonomies.

## Done when
The library holds GRI, BRSR (with Core flags) and ESRS 2023 for the v1 KPI set, each verified with a source link. The Superadmin can maintain it, and clients can read the catalogue for the versions they enable.
