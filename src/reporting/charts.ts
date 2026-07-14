// Server-side ECharts option builder. Returns plain, JSON-serializable option
// objects (no functions) so they can be embedded in the page and rendered by
// echarts in the browser. Chart styling is driven by theme tokens here, where
// we have full type-checked access to the brand palette.

import type { Block, Theme } from "./types";

type ChartBlock = Extract<Block, { type: "chart" }>;

const FONT = "'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif";

export function buildChartOption(block: ChartBlock, theme: Theme): unknown {
  const { colors, chartPalette } = theme;
  const base = {
    color: chartPalette,
    textStyle: { fontFamily: FONT, color: colors.ink },
    animation: false,
    tooltip: { show: false },
  };

  const multi = block.series.length > 1;
  const legend = {
    show: multi,
    top: 0,
    icon: "roundRect",
    itemWidth: 12,
    itemHeight: 12,
    textStyle: { color: colors.muted, fontSize: 11 },
  };

  if (block.chartType === "pie") {
    const cats = block.categories ?? [];
    const data = cats.map((name, i) => ({ name, value: block.series[0]?.data[i] ?? 0 }));
    return {
      ...base,
      legend: {
        show: true,
        bottom: 0,
        icon: "circle",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: colors.muted, fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["46%", "72%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
          label: {
            color: colors.ink,
            fontSize: 11,
            formatter: "{b}\n{d}%",
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: colors.border } },
          data,
        },
      ],
    };
  }

  const grid = { left: 6, right: 18, top: multi ? 34 : 12, bottom: 6, containLabel: true };
  const xAxis = {
    type: "category",
    data: block.categories ?? [],
    axisTick: { show: false },
    axisLine: { lineStyle: { color: colors.border } },
    axisLabel: { color: colors.muted, fontSize: 11 },
  };
  const yAxis = {
    type: "value",
    name: block.unit ?? "",
    nameGap: 14,
    nameTextStyle: { color: colors.muted, fontSize: 10, align: "left" },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    axisLabel: { color: colors.muted, fontSize: 11 },
  };

  if (block.chartType === "line") {
    return {
      ...base,
      legend,
      grid,
      xAxis,
      yAxis,
      series: block.series.map((s) => ({
        name: s.name,
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 3 },
        emphasis: { disabled: true },
        areaStyle: multi ? undefined : { opacity: 0.12 },
        data: s.data,
      })),
    };
  }

  // bar (default)
  return {
    ...base,
    legend,
    grid,
    xAxis,
    yAxis,
    series: block.series.map((s) => ({
      name: s.name,
      type: "bar",
      barMaxWidth: 46,
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      emphasis: { disabled: true },
      data: s.data,
    })),
  };
}
