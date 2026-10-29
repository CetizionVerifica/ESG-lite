// Print charts drawn as static SVG on the server. Geometry is in tenths of a
// millimetre against the 178 mm A4 text width (viewBox width 1780), so a font
// size of 30 is 3 mm (~8.5 pt) on paper whatever the page scale. Every mark is
// labelled with its value, so there are no value axes or gridlines to read.

const W = 1780;
const INK = "#14213D";
const MUTED = "#4A5568";
const AXIS = "#4A5568";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }); // #209
const share = (v: number, total: number) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : "—");

// Rough average glyph width of the report's sans face, as a fraction of the font size.
const GLYPH = 0.5;

function text(x: number, y: number, s: string, size: number, weight: number, fill: string, anchor = "start"): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}

/** Split a label into at most two lines that fit `width` units at `size`. */
function wrap(label: string, width: number, size: number): string[] {
  const max = Math.max(4, Math.floor(width / (size * GLYPH)));
  if (label.length <= max) return [label];
  const words = label.split(/\s+/);
  let first = "";
  while (words.length && (first + (first ? " " : "") + words[0]).length <= max) first += (first ? " " : "") + words.shift();
  if (!first) first = words.shift() ?? "";
  let rest = words.join(" ");
  if (rest.length > max) rest = rest.slice(0, max - 1) + "…";
  return rest ? [first, rest] : [first];
}

/** Right-aligned category label, vertically centred on a bar (one or two lines). */
function rowLabel(x: number, cy: number, label: string, width: number, size: number): string {
  const lines = wrap(label, width, size);
  const lh = size * 1.15;
  const y0 = cy + size * 0.35 - ((lines.length - 1) * lh) / 2;
  return lines.map((l, i) => text(x, y0 + i * lh, l, size, 500, INK, "end")).join("");
}

/** A bar with its data end rounded and its baseline end square. */
function bar(x: number, y: number, w: number, h: number, fill: string): string {
  const r = Math.min(6, w / 2, h / 2);
  if (w <= 0) return "";
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} h${(w - r).toFixed(1)} q${r} 0 ${r} ${r} v${(h - 2 * r).toFixed(1)} q0 ${r} -${r} ${r} h-${(w - r).toFixed(1)} z" fill="${fill}"/>`;
}

const svg = (h: number, body: string, label: string) =>
  `<svg class="svg-chart" viewBox="0 0 ${W} ${Math.ceil(h)}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export interface HBarRow { label: string; value: number; color?: string }

/** Ranked horizontal bars; each bar ends in "value unit · share". */
export function hbarSvg(rows: HBarRow[], opts: { color: string; unit?: string; total?: number; showShare?: boolean; labelWidth?: number; barH?: number }): string {
  const labelW = opts.labelWidth ?? 560;
  const barH = opts.barH ?? 60;
  const gap = Math.round(barH * 0.6);
  const unit = opts.unit ? ` ${opts.unit}` : "";
  const total = opts.total ?? rows.reduce((a, r) => a + r.value, 0);
  const valueRoom = opts.showShare ? 380 : 260;
  const plot = W - labelW - valueRoom;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const h = rows.length * (barH + gap);
  const out: string[] = [];
  rows.forEach((r, i) => {
    const y = i * (barH + gap) + gap / 2;
    const w = r.value > 0 ? Math.max(4, (r.value / max) * plot) : 0;
    out.push(rowLabel(labelW - 24, y + barH / 2, r.label, labelW - 40, 31));
    out.push(bar(labelW, y, w, barH, r.color ?? opts.color));
    const lab = `${num(r.value)}${unit}` + (opts.showShare ? `  ·  ${share(r.value, total)}` : "");
    out.push(text(labelW + w + 16, y + barH / 2 + 11, lab, 30, 700, INK));
  });
  out.push(`<line x1="${labelW}" y1="0" x2="${labelW}" y2="${h}" stroke="${AXIS}" stroke-width="2"/>`);
  return svg(h, out.join(""), rows.map((r) => `${r.label} ${num(r.value)}`).join(", "));
}

export interface SharePart { label: string; value: number; color: string }

/** A single 100% bar; each part is named and labelled above its own segment. */
export function shareBarSvg(parts: SharePart[], unit?: string): string {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const barY = 120, barH = 86;
  const out: string[] = [];
  let x = 0;
  shown.forEach((p, i) => {
    const w = total > 0 ? (p.value / total) * W : 0;
    out.push(`<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(w - 4, 2).toFixed(1)}" height="${barH}" fill="${p.color}" rx="5"/>`);
    // The last part's label is right-aligned so a thin end segment keeps its label on the page.
    const last = i === shown.length - 1 && shown.length > 1;
    const tx = last ? x + w - 4 : x;
    const anchor = last ? "end" : "start";
    out.push(text(tx, barY - 50, p.label, 28, 600, MUTED, anchor));
    out.push(text(tx, barY - 14, `${num(p.value)}  ·  ${share(p.value, total)}`, 32, 700, INK, anchor));
    x += w;
  });
  out.push(text(0, barY + barH + 50, "0%", 25, 400, MUTED));
  out.push(text(W, barY + barH + 50, `100% = ${num(total)}${unit ? ` ${unit}` : ""}`, 25, 400, MUTED, "end"));
  return svg(barY + barH + 64, out.join(""), shown.map((p) => `${p.label} ${share(p.value, total)}`).join(", "));
}

/** One horizontal stacked bar per row with a legend above; rows end in "total · share". */
export function stackedBarsSvg(
  series: { name: string; color: string }[],
  rows: { label: string; values: number[] }[],
  opts: { total?: number; labelWidth?: number } = {},
): string {
  const labelW = opts.labelWidth ?? 560;
  const barH = 74, gap = 50, top = 70;
  const sums = rows.map((r) => r.values.reduce((a, b) => a + b, 0));
  const total = opts.total ?? sums.reduce((a, b) => a + b, 0);
  const plot = W - labelW - 360;
  const max = Math.max(1, ...sums);
  const out: string[] = [];
  let lx = labelW;
  for (const s of series) {
    out.push(`<rect x="${lx}" y="10" width="26" height="26" rx="5" fill="${s.color}"/>`);
    out.push(text(lx + 38, 33, s.name, 27, 500, INK));
    lx += 38 + s.name.length * 27 * GLYPH + 60;
  }
  rows.forEach((r, i) => {
    const y = top + i * (barH + gap) + gap / 2;
    let x = labelW;
    out.push(rowLabel(labelW - 24, y + barH / 2, r.label, labelW - 40, 31));
    r.values.forEach((v, j) => {
      const w = (v / max) * plot;
      if (w <= 0) return;
      const color = series[j]?.color ?? INK;
      out.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(w - 3, 1.5).toFixed(1)}" height="${barH}" fill="${color}"/>`);
      // Label a segment inside only when the number fits; the row total carries the rest.
      const label = num(v);
      if (w > label.length * 27 * 0.62 + 24) out.push(text(x + w / 2, y + barH / 2 + 10, label, 27, 700, readableOn(color), "middle"));
      x += w;
    });
    out.push(text(x + 16, y + barH / 2 + 11, `${num(sums[i])}  ·  ${share(sums[i], total)}`, 30, 700, INK));
  });
  const h = top + rows.length * (barH + gap);
  out.push(`<line x1="${labelW}" y1="${top}" x2="${labelW}" y2="${h}" stroke="${AXIS}" stroke-width="2"/>`);
  return svg(h, out.join(""), rows.map((r, i) => `${r.label} ${num(sums[i])}`).join(", "));
}

/** White or ink, whichever reads better on a fill (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? INK : "#ffffff";
}
