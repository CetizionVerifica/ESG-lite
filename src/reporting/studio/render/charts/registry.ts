/**
 * DS-1 §6 · chart kind → renderer. The RS kinds are registered here; the GHG
 * kinds (scope_split, category_bars, gas_split, site_bars, monthly_stack,
 * base_year_waterfall, intensity_line, treemap) come from charts/ghg (DS-8,
 * `GHG_CHARTS`). An unregistered kind
 * renders a muted "Chart not available" box with data-reason, never a crash.
 */
import { barChart, stackedBarChart } from "./bars";
import { GHG_CHARTS } from "./ghg";
import { donutChart, dotGridChart, shareBarChart } from "./donut";
import { lineChart, sparkline } from "./line";
import { materialityMatrix } from "./matrix";
import { sankeyChart } from "./sankey";
import type { ChartRenderer } from "./svg";
import { targetBarsChart } from "./targetBars";
import { waterfallChart } from "./waterfall";

const REGISTRY: Record<string, ChartRenderer> = {
  bar: barChart,
  stacked_bar: stackedBarChart,
  line: lineChart,
  donut: donutChart,
  share_bar: shareBarChart,
  waterfall: waterfallChart,
  sankey: sankeyChart,
  target_bars: targetBarsChart,
  dot_grid: dotGridChart,
  materiality_matrix: materialityMatrix,
  sparkline,
  // DS-8: the GHG kinds.
  ...GHG_CHARTS,
};

export const registerChart = (kind: string, fn: ChartRenderer): void => {
  REGISTRY[kind] = fn;
};
export const chartRenderer = (kind: string): ChartRenderer | null => REGISTRY[kind] ?? null;
export const registeredChartKinds = (): string[] => Object.keys(REGISTRY);
