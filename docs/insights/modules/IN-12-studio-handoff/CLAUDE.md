# IN-12 · Report studio hand-off ("Add to report")

> **Module spec**, its own lane (ESG-lite_FE#234 G4). Copy to `ESG-lite_FE/src/features/insights/handoff/CLAUDE.md` when the FE work starts.
> **PR titles:** `[IN-12 k/m]`, three PRs in this order:
> 1. BE: studio sources for the Insights stories (contracts first, DS-0 follow-up), renderer fields, `RENDER_HASH` bump;
> 2. FE: renderer mirror sync, then "Add to report" on the Insights charts and the editor's insert-on-open;
> 3. BE + FE: stripes as a report cover graphic.
>
> **Depends on:** Design Studio (ESG-lite #178 / ESG-lite_FE #228, merged), IN-2…IN-8, IN-11 · **Owns:** `src/studio/sources/insights/*` (new), FE `src/features/insights/handoff/*` (new)
> **Touches:** `src/studio/contracts/{sources,enums}.ts`, `src/reporting/studio/render/charts/*` (read fields only, mirrored), FE `src/features/studio/editor/*` (insert on open)
> **Decision:** I16 in `docs/insights/04-decisions.md`, updated 22 Oct 2026: build it, in this module.

## Job to be done
A Manager or Admin who sees a story on the Insights page can put that chart into a report they are designing, with the same figures, in two clicks: "Add to report", pick the design. The chart stays bound to data (it refreshes with the report), and nothing lands on a page until the person confirms it in the editor.

## What the studio can show today (checked 22 Oct 2026 on `production`)
The studio already has every chart kind the stories need: `waterfall`, `sankey`, `materiality_matrix`, `target_bars`, `stacked_bar`, `monthly_stack`, `base_year_waterfall`, `intensity_line` (`src/studio/contracts/enums.ts`). Chart elements bind to `ghg` or `kpi` sources (`src/studio/contracts/sources.ts`), resolved by `src/studio/sources/` (`resolveBinding`). What the sources return is the limit:

| Insights story | Insights figures | Studio today | Gap |
|---|---|---|---|
| Stripes / monthly emissions | monthly approved **net**, yearly batches left out (`derive/stripes.ts`) | `ghg total` by `month`: **gross** scope 1–3, yearly batches in their reporting month (`sources/ghg/rows.ts` `monthlyByScope`) | net and the yearly-batch rule |
| Bridge ("What moved") | LMDI drivers (`derive/lmdi.ts`) | `base_year_waterfall`: scope deltas only (`render/charts/ghg/trend.ts` `bridgeSteps`) | driver steps |
| Data flow (Sankey) | disclosure flow links | renderer reads `value.links`; no source returns them | whole source |
| Materiality × performance | `{label, x, y}` points | renderer reads `value.points`; `/studio/materiality` has another shape and isn't wired to resolve | source + mapping |
| Target wall | KPI and SBTi targets, expected tick | `resolveKpi` returns `target:{baseline_value, target_value, …}`, the renderer reads `target.{baseline, value, year}`; KPI targets only | mapping + SBTi |
| Pathway | SBTi pathway line, gap band | no pathway series in any source | whole source |
| Sites (IN-11) | net by site | `ghg total` by `site`: gross | net |
| Intensity | combined intensity | `intensity_line` | none |

So an "Add to report" today would put a chart on the page whose numbers differ from the Insights panel it came from. That breaks the Insights rule "every number comes from an /insights endpoint, the same functions Overview uses" and the studio rule "numbers only from `src/studio/sources/`". This module closes the gaps first.

## Build

### 1. Backend: studio sources for the stories (PR 1)
Contracts first (`src/studio/contracts/`, DS-0 follow-up):
- A new binding source `insights` with `panel` ∈ `stripes | bridge | flow | materiality | target_wall | pathway | site_compare`, plus the Insights query fields a binding can carry: `years` (absolute, the doc's year type), `sites`, `compare`. The binding never carries `yearType`: the doc's `meta.yearType` is used, and the FE refuses a hand-off from an FY query into a CY design (and the other way round).
- `ResolvedBinding` gains the optional fields the renderer already reads: `links` (sankey), `points` (materiality), `target {baseline, value, year}` (target bars; also used for SBTi), and series ids for the bridge steps.

Sources (`src/studio/sources/insights/*.ts`): each reads the **same** Insights functions its panel uses (`src/insights/panels/*` builders and `derive/*`), read-only, with the doc's company and sites. No figure is computed in the studio.
- `stripes`: the `/insights/stripes` series (net, yearly batches out).
- `bridge`: the LMDI steps from `derive/lmdi.ts` as waterfall steps (start, drivers, end); `waterfall` draws them, `base_year_waterfall` is unchanged.
- `flow`: the disclosure flow links.
- `materiality`: the matrix points.
- `target_wall`: one bar per target with `target {baseline, value, year}`; SBTi and KPI targets as the panel shows them.
- `pathway`: actual, pathway and gap series for `stacked_bar` + line.
- `site_compare`: net by site.
`chartKindValidity` (`render/charts/ghg/kinds.ts`) learns which kinds each `insights` panel feeds. Any renderer change bumps `RENDER_HASH`; the FE mirror is synced with `npm run sync:studio-render` in PR 2.

Access: the source runs only when Insights is on for the doc's company (`insights_enabled`); otherwise the element resolves `unavailable: { reason: "IN_OFF" }` (shown as "Insights is off for this client"), never an error. KPI-backed panels (`target_wall` with KPI targets, `materiality`, `flow`) follow `kpi_off` the same way.

### 2. Frontend: "Add to report" (PR 2)
- `src/features/insights/handoff/AddToReport.tsx`: a `Menu` in each story `ChartFrame`'s `actions` (Pathway, Bridge, DisclosureFlow, MaterialityMatrix, TargetWall, SiteCompare). Shown only when `designStudioOn(user)` and the role is Manager or Admin; for KPI panels also `kindEnabled("sustainability")`.
- The menu lists the company's designs for the same year and year type (`GET /studio/docs?year=`), newest first, plus "New design…" (opens the studio's new-design flow with the year preset). Finals are left out.
- Picking one opens `/studio/:id?insert=<payload>` where the payload is the element the hand-off builds (`elementForFigure`-style chart element with the `insights` binding, the panel's title as the chart title, the Insights sites and compare). The editor reads `insert`, shows "Add {title} from Insights?" with **Add** and **Cancel**, and on Add calls `EditorApi.insertElement` (placement as the Data panel does) and clears the param. Nothing is written until Add; there is no server-side insert, so an open editor tab never gets a 409 from the hand-off.
- Copy: menu item "Add to report"; empty list "No {year} designs yet. Start one."; refused year type "This design is for {CY 2025}; the chart is FY 2025-26."

### 3. Stripes as a cover graphic (PR 3)
A `chart` element of a new kind `stripes` (contracts first, renderer + mirror) bound to `insights.stripes`, offered on the Stripes band's menu and in the studio's cover layouts. Same figures as the band; colour from the heat ramp tokens.

## Tests
- **API (BE):** for each `insights` panel, `/studio/resolve` returns the same figures as the matching `/insights/*` endpoint for the same company, year, sites and compare (CY and FY, all sites and one); tenant isolation (company 2 doc can't bind company 1 sites), role (Users never), Insights off → `IN_OFF` unavailable, KPI off → `kpi_off`. `ci/golden` and the studio golden docs are unchanged.
- **Unit (BE):** `chartKindValidity` for the new bindings; contracts snapshot refreshed.
- **FE unit:** the hand-off payload (binding, title, sites, compare); year-type refusal.
- **Playwright:** from Insights, Add to report → pick a design → the editor asks → Add → the chart is on the page with the panel's figures; Cancel adds nothing; the menu is absent when Design Studio is off or for a User.

## Out of scope
- Live sync between the Insights page and a report (the report re-resolves on open and before a final, as every bound chart does).
- Present-mode slides as report pages.
- Editing a story's settings inside the studio beyond the chart's existing options.

## Done when
Every Insights story chart can be added to a design in two clicks and a confirm, the chart in the design shows the same numbers as the Insights panel it came from, and nothing is written without the person's Add.
