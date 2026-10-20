/**
 * DS-1 §1 · page formats: the only table of page sizes in the renderer.
 * Sizes match 01-contracts PAGE_FORMAT_SIZES (a unit test compares them).
 * Print formats carry a 3 mm bleed; screen formats (slides, social) have none.
 */
import type { PageFormat } from "./types";

export interface FormatSpec {
  id: PageFormat;
  label: string;
  wMm: number;
  hMm: number;
  /** Safe margin from the trim edge; checks flag elements outside it (OUTSIDE_SAFE_AREA). */
  safeMm: number;
  /** Bleed past the trim edge in print mode. */
  bleedMm: number;
  /** Paper (true) or a screen format (slides, social cards). */
  print: boolean;
  /** Margins for flow sections on this format: top, right, bottom, left. */
  flowMarginsMm: [number, number, number, number];
}

export const FORMATS: Record<PageFormat, FormatSpec> = {
  a4: { id: "a4", label: "A4", wMm: 210, hMm: 297, safeMm: 10, bleedMm: 3, print: true, flowMarginsMm: [22, 18, 22, 18] },
  a4_landscape: { id: "a4_landscape", label: "A4 landscape", wMm: 297, hMm: 210, safeMm: 10, bleedMm: 3, print: true, flowMarginsMm: [18, 20, 18, 20] },
  letter: { id: "letter", label: "US Letter", wMm: 215.9, hMm: 279.4, safeMm: 10, bleedMm: 3, print: true, flowMarginsMm: [22, 19, 22, 19] },
  a5: { id: "a5", label: "A5", wMm: 148, hMm: 210, safeMm: 8, bleedMm: 3, print: true, flowMarginsMm: [16, 13, 16, 13] },
  slide_16_9: { id: "slide_16_9", label: "Presentation 16:9", wMm: 338.7, hMm: 190.5, safeMm: 12, bleedMm: 0, print: false, flowMarginsMm: [16, 20, 16, 20] },
  square: { id: "square", label: "Social square", wMm: 285.75, hMm: 285.75, safeMm: 14, bleedMm: 0, print: false, flowMarginsMm: [20, 20, 20, 20] },
  social_191: { id: "social_191", label: "Social 1.91:1", wMm: 317.5, hMm: 166.1, safeMm: 12, bleedMm: 0, print: false, flowMarginsMm: [14, 18, 14, 18] },
};

export const formatSpec = (f: PageFormat): FormatSpec => FORMATS[f] ?? FORMATS.a4;

/** CSS px per mm at 96 dpi. */
export const PX_PER_MM = 96 / 25.4;

/** The page size in CSS px at 96 dpi (PNG export, editor zoom). */
export const formatPx = (f: PageFormat): { w: number; h: number } => {
  const s = formatSpec(f);
  return { w: Math.round(s.wMm * PX_PER_MM), h: Math.round(s.hMm * PX_PER_MM) };
};

/** Bleed used for a render: only print mode on a print format bleeds. */
export const bleedFor = (f: PageFormat, mode: string): number => (mode === "print" ? formatSpec(f).bleedMm : 0);
