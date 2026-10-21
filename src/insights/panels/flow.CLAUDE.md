# IN-6 · Data-to-disclosure flow (E): Sankey

> **Module spec**, lane L3. Copy to `ESG-lite/src/insights/panels/flow.CLAUDE.md`.
> **PR titles:** `[IN-6 k/m]`, two PRs: 1. BE `/insights/flow`; 2. FE `DisclosureFlow`.
>
> **Depends on:** IN-1 · **Owns:** `panels/flow.ts`, FE `panels/DisclosureFlow.tsx`
> **Touches:** reads `kpi/auto/adapters.ts`, `entities/KpiDisclosureMap.ts`, `KpiDisclosure.ts`, `KpiFramework.ts` (no edits)

## Job to be done
Show that one approved entry feeds many framework disclosures — ESGLite's strongest story — and let people click through to the rows and the report lines.

## Build
### Backend
1. **`/insights/flow`** → `Flow` (I9):
   - column 0 sites (in scope), column 1 Scope 1/2/3 with tCO₂e links from `sources/emissions.bySite × byScope`;
   - column 2 GHG KPIs the company selected whose `auto_source` is a GHG key (`ghg_scope1`, `ghg_scope2_*`, `ghg_scope3_*`), with scope → KPI links in tCO₂e (the KPI's approved value; Scope 2 location vs market: use the one the company reports, I9 note);
   - column 3 disclosures from `KpiDisclosureMap` for enabled frameworks; KPI → disclosure links `measure: 'count'`, value 1, carrying `fit`;
   - plus energy and intensity KPIs fed by auto/formula sources as column-2 nodes with count links only (no tonnes);
   - KPI off: columns 0 → 1 → top 6 categories (tCO₂e), no column 3.
   - Node ids stable: `site:<id>`, `scope:<n>`, `kpi:<code>`, `disc:<framework>:<code>`; `links` envelope maps node ids to drill-down routes.

### Frontend (`05-ux` §4 E)
1. ECharts `sankey`, `emphasis.focus: 'adjacency'`, gradient tCO₂e links, muted count links with line style by fit, legend explaining both. Labels plain names; disclosure codes in tooltip via framework badge text.
2. Click node/link → drill-down per `links`.
3. 390 px: table view default (source, target, value, measure) with "Show diagram".

## Golden cases (`ci/golden/in/flow/`)
- tonnes conserved between columns 0→1 and 1→2 for GHG KPIs (within rounding);
- disclosure counts equal mapped rows for enabled frameworks;
- KPI off variant.

## Tests
- **API:** roles, scope, switch-off, frameworks filtered to enabled ones, tenant isolation of KPI selection.
- **Playwright:** hover focus, click a disclosure opens `/kpi/reports/:framework`.

## Done when
The flow shows conserved tonnes on the left, correct disclosure counts on the right, and every node opens its source.

## IN-6 as built (backend)
- **`GET /insights/flow`** (`panels/flow.ts`, `buildFlow`, through `panelRoute`; one `router.use` line `// IN-6`). Not a KPI panel: it answers with or without KPI tracking.
  - KPI on and set up: column 0 sites → 1 Scope 1/2/3 (tCO₂e) → 2 KPIs → 3 disclosures (count).
  - KPI off, or KPI setup not finished: 0 → 1 → the top 6 categories of Overview's `by_category` (tCO₂e), no column 3.
  - `no_data` (with a reason) when the sites have no approved Scope 1/2/3 tonnes in the period.
- **`sources/flow.ts`** (added): `scopesBySite` = `computeManagerOverview` kpis for each site alone (Overview's `by_site` has no scope split, so one overview per site — cached with the panel); `flowKpis` = selected active KPIs: `auto` with `ghg_scope1` / `ghg_scope2_location` / `ghg_scope3_total` take tonnes from that scope (Scope 3 category KPIs only when no Scope 3 total KPI is selected, so tonnes aren't counted twice), plus count-only nodes for the other `auto` / `formula` KPIs of the climate and energy topics (energy, renewable share, intensity, market-based Scope 2); the figure is `values/yearly.ts` `figureOf` over approved values of the year (company KPI year type), as `/kpi/esg`; a company-level GHG KPI while only some of the company's sites are read has no comparable figure (null: node kept, no tonnes). `flowMappings` = `kpi_disclosure_map` rows of the company's enabled framework versions (`company_framework`) for those KPIs, ordered GRI, BRSR, ESRS, then sort key.
- **`derive/flow.ts`** (added, pure): `flowGraph(input)` builds nodes and links — tonnes links only > 0; a KPI node appears when it has tonnes or a mapping; one count link (value 1) per mapping row with its `fit`; a disclosure node once however many KPIs feed it; `flowTotal` for conservation checks.
- **Node ids:** `site:<id>`, `scope:<n>`, `kpi:<code>`, `disc:<framework>:<code>`, `cat:<category_id>`. Disclosure label = the disclosure title (codes are in the id for the tooltip). `links`: site → `/data/emissions?siteIds=&period=`, scope → `/overview?period=`, category → `/data/emissions?categoryIds=&period=`, KPI → `/kpi/esg?year=&kpi=`, disclosure → `/kpi/reports/<framework>?year=#<code>`.
- **IN-0 follow-up:** `Flow.nodes[].kind` gains `"category"` (the KPI-off column 2) in `contracts/panels.ts` and `01-contracts.md`. The FE mirror needs the same.
- **Tests:** `ci/api/tests/in-6-flow.test.cjs` (KPI off parity with `/manager/overview` per site and `by_category`, conservation; KPI on tonnes = approved KPI figures, pending values left out, count links = enabled frameworks' mapping rows (8 by hand), ESRS left out when not enabled, company 2's selection and values isolated, site scope, Superadmin, no_data, roles, switch-off); `ci/unit/in-6-flow.test.cjs`; golden `flow` (`ci/golden/in/flow/fixture.json`, KPI off and on for company 901, conservation 0→1 and 1→2; KPI rows set up in the group and removed by `ci/fixtures/in-company/cleanup-in6.sql`, KPI switch restored).
