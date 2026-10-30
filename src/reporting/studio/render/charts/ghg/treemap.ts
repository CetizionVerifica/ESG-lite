/**
 * DS-8 · `treemap`: categories of the current year as squarified rectangles
 * (Bruls, Huizing and van Wijk 2000), largest top-left. A tile is labelled
 * with its name, value and share only when it is big enough to hold them;
 * the total line comes from the server's display.
 * Binding: ghg · breakdown scope3_category (or source_category, fuel, site).
 */
import { formatNumber, seriesUnit } from "../../format";
import { contrastRatio, mix } from "../../theme";
import { esc, n3 } from "../../util";
import { FONT, LABEL_STEPS, SMALL, emptyChart, labelWidth, rect, svgOpen, text, type ChartInput } from "../svg";
import { clip, currentSeries, headline, partsOf, pct, ranked, total, type Part } from "./common";

export interface Tile extends Part {
  x: number;
  y: number;
  w: number;
  h: number;
}

const worst = (row: number[], side: number): number => {
  const s = row.reduce((a, b) => a + b, 0);
  const mx = Math.max(...row);
  const mn = Math.min(...row);
  return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
};

/** Squarified layout of positive parts (in the order given, largest first) into a w × h box. */
export function squarify(parts: Part[], w: number, h: number): Tile[] {
  const ps = parts.filter((p) => p.value > 0);
  const sum = total(ps);
  if (!ps.length || sum <= 0 || w <= 0 || h <= 0) return [];
  const scale = (w * h) / sum;
  const areas = ps.map((p) => p.value * scale);
  const out: Tile[] = [];
  let x = 0;
  let y = 0;
  let rw = w;
  let rh = h;
  let i = 0;
  while (i < ps.length) {
    const side = Math.min(rw, rh);
    const row = [areas[i]];
    let j = i + 1;
    while (j < ps.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j += 1;
    }
    const s = row.reduce((a, b) => a + b, 0);
    if (rw >= rh) {
      // A column on the left.
      const cw = s / rh;
      let yy = y;
      row.forEach((a, k) => {
        const th = a / cw;
        out.push({ ...ps[i + k], x, y: yy, w: cw, h: th });
        yy += th;
      });
      x += cw;
      rw -= cw;
    } else {
      // A row on top.
      const rh2 = s / rw;
      let xx = x;
      row.forEach((a, k) => {
        const tw = a / rh2;
        out.push({ ...ps[i + k], x: xx, y, w: tw, h: rh2 });
        xx += tw;
      });
      y += rh2;
      rh -= rh2;
    }
    i = j;
  }
  return out;
}

/**
 * What a tile prints: its name, then "value · share" on one line, or value and share on two (#209: a 3-decimal tCO₂e
 * figure is long). #209 review: a tile too small for that at the chart's size steps the text down (to 0.8 of it) before
 * it leaves anything out; only then does it print the value alone, then the name alone. Never a line measured as wider
 * than its tile.
 */
function tileText(t: Tile, v: string, share: string, values: boolean): { size: number; chars: number; lines: string[] } | null {
  const sizes = LABEL_STEPS.map((k) => SMALL * k);
  const at = (size: number) => ({ size, chars: Math.floor((t.w - size) / (size * 0.55)), fits: (s: string) => labelWidth(s, size) <= t.w - size });
  const named = sizes.map(at).filter((z) => t.h >= z.size * 2.4 && z.chars >= 4);
  if (!named.length) return null;
  const pick = (want: (z: ReturnType<typeof at>) => string[] | null): { size: number; chars: number; lines: string[] } | null => {
    for (const z of named) {
      const lines = want(z);
      if (lines) return { size: z.size, chars: z.chars, lines };
    }
    return null;
  };
  if (!values) return { size: named[0].size, chars: named[0].chars, lines: [] };
  const one = `${v} · ${share}`;
  return (
    pick((z) => (t.h >= z.size * 3.8 && z.fits(one) ? [one] : t.h >= z.size * 5.1 && z.fits(v) && z.fits(share) ? [v, share] : null)) ??
    pick((z) => (t.h >= z.size * 3.8 && z.fits(v) ? [v] : null)) ?? { size: named[0].size, chars: named[0].chars, lines: [] }
  );
}

export function treemapChart(input: ChartInput): string {
  const { value, w, h, theme, options } = input;
  const cur = currentSeries(value);
  const unit = seriesUnit(cur, value.unit); // #209 review: the series' own unit
  const ps = ranked(partsOf(cur).filter((p) => p.value > 0));
  const sum = total(ps);
  if (!ps.length || sum <= 0) return emptyChart(w, h, "No data", theme);
  const head = headline(value, theme, "Total", w);
  const tiles = squarify(ps, w, h - head.h);
  const base = options.colors === "brand" ? null : theme.colors.s3;
  let body = head.svg;
  tiles.forEach((t, i) => {
    const fill = t.key === "Other" ? theme.colors.muted : base ? mix(base, theme.colors.paper, Math.min(0.6, i * 0.07)) : theme.series[i % theme.series.length];
    const ink = contrastRatio(fill, "#FFFFFF") >= 3 ? "#FFFFFF" : theme.colors.ink;
    const y = head.h + t.y;
    body += rect(t.x, y, t.w, t.h, fill, ` stroke="${theme.colors.paper}" stroke-width="1" data-part="${esc(t.key)}"`);
    const at = tileText(t, formatNumber(t.value, "auto", unit), pct(t.value / sum), options.showValues !== false);
    if (at) {
      body += text(t.x + at.size * 0.5, y + at.size * 1.3, clip(t.key, at.chars), ink, { size: at.size, weight: 700 });
      at.lines.forEach((line, li) => {
        body += text(t.x + at.size * 0.5, y + at.size * (2.6 + 1.3 * li), line, ink, { size: at.size });
      });
    }
  });
  return `${svgOpen(w, h, input.label)}<g data-ghg-chart="treemap" data-tiles="${tiles.length}" style="font-size:${n3(FONT)}px">${body}</g></svg>`;
}
