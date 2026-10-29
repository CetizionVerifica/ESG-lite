/**
 * DS-1 · part-of-whole charts: `donut`, `share_bar` and `dot_grid` (100 units).
 * Parts come from the first series' values (key = part), or from one value
 * per series. Labels under 4 % share are dropped (collision avoidance).
 */
import { formatNumber } from "../format";
import type { Theme } from "../theme";
import type { RenderValue } from "../types";
import { esc, n3 } from "../util";
import { FONT, SMALL, emptyChart, legend, rect, seriesColor, svgOpen, text, type ChartInput } from "./svg";

export const parts = (v: RenderValue, theme: Theme): { label: string; value: number; color: string }[] => {
  const series = v.series ?? [];
  const raw =
    series.length === 1
      ? series[0].values.map((p) => ({ label: p.key, value: p.value ?? 0 }))
      : series.map((s) => ({ label: s.label, value: s.values.reduce((a, p) => a + (p.value ?? 0), 0) }));
  return raw.filter((p) => p.value > 0).map((p, i) => ({ ...p, color: seriesColor(theme, p.label, i) }));
};

const pct = (x: number): string => `${formatNumber(x * 100, x * 100 < 10 ? "1dp" : "int")}%`;

export function donutChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const ps = parts(value, theme);
  const total = ps.reduce((a, p) => a + p.value, 0);
  if (!ps.length || total <= 0) return emptyChart(w, h, "No data", theme);
  const legendH = SMALL * 2;
  const r = Math.min(w, h - legendH) / 2 - FONT * 1.6;
  const cx = w / 2;
  const cy = (h - legendH) / 2;
  const inner = r * 0.62;
  let a0 = -Math.PI / 2;
  let body = "";
  for (const p of ps) {
    const a1 = a0 + (p.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad: number, a: number) => `${n3(cx + rad * Math.cos(a))} ${n3(cy + rad * Math.sin(a))}`;
    const d =
      ps.length === 1
        ? `M${pt(r, 0)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, Math.PI)}A${n3(r)} ${n3(r)} 0 1 1 ${pt(r, 0)}ZM${pt(inner, 0)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, Math.PI)}A${n3(inner)} ${n3(inner)} 0 1 0 ${pt(inner, 0)}Z`
        : `M${pt(r, a0)}A${n3(r)} ${n3(r)} 0 ${large} 1 ${pt(r, a1)}L${pt(inner, a1)}A${n3(inner)} ${n3(inner)} 0 ${large} 0 ${pt(inner, a0)}Z`;
    body += `<path d="${d}" fill="${p.color}" fill-rule="evenodd" stroke="${theme.colors.paper}" stroke-width="1"><title>${esc(p.label)}</title></path>`;
    const share = p.value / total;
    if (share >= 0.04) {
      const mid = (a0 + a1) / 2;
      body += text(cx + (r + FONT) * Math.cos(mid), cy + (r + FONT) * Math.sin(mid), pct(share), theme.colors.ink, { size: SMALL, anchor: Math.cos(mid) > 0.2 ? "start" : Math.cos(mid) < -0.2 ? "end" : "middle", baseline: "middle" });
    }
    a0 = a1;
  }
  body += text(cx, cy, value.display || formatNumber(total, "auto", value.unit), theme.colors.ink, { anchor: "middle", baseline: "middle", weight: 700, size: FONT * 1.4 });
  if (value.unit) body += text(cx, cy + FONT * 1.4, value.unit, theme.colors.muted, { anchor: "middle", baseline: "middle", size: SMALL });
  body += legend(ps, w, h - SMALL * 0.3, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}

export function shareBarChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  const ps = parts(value, theme);
  const total = ps.reduce((a, p) => a + p.value, 0);
  if (!ps.length || total <= 0) return emptyChart(w, h, "No data", theme);
  const barH = Math.min(h * 0.45, FONT * 3);
  let x = 0;
  let body = "";
  for (const p of ps) {
    const pw = (p.value / total) * w;
    body += rect(x, 0, pw, barH, p.color, ` stroke="${theme.colors.paper}" stroke-width="1"`);
    if (p.value / total >= 0.04) body += text(x + pw / 2, barH / 2, pct(p.value / total), "#FFFFFF", { size: SMALL, anchor: "middle", baseline: "middle", weight: 700 });
    x += pw;
  }
  body += legend(ps, w, barH + SMALL * 2.2, theme);
  return `${svgOpen(w, h, input.label)}${body}</svg>`;
}

export function dotGridChart(input: ChartInput): string {
  const { value, w, h, theme } = input;
  let share: number | null = null;
  if (value.progress !== undefined && value.progress !== null) share = value.progress;
  else if (value.value !== null && value.value >= 0 && value.value <= 1) share = value.value;
  else {
    const ps = parts(value, theme);
    const total = ps.reduce((a, p) => a + p.value, 0);
    if (ps.length && total > 0) share = ps[0].value / total;
  }
  if (share === null) return emptyChart(w, h, "No data", theme);
  const filled = Math.round(Math.min(1, Math.max(0, share)) * 100);
  const cell = Math.min(w, h) / 10;
  const ox = (w - cell * 10) / 2;
  const oy = (h - cell * 10) / 2;
  let body = "";
  for (let i = 0; i < 100; i++) {
    const cx = ox + (i % 10) * cell + cell / 2;
    const cy = oy + Math.floor(i / 10) * cell + cell / 2;
    body += `<circle cx="${n3(cx)}" cy="${n3(cy)}" r="${n3(cell * 0.38)}" fill="${i < filled ? theme.colors.primary : theme.colors.border}"/>`;
  }
  return `${svgOpen(w, h, input.label)}<g data-filled="${filled}">${body}</g></svg>`;
}
