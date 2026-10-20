/**
 * DS-1 · `materiality_matrix`: impact (y) × financial (x), 0–10, threshold
 * lines at 5 and labelled points from `value.points`.
 */
import { n3 } from "../util";
import { SMALL, emptyChart, rect, svgOpen, text, type ChartInput } from "./svg";

export function materialityMatrix(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const pts = value.points ?? [];
  if (!pts.length) return emptyChart(w, h, "No data", theme);
  const x0 = SMALL * 2;
  const pw = w - x0;
  const ph = h - SMALL * 2;
  const X = (v: number) => x0 + (Math.min(10, Math.max(0, v)) / 10) * pw;
  const Y = (v: number) => ph - (Math.min(10, Math.max(0, v)) / 10) * ph;
  let body = rect(X(5), 0, pw / 2, ph / 2, theme.colors.surface);
  body += `<rect x="${n3(x0)}" y="0" width="${n3(pw)}" height="${n3(ph)}" fill="none" stroke="${theme.colors.border}"/>`;
  body += `<line x1="${n3(X(5))}" x2="${n3(X(5))}" y1="0" y2="${n3(ph)}" stroke="${theme.colors.muted}" stroke-dasharray="3 3"/><line x1="${n3(x0)}" x2="${n3(w)}" y1="${n3(Y(5))}" y2="${n3(Y(5))}" stroke="${theme.colors.muted}" stroke-dasharray="3 3"/>`;
  pts.forEach((p) => {
    const material = p.x >= 5 || p.y >= 5;
    body += `<circle cx="${n3(X(p.x))}" cy="${n3(Y(p.y))}" r="${n3(SMALL * 0.45)}" fill="${material ? theme.colors.primary : theme.colors.prior}"/>`;
    body += text(X(p.x) + SMALL * 0.7, Y(p.y), p.label, theme.colors.ink, { size: SMALL * 0.9, baseline: "middle" });
  });
  body += text(x0 + pw / 2, h - SMALL * 0.2, "Financial materiality", theme.colors.muted, { size: SMALL, anchor: "middle" });
  body += `<text x="${n3(SMALL)}" y="${n3(ph / 2)}" font-size="${n3(SMALL)}" fill="${theme.colors.muted}" text-anchor="middle" transform="rotate(-90 ${n3(SMALL)} ${n3(ph / 2)})">Impact materiality</text>`;
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}
