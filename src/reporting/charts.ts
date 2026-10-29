// Server-side ECharts option builder. Returns plain, JSON-serializable option
// objects (no functions) so they can be embedded in the page and rendered by
// echarts in the browser. Chart styling is driven by theme tokens here, where
// we have full type-checked access to the brand palette.
//
// Print legibility rules: every mark carries its own value label, text is never
// smaller than 12px (≈9pt at print scale), axis/legend text uses a dark neutral
// rather than the light muted grey, and long category names go on a horizontal
// axis instead of being rotated or truncated.

import type { Block, Theme } from "./types";

type ChartBlock = Extract<Block, { type: "chart" }>;

const FONT = "Inter, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Dark neutral for axis + legend text: reads on paper where the muted grey fades.
const AXIS_INK = "#344054";
const GRID_LINE = "#EAECF0";

// Options are JSON-serialized into the page, so label formatters cannot be
// functions — instead each datum carries its own pre-formatted label string.
const nfmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }); // #209
const share = (v: number, total: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");

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
    left: "center",
    icon: "roundRect",
    itemWidth: 14,
    itemHeight: 14,
    itemGap: 22,
    textStyle: { color: AXIS_INK, fontSize: 13, fontWeight: 500 },
  };

  if (block.chartType === "pie") {
    const cats = block.categories ?? [];
    const values = cats.map((_, i) => block.series[0]?.data[i] ?? 0);
    const total = block.total ?? values.reduce((a, b) => a + b, 0);
    const unit = block.unit ?? block.series[0]?.name ?? "";
    // The legend doubles as the data key: each entry carries its value and share
    // (legend formatters can't be functions, so the name itself is pre-formatted).
    const data = cats.map((name, i) => ({
      name: `${name}  ·  ${nfmt(values[i])} (${share(values[i], total)})`,
      value: values[i],
      label: { formatter: share(values[i], total) },
    }));
    return {
      ...base,
      // Total in the donut hole, so the reader never has to add slices up.
      title: {
        text: nfmt(total),
        subtext: unit,
        left: "center",
        top: "29%",
        itemGap: 4,
        textStyle: { fontFamily: FONT, fontSize: 22, fontWeight: 700, color: colors.primary },
        subtextStyle: { fontFamily: FONT, fontSize: 12, color: AXIS_INK },
      },
      legend: {
        show: true,
        bottom: 0,
        left: "center",
        orient: "vertical",
        icon: "circle",
        itemWidth: 11,
        itemHeight: 11,
        itemGap: 8,
        textStyle: { color: colors.ink, fontSize: 12.5 },
      },
      series: [
        {
          type: "pie",
          radius: ["46%", "68%"],
          center: ["50%", "37%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
          label: { color: colors.ink, fontSize: 12.5, fontWeight: 700 },
          labelLine: { length: 10, length2: 10, lineStyle: { color: "#98A2B3", width: 1 } },
          emphasis: { disabled: true },
          data,
        },
      ],
    };
  }

  const cats = block.categories ?? [];
  const catCount = cats.length;

  // Horizontal bars: category names sit on the left at full length and the
  // value (plus share of total, when asked) reads at the end of each bar.
  if (block.horizontal && block.chartType === "bar") {
    const total = block.total ?? block.series[0]?.data.reduce((a, b) => a + b, 0) ?? 0;
    const unit = block.unit ? ` ${block.unit}` : "";
    return {
      ...base,
      legend,
      grid: { left: 8, right: block.showShare ? 170 : 110, top: multi ? 36 : 4, bottom: 4, containLabel: true },
      // Every bar is labelled with its value, so the value axis is left bare:
      // tick numbers would only compete with the labels.
      xAxis: { type: "value", show: false, splitLine: { show: false } },
      yAxis: {
        type: "category",
        inverse: true, // largest (first) at the top
        data: cats,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#98A2B3" } },
        axisLabel: { color: colors.ink, fontSize: 13, fontWeight: 500, width: 190, overflow: "break", lineHeight: 16, interval: 0 },
      },
      series: block.series.map((s) => ({
        name: s.name,
        type: "bar",
        barMaxWidth: 30,
        barCategoryGap: "38%",
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        emphasis: { disabled: true },
        data: s.data.map((v) => ({
          value: v,
          label: {
            show: true,
            position: "right",
            distance: 8,
            formatter: block.showShare && !multi ? `${nfmt(v)}${unit}  ·  ${share(v, total)}` : `${nfmt(v)}${unit}`,
            color: colors.ink,
            fontSize: 13,
            fontWeight: 700,
          },
        })),
      })),
    };
  }

  // Extra top room so the value label above the tallest bar/point never clips.
  const grid = { left: 8, right: 18, top: multi ? 52 : 34, bottom: 8, containLabel: true };
  const xAxis = {
    type: "category",
    data: cats,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: "#98A2B3" } },
    axisLabel: {
      color: colors.ink,
      fontSize: 13,
      fontWeight: 500,
      lineHeight: 16,
      margin: 10,
      // Force EVERY category label to render (echarts hides overlapping ones by
      // default). Wrap instead of truncating; rotate only when there are many.
      interval: 0,
      hideOverlap: false,
      rotate: catCount > 6 ? 30 : 0,
      width: catCount > 6 ? 100 : Math.max(90, Math.floor(560 / Math.max(catCount, 1))),
      overflow: "break",
    },
  };
  const yAxis = {
    type: "value",
    name: block.unit ?? "",
    nameGap: 16,
    nameTextStyle: { color: AXIS_INK, fontSize: 12, align: "left" },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: GRID_LINE } },
    axisLabel: { color: AXIS_INK, fontSize: 12 },
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
        symbolSize: 8,
        lineStyle: { width: 3 },
        emphasis: { disabled: true },
        areaStyle: multi ? undefined : { opacity: 0.12 },
        data: s.data.map((v) => ({
          value: v,
          label: { show: true, position: "top", formatter: nfmt(v), color: colors.ink, fontSize: 12, fontWeight: 700 },
        })),
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
      barMaxWidth: multi ? 40 : 64,
      barGap: "12%",
      itemStyle: { borderRadius: [4, 4, 0, 0] },
      emphasis: { disabled: true },
      data: s.data.map((v) => ({
        value: v,
        // Every bar shows its value on top; zero bars stay unlabelled so they
        // don't read as a mark.
        label: { show: v !== 0, position: "top", distance: 6, formatter: nfmt(v), color: colors.ink, fontSize: multi ? 12 : 13, fontWeight: 700 },
      })),
    })),
  };
}
