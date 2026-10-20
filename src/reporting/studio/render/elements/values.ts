/**
 * DS-1 · shared pieces for bound value elements (kpi_tile, big_number,
 * progress): the figure or "Not reported", the unit and the ▲/▼ delta
 * coloured by whether the change is good.
 */
import { notReported, unavailableReason } from "../data";
import type { RenderValue } from "../types";
import { esc } from "../util";

export const figure = (v: RenderValue | null, cls: string): string => {
  const reason = unavailableReason(v);
  if (reason || !v) return notReported(reason ?? "NOT_RESOLVED", `ds-nr ${cls}`);
  return `<span class="${cls}">${esc(v.display)}</span>${v.unit ? `<span class="ds-unit">${esc(v.unit)}</span>` : ""}`;
};

export const delta = (v: RenderValue | null): string => {
  const d = v?.delta;
  if (!d || !d.display || unavailableReason(v)) return "";
  const arrow = d.direction === "up" ? "▲" : d.direction === "down" ? "▼" : "●";
  const tone = d.good === true ? "good" : d.good === false ? "bad" : "flat";
  return `<span class="ds-delta ds-delta--${tone}" data-direction="${esc(d.direction)}">${arrow} ${esc(d.display)}</span>`;
};
