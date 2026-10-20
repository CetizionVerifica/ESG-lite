/**
 * DS-3 · colour maths for the brand kit: a port of the FE theme engine's
 * `src/theme/color.ts` (ESG-lite_FE) — hex parsing, sRGB mixing, WCAG 2.x
 * relative luminance and contrast, `ensureContrast` — with the same rules
 * (AA_TEXT 4.5:1 for text, AA_UI 3:1 for graphics; contracts/brandkit.ts).
 * Pure functions on 6-digit hex strings.
 */
import { AA_TEXT, AA_UI, type PaletteContrast } from "../contracts/brandkit";

type Rgb = [number, number, number];

export const WHITE = "#ffffff";
export const BLACK = "#000000";

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb): string =>
  "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");

/** Any accepted hex form → lowercase "#rrggbb". */
export const normalizeHex = (hex: string): string => toHex(parseHex(hex));

/** Linear mix in sRGB: t = 0 returns `a`, t = 1 returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Moves `color` toward black ("darken") or white ("lighten") in 5 % steps until
 * it reaches `min` contrast against every background; the end of the walk if
 * none passes (as color.ts).
 */
export function ensureContrast(color: string, backgrounds: string[], min: number, direction: "darken" | "lighten"): string {
  const target = direction === "darken" ? BLACK : WHITE;
  const passes = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= min);
  for (let step = 0; step <= 20; step++) {
    const candidate = step === 0 ? normalizeHex(color) : mix(color, target, step * 0.05);
    if (passes(candidate)) return candidate;
  }
  return target;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One pair's report. */
export const pairContrast = (a: string, b: string): PaletteContrast => {
  const ratio = contrast(a, b);
  return { a: normalizeHex(a), b: normalizeHex(b), ratio: round2(ratio), text: ratio >= AA_TEXT, graphic: ratio >= AA_UI };
};

/** Every pair of a palette's colours, in palette order (i < j). */
export function paletteContrast(colors: string[]): PaletteContrast[] {
  const out: PaletteContrast[] = [];
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) out.push(pairContrast(colors[i], colors[j]));
  return out;
}
