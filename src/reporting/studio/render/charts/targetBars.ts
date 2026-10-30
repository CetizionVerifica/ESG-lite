/**
 * DS-1 · `target_bars`: one bar per year (first series), a dashed baseline and
 * a target marker with its year, from `value.target`.
 */
import { formatNumber, seriesUnit } from "../format";
import { n3 } from "../util";
import { axisWidth, bandLabels, tickBoxes, tickRoom, valueGridY } from "./axis";
import { linearScale } from "./scale";
import { FONT, LABEL_LIFT, LABEL_STEPS, SMALL, boxesMeet, emptyChart, fitLabelRow, inkBox, labelBox, plotSpan, rect, rectBox, svgOpen, text, type ChartInput, type LabelBox, type Obstacle } from "./svg";

export function targetBarsChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const pts = value.series?.[0]?.values ?? [];
  const unit = seriesUnit(value.series?.[0], value.unit); // #209 review: the series' own unit
  const target = value.target ?? null;
  if (!pts.length) return emptyChart(w, h, "No data", theme);
  const marks = [target?.baseline, target?.value].filter((v): v is number => typeof v === "number");
  const scale = linearScale(0, Math.max(...pts.map((p) => p.value ?? 0), ...marks));
  const x0 = axisWidth(scale);
  const pw = w - x0 - (target?.year ? FONT * 3 : 0);
  const band = pw / pts.length;
  const shown = pts.map((p, i) => ({ p, i })).filter((x) => x.p.value !== null);
  const showBase = options.showTarget !== false && typeof target?.baseline === "number";
  const showTarget = options.showTarget !== false && typeof target?.value === "number";
  const targetText = `Target${target?.year ? ` ${target.year}` : ""}`;
  // #209 round 5: where the target's words ("Baseline", "Target 2030") meet each other, the other's line or a tick label in a
  // plot whose top is `extra` lower, and how deep (the overlap's smaller side). A staggered row (fitLabelRow's lift) takes
  // only the height that makes no meeting new or deeper: the words production drew apart stay apart, and the target line
  // never strikes through "Baseline".
  const wordClashes = (extra: number): Map<string, number> => {
    const { top: te, ph: phe } = plotSpan(FONT * 1.2 + extra, h - FONT * 1.8);
    const words: { box: LabelBox; line: { x0: number; x1: number; y: number } }[] = [];
    if (showBase) {
      const y = te + phe - scale.t(target?.baseline as number) * phe;
      words.push({ box: inkBox(x0 + pw, y - SMALL * 0.4, "Baseline", SMALL, { anchor: "end" }), line: { x0, x1: x0 + pw, y } });
    }
    if (showTarget) {
      const y = te + phe - scale.t(target?.value as number) * phe;
      words.push({ box: inkBox(w, y - SMALL * 0.4, targetText, SMALL, { anchor: "end", bold: true }), line: { x0, x1: w - FONT * 0.5, y } });
    }
    const ticks = tickBoxes(scale, x0, te, phe);
    const out = new Map<string, number>();
    const depth = (a: LabelBox, b: LabelBox) => Math.min(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    words.forEach((a, i) => {
      ticks.forEach((t, k) => {
        if (boxesMeet(a.box, t)) out.set(`${i} tick ${k}`, depth(a.box, t));
      });
      words.forEach((b, j) => {
        if (j > i && boxesMeet(a.box, b.box)) out.set(`${i} word ${j}`, depth(a.box, b.box));
        // The other's line through the word's ink (1 unit of air: the target line is 1.6 wide).
        const [y0, y1] = [a.box.y0 - 1, a.box.y1 + 1];
        if (j !== i && b.line.x0 < a.box.x1 && a.box.x0 < b.line.x1 && b.line.y > y0 && b.line.y < y1) out.set(`${i} line ${j}`, Math.min(b.line.y - y0, y1 - b.line.y));
      });
    });
    return out;
  };
  const clashes0 = wordClashes(0);
  let wordLift = 0;
  for (const lift of LABEL_STEPS.map((k) => LABEL_LIFT * SMALL * k).sort((a, b) => a - b)) {
    if ([...wordClashes(lift)].some(([c, d]) => d > (clashes0.get(c) ?? 0) + 1e-6)) break;
    wordLift = lift;
  }
  // #209 review: bar labels may not meet each other, the tick labels, another bar or the target's words (svg.ts fitLabelRow); the latest year is kept first.
  const fit = fitLabelRow(
    (extra) => {
      const { top: te, ph: phe } = plotSpan(FONT * 1.2 + extra, h - FONT * 1.8);
      const obstacles: Obstacle[] = [...tickBoxes(scale, x0, te, phe)];
      shown.forEach(({ p, i }, li) => {
        const y = te + phe - scale.t(p.value as number) * phe;
        obstacles.push(rectBox(x0 + band * i + band * 0.2, y, band * 0.6, te + phe - y, li));
      });
      if (showBase) obstacles.push(labelBox(x0 + pw, te + phe - scale.t(target?.baseline as number) * phe - SMALL * 0.4, "Baseline", SMALL, { anchor: "end" }));
      if (showTarget) obstacles.push(labelBox(w, te + phe - scale.t(target?.value as number) * phe - SMALL * 0.4, targetText, SMALL, { anchor: "end", bold: true }));
      return { labels: shown.map(({ p, i }) => ({ x: x0 + band * (i + 0.5), y: te + phe - scale.t(p.value as number) * phe - SMALL * 0.5, text: formatNumber(p.value, "auto", unit), priority: i === pts.length - 1 ? 1 : 0 })), obstacles };
    },
    w,
    h,
    // #209 round 4: a staggered row takes only the height the plot can spare; the plot never goes under PLOT_FLOOR.
    // #209 round 5: nor more than keeps the target's words apart (wordLift).
    { x0, maxLift: Math.min(h - FONT * 3 - tickRoom(scale), wordLift) },
  );
  const { top, ph } = plotSpan(FONT * 1.2 + fit.extraTop, h - FONT * 1.8);
  let body = valueGridY(scale, x0, top, pw, ph, theme);
  shown.forEach(({ p, i }, li) => {
    const y = top + ph - scale.t(p.value as number) * ph;
    body += rect(x0 + band * i + band * 0.2, y, band * 0.6, top + ph - y, i === pts.length - 1 ? theme.colors.primary : theme.colors.prior);
    const at = fit.labels[li];
    if (at) body += text(at.x, at.y, formatNumber(p.value, "auto", unit), theme.colors.ink, { size: fit.size, anchor: "middle" });
  });
  if (showBase && typeof target?.baseline === "number") {
    const y = top + ph - scale.t(target.baseline) * ph;
    body += `<line x1="${n3(x0)}" x2="${n3(x0 + pw)}" y1="${n3(y)}" y2="${n3(y)}" stroke="${theme.colors.muted}" stroke-dasharray="4 3" stroke-width="1"/>`;
    body += text(x0 + pw, y - SMALL * 0.4, "Baseline", theme.colors.muted, { size: SMALL, anchor: "end" });
  }
  if (showTarget && typeof target?.value === "number") {
    const y = top + ph - scale.t(target.value) * ph;
    body += `<line x1="${n3(x0)}" x2="${n3(w - FONT * 0.5)}" y1="${n3(y)}" y2="${n3(y)}" stroke="${theme.colors.accent}" stroke-width="1.6" data-target="${n3(target.value)}"/>`;
    body += text(w, y - SMALL * 0.4, targetText, theme.colors.accent, { size: SMALL, anchor: "end", weight: 700 });
  }
  body += bandLabels(pts.map((p) => p.key), x0, band, top + ph + FONT * 1.2, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}
