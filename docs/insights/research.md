# Research: combining the emissions and KPI dashboards

Background for every lane; read once. Live mockups of all eight concepts (ECharts, example data): https://claude.ai/artifact/ErBXCeyw35VBWqj28Ho68h

## 1. What exists today (production, 2026-10-19)

| Page | Route | Shows | Feeds from |
|---|---|---|---|
| Overview | `/overview` | Net and gross tCO₂e, intensity, scope bar, monthly trend, by site, by category, attention list, submission status | `GET /manager/overview`, `/manager/submission-status`, `/user/emission-intensity/*` |
| Targets (SBTi) | `/targets` | Base year, pathway bars + actual line, on/off track, SBTi rules check | `POST /user/targets/tables`, `/user/targets/long-term-chart` |
| KPI dashboard | `/kpi/dashboard` | Framework coverage rings, KPI cards (sparkline, target bar), gaps with Remind | `GET /kpi/dashboard` |
| ESG dashboard | `/kpi/esg` | E/S/G pillar cards, topic coverage, headline trends, sites × pillars heat, movers | `GET /kpi/esg` |

**The bridge already exists in data.** KPI-5 auto adapters (`src/kpi/auto/`: `ghg.ts`, `energy.ts`, `production.ts`, `waste.ts`) write approved emission and production figures into KPI values (`ghg_scope1`, `ghg_scope2_location|market`, `ghg_scope3_total`, `ghg_scope3_category_n`, `energy_*`, `production_output`, `waste_total`). Formulas (`src/kpi/formulas`) derive intensities, e.g. `(GHG_SCOPE1 + GHG_SCOPE2_LB) / REVENUE`. `KpiDisclosureMap` maps each KPI to GRI, BRSR and ESRS disclosures with a `fit`. So one approved electricity bill already feeds Scope 2, energy KPIs and several disclosures. Nothing on screen shows this.

**Charts:** ECharts 6 via `echarts-for-react` (full build, so sunburst, sankey, heatmap, `universalTransition` are available), wrapped by `src/ui/ChartFrame.tsx` (table view, PNG export, states) and themed by `theme/chartTheme.ts` (IBM Plex Sans / Mono, `--t-series-*`, scope colours, `pillars`). Tokens: `--t-pillar-e/s/g`, `--t-heat-1…5`, `--t-s1/2/3`.

## 2. Findings

1. **Design each view around a decision.** Good ESG dashboards answer "what changed?" and "what needs attention?", and tie each metric to its owner, period, evidence and next action, with drill-down to records. ([Jodoo](https://www.jodoo.com/ai/use-cases/esg-dashboard))
2. **Audit readiness over decoration.** CSRD/GRI/SASB dashboards are judged on traceability and comparability. ([FanRuan](https://intl.fanruan.com/en/blog/esg-sustainability-reporting-dashboard)) ESGLite's auto snapshot and disclosure map make this visible — a differentiator.
3. **Carbon platforms lead with reduction vs pathway.** Persefoni's dashboard builder offers tables, bars, pies, areas and tree maps; Watershed emphasises reduction planning; Sweep emphasises collaboration. None of the material found shows a Sankey from data to disclosure or a live materiality-performance matrix. ([Persefoni](https://www.persefoni.com/blog/enhanced-dashboards), [Nectar comparison](https://nectarclimate.com/compare/watershed-vs-persefoni-vs-sweep))
4. **Double materiality is usually a static picture.** Tools generate the matrix from an assessment; linking topics to live KPI performance is rare and requested in BI tools. ([Datylon](https://www.datylon.com/blog/double-materiality-part-one))
5. **Basics:** distinct fixed scope colours, annotations for jumps, donut/segmented bars for composition, intensity per unit for fair comparison. ([Quadratic](https://www.quadratichq.com/use-cases/co2-emission-reporting-data-visualization-for-non-experts), [Harvard](https://sustainable.harvard.edu/wp-content/uploads/2023/05/Building-Flexible-Sustainability-Dashboards.pdf), [Datylon CSRD](https://www.datylon.com/blog/csrd-reporting-visualization))

Gap: no public source showed SBTi trajectory charts or bridge charts in vendor products in detail; concepts C and D are our design.

## 3. The eight concepts

| | Concept | Combines | Effort | Module |
|---|---|---|---|---|
| A | ESG sunburst: pillar → topic, filled by coverage, "from your data" share | KPI coverage × auto adapters | S | IN-2 |
| B | Decoupling: output, emissions, intensity indexed to base | production × emissions × intensity | S | IN-2 |
| C | Pathway with levers: scope bars, pathway, renewable share | SBTi × emissions × energy | S–M | IN-4 |
| D | Emissions bridge: LMDI drivers | production × emissions × energy mix | M | IN-5 |
| E | Data-to-disclosure Sankey | emissions × KPI library × frameworks | M | IN-6 |
| F | Materiality × performance | materiality × targets × emissions share | M | IN-7 |
| G | Completeness calendar: sites × months | submissions × KPI gaps | S | IN-4 |
| H | Target wall: bullet bars, worst first | SBTi × KPI targets | S | IN-2 |
| — | Emission stripes | Overview monthly series | S | IN-8 |

## 4. LMDI in one paragraph (for IN-5)

For an aggregate E = Σᵢ Q · Iᵢ (Q activity, Iᵢ intensity of component i), the additive LMDI effect of factor x between years 0 and T is Σᵢ L(Eᵢᵀ, Eᵢ⁰) · ln(xᵢᵀ / xᵢ⁰), where L(a, b) = (a − b) / (ln a − ln b) and L(a, a) = a. The effects sum exactly to Eᵀ − E⁰. Scope 2 uses three factors: Q × (kWh / Q) × (tCO₂e / kWh). Zero values use the standard small-value substitution (1e-9) and are flagged in `notes`.
