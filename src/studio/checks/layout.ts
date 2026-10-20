/**
 * DS-12 (RS-9 §3) · layout checks from browser measurements (render/measure.ts):
 *
 *   TEXT_OVERFLOW       text taller than its frame (error, fix shrink_text)
 *   OUTSIDE_SAFE_AREA   a frame outside the format's safe margin, from the doc's frames (the
 *                       rotated box), so it never depends on a render; bleed-flagged pictures,
 *                       frames and shapes are exempt (error, fix move_inside)
 *   FONT_TOO_SMALL      below 8 pt; 7 pt for footnote and caption text, page numbers and the
 *                       labels inside charts and tables (error)
 *   LOW_CONTRAST        below WCAG 4.5:1 (3:1 for text of 18 pt and more). An error below 3:1
 *                       (unreadable); between 3:1 and 4.5:1 a warning to acknowledge, as when a
 *                       picture lies behind the text (contrast can't be read reliably there)
 *   OVERLAPS_LOCKED     an element over a template-locked one, from the doc (warning)
 *
 * Measurements come from the editor (live, for the panel) or the worker (proofs and finals:
 * the authoritative ones; jobs/worker.ts refuses a final with a layout error before the PDF).
 */
import type { Measurement } from "../../reporting/studio/render/measure";
import type { Check, Element, ReportDoc } from "../contracts";
import { formatSpec } from "../../reporting/studio/render/formats";
import { check } from "./types";
import { visibleElements } from "./walk";

export const MIN_FONT_PT = 8;
export const MIN_FOOTNOTE_PT = 7;
export const MIN_CONTRAST = 4.5;
export const MIN_CONTRAST_LARGE = 3;
export const LARGE_TEXT_PT = 18;
/** Overlaps smaller than this (mm²) are touching edges, not overlaps. */
const OVERLAP_MIN_MM2 = 1;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Element types whose small type is footnote-sized by design. */
const smallTextOk = (e: Element | undefined): boolean =>
  !!e && ((e.type === "text" && (e.props.style === "footnote" || e.props.style === "caption")) || e.type === "page_number" || e.type === "chart" || e.type === "table");

/** Elements that may reach into the bleed (schema rule: pictures, frames and shapes flagged `bleed`). */
const bleeds = (e: Element): boolean => (e.type === "image" || e.type === "frame" || e.type === "shape") && e.props.bleed === true;

/** The axis-aligned box of a rotated frame (mm). */
export function rotatedBox(f: { x: number; y: number; w: number; h: number; rotation: number }): { x: number; y: number; w: number; h: number } {
  const r = ((f.rotation % 360) * Math.PI) / 180;
  if (!r) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = f.w * c + f.h * s;
  const h = f.w * s + f.h * c;
  return { x: f.x + f.w / 2 - w / 2, y: f.y + f.h / 2 - h / 2, w, h };
}

/** OUTSIDE_SAFE_AREA from the doc: every printed element inside the safe margin. */
export function safeAreaChecks(doc: ReportDoc): Check[] {
  const { wMm, hMm, safeMm } = formatSpec(doc.format);
  const eps = 0.05;
  const out: Check[] = [];
  for (const { pageId, element: e } of visibleElements(doc)) {
    if (bleeds(e)) continue;
    const b = rotatedBox(e.frame);
    if (b.x < safeMm - eps || b.y < safeMm - eps || b.x + b.w > wMm - safeMm + eps || b.y + b.h > hMm - safeMm + eps) {
      out.push(check(doc, "OUTSIDE_SAFE_AREA", `This element is outside the ${safeMm} mm page margin and may be trimmed when printed.`, { pageId, elementId: e.id, fix: "move_inside", details: { frame: b, safeMm } }));
    }
  }
  return out;
}

export function layoutChecks(doc: ReportDoc, measurements: Measurement[] | null | undefined): Check[] {
  const out: Check[] = safeAreaChecks(doc);
  const els = new Map<string, { pageId: string; element: Element }>();
  for (const v of visibleElements(doc)) els.set(v.element.id, v);

  for (const m of measurements ?? []) {
    const v = els.get(m.elementId);
    if (!v || v.pageId !== m.pageId) continue; // hidden, deleted since, or another page
    const at = { pageId: m.pageId, elementId: m.elementId };
    if (m.overflowMm > 0) {
      out.push(check(doc, "TEXT_OVERFLOW", `This text doesn't fit its box: ${round1(m.overflowMm)} mm is cut off. Shrink it, make the box taller or move text to another page.`, { ...at, fix: "shrink_text", details: { overflowMm: m.overflowMm } }));
    }
    if (m.minFontPt !== null) {
      const min = smallTextOk(v.element) ? MIN_FOOTNOTE_PT : MIN_FONT_PT;
      if (m.minFontPt < min - 0.05) {
        out.push(check(doc, "FONT_TOO_SMALL", `Text here is ${round1(m.minFontPt)} pt. Use at least ${min} pt so it can be read in print.`, { ...at, details: { minFontPt: m.minFontPt, min } }));
      }
    }
    if (m.contrast !== null) {
      const large = (m.minFontPt ?? 0) >= LARGE_TEXT_PT;
      const need = large ? MIN_CONTRAST_LARGE : MIN_CONTRAST;
      if (m.contrast < need - 0.005) {
        out.push(
          check(doc, "LOW_CONTRAST", m.onImage ? `Text here may be hard to read over the picture (${m.contrast.toFixed(1)}:1). Check it in Page view.` : `Text here is hard to read: contrast ${m.contrast.toFixed(1)}:1, needs ${need}:1.`, {
            ...at,
            ...(m.onImage || m.contrast >= MIN_CONTRAST_LARGE ? { severity: "warning" as const } : {}),
            details: { contrast: m.contrast, need, onImage: m.onImage },
          }),
        );
      }
    }
  }

  // Overlaps with template-locked elements (geometry from the doc, rotation ignored).
  for (const page of doc.pages) {
    if (page.kind !== "freeform" || page.hidden) continue;
    const shown = page.elements.filter((e) => !e.hidden);
    const locked = shown.filter((e) => e.templateLocked);
    if (!locked.length) continue;
    for (const e of shown) {
      if (e.templateLocked) continue;
      const hit = locked.find((l) => overlapArea(e.frame, l.frame) >= OVERLAP_MIN_MM2);
      if (hit) out.push(check(doc, "OVERLAPS_LOCKED", "This element covers part of the template that is locked.", { pageId: page.id, elementId: e.id, fix: "move_inside", details: { lockedId: hit.id } }));
    }
  }
  return out;
}

export function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The layout errors a final can't have (the worker's gate before page.pdf). */
export const layoutErrors = (doc: ReportDoc, measurements: Measurement[]): Check[] => layoutChecks(doc, measurements).filter((c) => c.severity === "error");
