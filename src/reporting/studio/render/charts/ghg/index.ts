/**
 * DS-8 · the GHG chart kinds, registered in charts/registry.ts (01-contracts §1
 * ChartKind). Each is static SVG in the theme's scope and series colours.
 */
import type { ChartRenderer } from "../svg";
import { gasSplitChart, monthlyStackChart } from "./columns";
import type { GhgChartKind } from "./kinds";
import { categoryBarsChart, siteBarsChart } from "./rankedBars";
import { scopeSplitChart } from "./scopeSplit";
import { treemapChart } from "./treemap";
import { baseYearWaterfallChart, intensityLineChart } from "./trend";

export const GHG_CHARTS: Record<GhgChartKind, ChartRenderer> = {
  scope_split: scopeSplitChart,
  category_bars: categoryBarsChart,
  gas_split: gasSplitChart,
  site_bars: siteBarsChart,
  monthly_stack: monthlyStackChart,
  base_year_waterfall: baseYearWaterfallChart,
  intensity_line: intensityLineChart,
  treemap: treemapChart,
};

export * from "./kinds";
export { squarify } from "./treemap";
export { SCOPE2_BASIS_NOTE } from "./scopeSplit";
export { GAS_UNIT_NOTE } from "./columns";
