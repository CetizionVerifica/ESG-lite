# IN-2 · Story panels A, B, H: ESG ring, decoupling, target wall

> **Module spec**, lane L1. Copy to `ESG-lite/src/insights/panels/CLAUDE.md`.
> **PR titles:** `[IN-2 k/m]`, four PRs:
> 1. BE `derive/index.ts` + `/insights/esg-ring` + `/insights/target-wall`;
> 2. BE `/insights/decoupling`;
> 3. FE `EsgRing`, `TargetWall`;
> 4. FE `Decoupling` (with event marks once IN-4 exists; until then none).
>
> **Depends on:** IN-1 · **Owns:** `derive/index.ts`, `panels/{esgRing,decoupling,targetWall}.ts`, FE `panels/{EsgRing,Decoupling,TargetWall}.tsx` + `logic.ts`
> **Touches:** —

## Job to be done
The three visuals that tell most of the story with data the client already has: how complete is our ESG programme (A), are we growing without carbon (B), and which targets are slipping (H).

## Build
### Backend
1. **`derive/index.ts`** (pure, unit-tested): `indexSeries(values, baseIdx)`, `combinedOutputIndex(perSite, baseWeights)` (I7), `expectedProgress(baseline, target, today)`, `targetStatus(progress, expected)` (I6), `share(part, total)`, `changePct(a, b)`.
2. **`/insights/esg-ring`** → `EsgRing`: from `sources/kpi.esg(scope)` pillars and topics; `auto_share` = KPIs in the topic with `source = 'auto'` and an approved value ÷ topic KPIs. `kpi_off` when KPI tracking off; `setup_incomplete` before KPI setup.
3. **`/insights/decoupling`** → `Decoupling`: `years` = last N (default 5) up to the period year; base year per I7; `raw` output from `sources/production`, emissions from `sources/emissions` (net, approved), intensity = the Overview intensity per year (not FE division). `decoupled` = output index > 100 and emissions index < 100 at the last year. `no_data` with reason when fewer than 2 years have both.
4. **`/insights/target-wall`** → `TargetWall`: SBTi item(s) from `sources/targets.sbtiStatus` (near-term; long-term if set) plus KPI targets from `kpiTargets` (KPI on only). Progress normalised so 100 = target reached regardless of direction. Sort per contract.

### Frontend (`05-ux` §4 A, B, H)
1. **EsgRing:** ECharts `sunburst`, `nodeClick: 'rootToNode'`, centre text graphic, pillar → page `pillar` filter via `useInsightsQuery`. Topic opacity from coverage, a small database glyph label for `auto_share > 0`. Table view rows per topic.
2. **Decoupling:** three line series, `endLabel` with formatted change, base-year marker; event marks from `/insights/events` when present. Rule sentence slot above (filled by IN-3; empty until then).
3. **TargetWall:** horizontal bullet bars (background bar + progress bar + expected tick scatter), pillar letter in labels, status word in tooltip, row click per `05-ux`.

## Golden cases (`ci/golden/in/story/`)
- index series and combined output index (two sites, different units) by hand;
- decoupled true/false edges;
- SBTi item and a KPI "up is good" target and a "down is good" target normalised;
- ring coverage equals `/kpi/esg` per topic; `auto_share` for a topic with 2 auto of 4.

## Tests
- **API:** roles, scope, switch-off, `kpi_off` for ring, `no_data` for decoupling with one year, wall without KPI shows SBTi only.
- **Unit:** every `derive/index.ts` function incl. zero, null and negative.
- **Playwright:** ring click filters page and back; wall row opens targets; decoupling table view; 390 px.

## Done when
All three panels render from the API in every state, match the goldens, and the ring filter drives the page.
