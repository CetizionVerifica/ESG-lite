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
