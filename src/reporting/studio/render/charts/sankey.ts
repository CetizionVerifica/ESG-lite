/**
 * DS-1 · `sankey`: sources (left) → uses (right) from `value.links`. Node
 * heights are proportional to flow; the left and right columns each sum to
 * the total of the links.
 */
import type { Theme } from "../theme";
import { esc, n3 } from "../util";
import { SMALL, emptyChart, rect, seriesColor, svgOpen, text, type ChartInput } from "./svg";

export interface SankeyLayout {
  left: { name: string; y: number; h: number; value: number }[];
  right: { name: string; y: number; h: number; value: number }[];
  total: number;
}

export function sankeyLayout(links: { from: string; to: string; value: number }[], height: number, gap: number): SankeyLayout {
  const sum = (names: string[], pick: (l: { from: string; to: string; value: number }) => string) =>
    names.map((n) => ({ name: n, value: links.filter((l) => pick(l) === n).reduce((a, l) => a + Math.max(0, l.value), 0) }));
  const uniq = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) === i);
  const L = sum(uniq(links.map((l) => l.from)), (l) => l.from);
  const R = sum(uniq(links.map((l) => l.to)), (l) => l.to);
  const total = L.reduce((a, n) => a + n.value, 0);
  const place = (ns: { name: string; value: number }[]) => {
    const k = total > 0 ? (height - gap * (ns.length - 1)) / total : 0;
    let y = 0;
    return ns.map((n) => {
      const out = { ...n, y, h: n.value * k };
      y += n.value * k + gap;
      return out;
    });
  };
  return { left: place(L), right: place(R), total };
}

export function sankeyChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const links = (value.links ?? []).filter((l) => l.value > 0);
  if (!links.length) return emptyChart(w, h, "No data", theme);
  const lay = sankeyLayout(links, h, SMALL * 0.8);
  const nodeW = SMALL * 1.2;
  const labelW = w * 0.22;
  const xl = labelW;
  const xr = w - labelW - nodeW;
  const colorOf = (t: Theme, i: number, name: string) => seriesColor(t, name, i);
  let body = "";
  const lOff = new Map(lay.left.map((n) => [n.name, n.y]));
  const rOff = new Map(lay.right.map((n) => [n.name, n.y]));
  const k = lay.total > 0 ? (h - SMALL * 0.8 * (lay.left.length - 1)) / lay.total : 0;
  const kr = lay.total > 0 ? (h - SMALL * 0.8 * (lay.right.length - 1)) / lay.total : 0;
  links.forEach((l) => {
    const li = lay.left.findIndex((n) => n.name === l.from);
    const y0 = lOff.get(l.from) ?? 0;
    const y1 = rOff.get(l.to) ?? 0;
    const h0 = l.value * k;
    const h1 = l.value * kr;
    lOff.set(l.from, y0 + h0);
    rOff.set(l.to, y1 + h1);
    const xm = (xl + nodeW + xr) / 2;
    body += `<path d="M${n3(xl + nodeW)} ${n3(y0)}C${n3(xm)} ${n3(y0)} ${n3(xm)} ${n3(y1)} ${n3(xr)} ${n3(y1)}L${n3(xr)} ${n3(y1 + h1)}C${n3(xm)} ${n3(y1 + h1)} ${n3(xm)} ${n3(y0 + h0)} ${n3(xl + nodeW)} ${n3(y0 + h0)}Z" fill="${colorOf(theme, li, l.from)}" fill-opacity="0.35"><title>${esc(`${l.from} → ${l.to}`)}</title></path>`;
  });
  lay.left.forEach((n, i) => {
    body += rect(xl, n.y, nodeW, n.h, colorOf(theme, i, n.name)) + text(xl - SMALL * 0.4, n.y + n.h / 2, n.name, theme.colors.ink, { size: SMALL, anchor: "end", baseline: "middle" });
  });
  lay.right.forEach((n) => {
    body += rect(xr, n.y, nodeW, n.h, theme.colors.muted) + text(xr + nodeW + SMALL * 0.4, n.y + n.h / 2, n.name, theme.colors.ink, { size: SMALL, baseline: "middle" });
  });
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}
