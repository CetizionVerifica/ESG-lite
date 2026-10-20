/**
 * DS-1 · the bundled OFL faces (R12) as data: FontId → family, fallback stack
 * and the WOFF2 files the API serves at GET /studio/fonts/:file. Pure: no file
 * access here (html.ts inlines, the fonts route streams).
 */
import type { FontId } from "./types";

export interface FontFace {
  family: string;
  /** Generic fallback (only reached for glyphs the subset lacks). */
  generic: "serif" | "sans-serif";
  /** Weights shipped, each as `<id>-<weight>.woff2`. */
  weights: number[];
}

export const FONTS: Record<FontId, FontFace> = {
  "source-serif-4": { family: "Source Serif 4", generic: "serif", weights: [400, 600, 700] },
  "source-sans-3": { family: "Source Sans 3", generic: "sans-serif", weights: [400, 600, 700] },
  "dm-serif-display": { family: "DM Serif Display", generic: "serif", weights: [400] },
  "ibm-plex-sans": { family: "IBM Plex Sans", generic: "sans-serif", weights: [400, 600, 700] },
  "ibm-plex-serif": { family: "IBM Plex Serif", generic: "serif", weights: [400, 600, 700] },
  archivo: { family: "Archivo", generic: "sans-serif", weights: [400, 600, 700] },
  fraunces: { family: "Fraunces", generic: "serif", weights: [400, 600, 700] },
  "noto-sans": { family: "Noto Sans", generic: "sans-serif", weights: [400, 600, 700] },
};

export const FONT_IDS = Object.keys(FONTS) as FontId[];
export const isFontId = (v: unknown): v is FontId => typeof v === "string" && v in FONTS;

/** The file name the fonts route serves for a face and weight. */
export const fontFile = (id: FontId, weight: number): string => `${id}-${weight}.woff2`;

/** Every font file name (the route's allow-list). */
export const FONT_FILES: string[] = FONT_IDS.flatMap((id) => FONTS[id].weights.map((w) => fontFile(id, w)));

/** CSS font-family stack: the face, then Noto Sans for missing glyphs, then the generic. */
export const fontStack = (id: FontId): string => {
  const f = FONTS[id] ?? FONTS["source-sans-3"];
  return id === "noto-sans" ? `"${f.family}", ${f.generic}` : `"${f.family}", "Noto Sans", ${f.generic}`;
};

/** @font-face rules for the given faces, with `url(base + file)`. Weights a face lacks are synthesised by the browser from the nearest. */
export const fontFaceCss = (ids: FontId[], base: string): string => {
  const seen = new Set<FontId>();
  const out: string[] = [];
  for (const id of [...ids, "noto-sans" as FontId]) {
    if (seen.has(id) || !FONTS[id]) continue;
    seen.add(id);
    for (const w of FONTS[id].weights) {
      out.push(`@font-face{font-family:"${FONTS[id].family}";font-style:normal;font-weight:${w};font-display:block;src:url("${base}${fontFile(id, w)}") format("woff2");}`);
    }
  }
  return out.join("\n");
};
