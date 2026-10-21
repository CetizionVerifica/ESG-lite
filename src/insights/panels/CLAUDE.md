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

## IN-2 as built (backend)
- **Routes** (`panels/in2.ts`, one `router.use` line `// IN-2`): `GET /insights/esg-ring` (KPI panel), `/decoupling?years=` (2–10, default 5), `/target-wall`. Build functions exported for IN-3: `buildEsgRing`, `buildDecoupling`, `buildTargetWall` (call through `panelResponse`).
- **`derive/index.ts`** appended: `indexSeries`, `combinedOutputIndex(perSite, weights, baseIdx)` (I7: each site indexed in its own unit, weighted by base-year emissions, weights renormalised over sites with a value that year), `lastValue`, `towardsTarget(baseline, target, now)` (0 → 100 whichever way is good), `wallOrder`.
- **`sources/kpiAuto.ts`** (new): `autoFilledByTopic(scope)` = selected active auto KPIs with an approved value of the year on the scope's sites (or company level), via `figureDefs` + `loadValues` (counts only).
- **ESG ring:** pillars/topics/counts are `/kpi/esg`'s; `coverage_pct` = approved ÷ (approved + pending + missing) × 100 **unrounded** (rounds to `/kpi/esg`'s); a pillar or topic with nothing counted is **0** (the contract type is `number`); `pct` the same over all pillars; `auto_share` in percent. `setup_incomplete` before KPI setup, `kpi_off` while off. Links `pillar:<p>`, `topic:<t>`, `centre`.
- **Decoupling:** base year = SBTi base year when inside the window and it has both, else the first year with both. `combined_output` = units differ **or** a site in scope has no base-year production (I7 note). Output `raw` = Σ production only with one unit, else nulls; output unit = that unit or "index". Emissions = Overview net (`netByYear`, null when no approved row); intensity = the summary's combined intensity per year, unit `tCO2e/<unit>` or "tCO2e per unit of output". `headline` = last non-null index − 100 (0 if none). `no_data` when < 2 years with both.
- **Target wall:** `sbti:near` (baseline = Targets' `targetBoundaryBase`, target = table1's target-year figure, latest = last table3 year after the base with data — note the Targets page reads calendar years by date, so an FY batch dated 31 Mar counts in that calendar year) and `sbti:long` (net zero 90 % by 2050 from `computeLongTermChart`); status by the I6 **target** rule (`targetStatus` on normalised progress vs the straight line at today), not the +5 % pathway rule the hero uses. KPI items `kpi:<target id>` from `kpiTargetStatuses` (name "KPI · Site" for site targets, `direction_good` up for increase else down, link `/kpi/targets?kpi=<id>`). `?pillar=` filters items. Links keyed by item id.
- **Tests:** `ci/api/tests/in-2-story.test.cjs` (envelope, kpi_off / setup_incomplete, ring = `/kpi/esg` + auto_share by hand + site filter, decoupling no_data and a two-year case by hand, wall empty / SBTi only / KPI up and down targets / sort / pillar filter, roles, site scope, tenant, switch-off), `ci/unit/in-2-derive.test.cjs`; golden suite `story` runs (`ci/golden/in/story/fixture.json`: decoupling all sites / Manager's sites / 3-year fallback base / no_data, wall SBTi items with expected and status from the I6 line at today, ESG ring on company 901 with KPI on for the case only, plus ring-vs-`/kpi/esg` parity per topic); `ci/fixtures/in-company/cleanup-in2.sql` removes the ring case's KPI rows (companies 901/902).
