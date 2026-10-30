/**
 * DS-1 · bar charts: `bar` (one series, or grouped series) and `stacked_bar`.
 * Prior years are grey and the latest is highlighted (greyPrior); bars start
 * at zero; `horizontal` lays categories down the side.
 */
import { formatNumber, sharedUnit } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, tickBoxes, tickFloorX, tickRoom, valueGridX, valueGridY } from "./axis";
import { inkExtent } from "./metrics";
import { linearScale } from "./scale";
import { FONT, INK_GAP, LABEL_STEPS, SMALL, barEndsPlot, boxesMeet, emptyChart, fitBarEnds, fitLabelRow, inkBox, isYearKey, keysOf, legend, plotSpan, rect, rectBox, seriesColor, svgOpen, text, valueAt, type ChartInput, type LabelBox, type Obstacle } from "./svg";

function draw(input: ChartInput, stacked: boolean): string {
  const { value, w, h, theme, options } = input;
  const series = value.series ?? [];
  const keys = keysOf(series);
  if (!series.length || !keys.length) return emptyChart(w, h, "No data", theme);
  const multi = series.length > 1;
  const totals = keys.map((k) => series.reduce((a, s) => a + Math.max(0, valueAt(s, k) ?? 0), 0));
  const negs = keys.map((k) => series.reduce((a, s) => a + Math.min(0, valueAt(s, k) ?? 0), 0));
  const all = series.flatMap((s) => s.values.map((v) => v.value ?? 0));
  const scale = stacked ? linearScale(Math.min(...negs), Math.max(...totals)) : linearScale(Math.min(...all), Math.max(...all));
  const legendH = multi ? SMALL * 2 : 0;
  const latest = keys[keys.length - 1];
  // #209 review: a label is one series' value or a stacked total; it prints in the series' unit, a total only in the unit every summed series shares.
  const labelUnit = sharedUnit(series, value.unit);
  const valueText = (v: number) => formatNumber(v, "auto", labelUnit);
  const colorFor = (si: number, key: string): string => {
    if (!multi && options.greyPrior !== false && isYearKey(key) && keys.length > 1 && key !== latest) return theme.colors.prior;
    return seriesColor(theme, series[si].label, si);
  };
  let body = "";
  if (options.horizontal) {
    const labelW = Math.min(w * 0.35, Math.max(...keys.map((k) => k.length)) * SMALL * 0.55 + SMALL);
    const x0 = labelW;
    const ph = h - legendH - SMALL * 2;
    const band = ph / keys.length;
    const labelled = options.showValues !== false && (stacked || !multi);
    // #209 review: in a thin band a total would sit on the next band's longer bar, so it starts after the end of every bar
    // its ink reaches (a bar spans 0.18–0.82 of its band; #209 round 4: the label's glyphs above and below its middle
    // baseline, metrics.ts inkExtent, and INK_GAP of air: a total production drew clear of the next bar stays).
    const reach = (ki: number, size: number): number => {
      const ink = inkExtent(valueText(totals[ki]), "middle");
      return keys.reduce((t, _, kj) => (kj !== ki && Math.abs(kj - ki) * band - band * 0.32 < ((kj < ki ? ink.up : ink.down) + INK_GAP) * size ? Math.max(t, scale.t(totals[kj])) : t), scale.t(totals[ki]));
    };
    // Totals sit after the bar end; a long one (a 3-decimal tCO₂e figure, #209) narrows the plot so it isn't cut.
    // #209 round 4: never narrower than its tick labels need (barEndsPlot): the totals step down first.
    const pw0 = w - x0 - SMALL * 3;
    const steps = LABEL_STEPS.map((k) => SMALL * k);
    const pw = labelled ? barEndsPlot(tickFloorX(scale, pw0), steps, (sz) => fitBarEnds(pw0, x0, w, totals.map((t, ki) => ({ t: reach(ki, sz), label: valueText(t) })), SMALL * 0.4, sz)) : pw0;
    const barRects = (ki: number): { x: number; y: number; w: number; h: number }[] => {
      let acc = 0;
      return series.map((s) => {
        const v = valueAt(s, keys[ki]) ?? 0;
        const a = x0 + scale.t(Math.min(acc, acc + v)) * pw;
        const b = x0 + scale.t(Math.max(acc, acc + v)) * pw;
        acc += stacked ? v : 0;
        return { x: a, y: band * ki + band * 0.18, w: b - a, h: band * 0.64 };
      });
    };
    // Totals don't meet each other or another band's bar: the row steps down a size, then a total that would meet its
    // neighbour's moves along after it (inside the chart); only in a band too thin for that are totals left out, the
    // latest year and then the biggest kept first.
    const order = keys.map((_, ki) => ki).sort((a, b) => Number(keys[b] === latest) - Number(keys[a] === latest) || totals[b] - totals[a]);
    const bars: Obstacle[] = labelled ? keys.flatMap((_, ki) => barRects(ki).map((r) => rectBox(r.x, r.y, r.w, r.h, ki))) : [];
    type RowFit = { size: number; at: Map<number, number> };
    const rowFit = (size: number, mode: "plain" | "shift" | "drop"): RowFit | null => {
      const placed: LabelBox[] = [];
      const at = new Map<number, number>();
      for (const ki of labelled ? order : []) {
        const s = valueText(totals[ki]);
        let x = x0 + reach(ki, size) * pw + SMALL * 0.4;
        let box = inkBox(x, band * ki + band / 2, s, size, { baseline: "middle" });
        for (let n = 0; mode !== "plain" && n <= placed.length; n++) {
          const hit = placed.filter((b) => boxesMeet(b, box, size * INK_GAP));
          if (!hit.length) break;
          x = Math.max(...hit.map((b) => b.x1)) + size * 0.3;
          box = inkBox(x, band * ki + band / 2, s, size, { baseline: "middle" });
        }
        const moved = x > x0 + reach(ki, size) * pw + SMALL * 0.4;
        const meets = placed.some((b) => boxesMeet(b, box, size * INK_GAP)) || bars.some((b) => b.owner !== ki && boxesMeet(b, box, size * INK_GAP)) || box.x1 > w + (moved ? 0 : 1e-6);
        if (meets && mode !== "drop") return null;
        if (meets) continue;
        placed.push(box);
        at.set(ki, x);
      }
      return { size, at };
    };
    const fit =
      steps.map((sz) => rowFit(sz, "plain")).find(Boolean) ??
      steps.map((sz) => rowFit(sz, "shift")).find(Boolean) ??
      (rowFit(steps[steps.length - 1], "drop") as RowFit);
    // Category names step down to fit their band; in a band too thin for the smallest size every n-th is named, the latest
    // always. #209 round 4: decided on the names' ink (a year's figures take 0.8 em, a name with a descender 1.08 em), so
    // names production drew apart stay.
    const nameInk = keys.map((k) => inkExtent(k, "middle"));
    const pitch = Math.max(...nameInk.map((e) => e.up)) + Math.max(...nameInk.map((e) => e.down)) + INK_GAP;
    const keySize = steps.find((sz) => sz * pitch <= band) ?? steps[steps.length - 1];
    const every = Math.max(1, Math.ceil((keySize * pitch) / band));
    body += valueGridX(scale, x0, 0, pw, ph, theme);
    keys.forEach((k, ki) => {
      const y = band * ki;
      if ((keys.length - 1 - ki) % every === 0) body += text(x0 - SMALL * 0.5, y + band / 2, k, theme.colors.ink, { size: keySize, anchor: "end", baseline: "middle" });
      if (stacked || !multi) {
        barRects(ki).forEach((r, si) => {
          body += rect(r.x, r.y, r.w, r.h, colorFor(si, k));
        });
        const lx = fit.at.get(ki);
        if (labelled && lx !== undefined) body += text(lx, y + band / 2, valueText(totals[ki]), theme.colors.ink, { size: fit.size, baseline: "middle" });
      } else {
        const sub = (band * 0.7) / series.length;
        series.forEach((s, si) => {
          const v = valueAt(s, k) ?? 0;
          const a = x0 + scale.t(Math.min(0, v)) * pw;
          const b = x0 + scale.t(Math.max(0, v)) * pw;
          body += rect(a, y + band * 0.15 + sub * si, b - a, sub * 0.9, colorFor(si, k));
        });
      }
    });
  } else {
    const x0 = axisWidth(scale);
    const pw = w - x0;
    const band = pw / keys.length;
    const labelled = options.showValues !== false && (stacked || !multi);
    // The bars of key ki over a plot [y0, y0 + ph]: one rect per series (stacked or a single series).
    const barRects = (ki: number, y0: number, ph: number): { x: number; y: number; w: number; h: number }[] => {
      let acc = 0;
      return series.map((s) => {
        const v = valueAt(s, keys[ki]) ?? 0;
        const top = y0 + ph - scale.t(Math.max(acc, acc + v)) * ph;
        const bottom = y0 + ph - scale.t(Math.min(acc, acc + v)) * ph;
        acc += stacked ? v : 0;
        return { x: x0 + band * ki + band * 0.18, y: top, w: band * 0.64, h: bottom - top };
      });
    };
    // #209 review: totals over neighbouring bars may not meet each other, the tick labels or another bar; a row that doesn't
    // fit steps down a size or staggers (taking a line from the plot), and stays inside the plot.
    const fit = fitLabelRow(
      (extra) => {
        if (!labelled) return { labels: [] };
        const { top: y0e, ph: phe } = plotSpan(FONT * 1.2 + extra, h - legendH - FONT * 1.8);
        const obstacles: Obstacle[] = [...tickBoxes(scale, x0, y0e, phe), ...keys.flatMap((_, ki) => barRects(ki, y0e, phe).map((r) => rectBox(r.x, r.y, r.w, r.h, ki)))];
        return { labels: keys.map((k, ki) => ({ x: x0 + band * (ki + 0.5), y: y0e + phe - scale.t(totals[ki]) * phe - SMALL * 0.5, text: valueText(totals[ki]), bold: k === latest })), obstacles };
      },
      w,
      h,
      // #209 round 4: a staggered row takes only the height the plot can spare (its axis room), and the plot never goes
      // under PLOT_FLOOR.
      { x0, maxLift: h - legendH - FONT * 3 - tickRoom(scale) },
    );
    const { top: y0, ph } = plotSpan(options.showValues !== false ? FONT * 1.2 + fit.extraTop : 0, h - legendH - FONT * 1.8);
    body += valueGridY(scale, x0, y0, pw, ph, theme);
    keys.forEach((k, ki) => {
      const x = x0 + band * ki;
      if (stacked || !multi) {
        barRects(ki, y0, ph).forEach((r, si) => {
          body += rect(r.x, r.y, r.w, r.h, colorFor(si, k));
        });
        const at = fit.labels[ki];
        if (options.showValues !== false && at) body += text(at.x, at.y, valueText(totals[ki]), theme.colors.ink, { size: fit.size, anchor: "middle", weight: k === latest ? 700 : undefined });
      } else {
        const sub = (band * 0.7) / series.length;
        series.forEach((s, si) => {
          const v = valueAt(s, k) ?? 0;
          const top = y0 + ph - scale.t(Math.max(0, v)) * ph;
          const bottom = y0 + ph - scale.t(Math.min(0, v)) * ph;
          body += rect(x + band * 0.15 + sub * si, top, sub * 0.9, bottom - top, colorFor(si, k));
        });
      }
    });
    body += bandLabels(keys, x0, band, y0 + ph + FONT * 1.2, theme);
  }
  if (multi) body += legend(series.map((s, i) => ({ label: s.label, color: seriesColor(theme, s.label, i) })), w, h - SMALL * 0.3, theme);
  return `${svgOpen(w, h, input.label)}<g data-bars="${n3(keys.length)}">${body}</g></svg>`;
}

export const barChart = (input: ChartInput): string => draw(input, input.options.stacked === true);
export const stackedBarChart = (input: ChartInput): string => draw(input, true);
