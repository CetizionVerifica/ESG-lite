/** DS-1 §3 · progress: a ring or bar from a `progress` measure (0..1 in `RenderValue.progress`). */
import { dataMarks, lookup, notReported, unavailableReason } from "../data";
import { formatNumber } from "../format";
import { esc, hex, n3 } from "../util";
import type { ElementRenderer } from "./types";

export const progressElement: ElementRenderer<"progress"> = (el, ctx) => {
  const p = el.props;
  const v = lookup(ctx.data, p.binding);
  const color = hex(p.color) ?? ctx.theme.colors.primary;
  const raw = v?.progress;
  const reason = unavailableReason(v) ?? (typeof raw !== "number" || !Number.isFinite(raw) ? "NO_PROGRESS" : null);
  const label = p.label ? `<div class="ds-progress-label">${esc(p.label)}</div>` : "";
  if (reason) return { html: `<div class="ds-progress">${notReported(reason)}${label}</div>`, attrs: dataMarks(p.binding, v) };
  const f = Math.min(1, Math.max(0, raw as number));
  const pct = `${formatNumber((raw as number) * 100, "int")}%`;
  const shown = v?.display || pct;
  let html: string;
  if (p.variant === "ring") {
    const r = 15.9155; // circumference 100
    html =
      `<div class="ds-progress ds-progress--ring"><svg viewBox="0 0 36 36" width="100%" height="100%" role="img" aria-label="${esc(`${p.label ?? "Progress"}: ${shown}`)}">` +
      `<circle cx="18" cy="18" r="${r}" fill="none" stroke="${ctx.theme.colors.border}" stroke-width="3.2"/>` +
      `<circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${n3(f * 100)} 100" transform="rotate(-90 18 18)"/>` +
      `<text x="18" y="18" text-anchor="middle" dominant-baseline="central" font-size="7" font-weight="700" fill="${ctx.theme.colors.ink}">${esc(shown)}</text></svg>${label}</div>`;
  } else {
    html = `<div class="ds-progress ds-progress--bar"><div class="ds-progress-head">${label}<span class="ds-progress-pct">${esc(shown)}</span></div><div class="ds-progress-track"><div class="ds-progress-fill" style="width:${n3(f * 100)}%;background:${color}"></div></div></div>`;
  }
  return { html, attrs: `${dataMarks(p.binding, v)} data-progress="${n3(f)}"` };
};
