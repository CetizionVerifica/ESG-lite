/**
 * DS-1 · theme: Look defaults → Brand → Style preset → doc overrides, as CSS
 * variables. Elements read colours and fonts only through these variables
 * (layer rule 6). Contrast helpers are shared with the LOW_CONTRAST check.
 */
import { fontStack, isFontId } from "./fonts";
import type { FontId, Look, RenderBrand, RenderStyle, ThemeOverrides } from "./types";
import { hex } from "./util";

export interface Theme {
  look: Look;
  colors: {
    primary: string;
    accent: string;
    ink: string;
    muted: string;
    surface: string;
    /** The page colour. */
    paper: string;
    border: string;
    onPrimary: string;
    coverFrom: string;
    coverTo: string;
    good: string;
    bad: string;
    /** Prior years in charts. */
    prior: string;
    s1: string;
    s2: string;
    s3: string;
  };
  /** Chart series colours, brand first. */
  series: string[];
  fonts: { heading: FontId; body: FontId };
}

const LOOKS: Record<Look, Omit<Theme, "fonts" | "series" | "look">> = {
  classic: {
    colors: {
      primary: "#0F5132",
      accent: "#2F6FB0",
      ink: "#101828",
      muted: "#5B6475",
      surface: "#F4F6F8",
      paper: "#FFFFFF",
      border: "#DDE2E8",
      onPrimary: "#FFFFFF",
      coverFrom: "#0B3B25",
      coverTo: "#0F5132",
      good: "#13795B",
      bad: "#B42318",
      prior: "#B8C0CC",
      s1: "#1F6FEB",
      s2: "#0EA5A4",
      s3: "#8B5CF6",
    },
  },
  light: {
    colors: {
      primary: "#1D4ED8",
      // Amber 700: 5.0:1 on the paper (4.8:1 on the surface), so kicker text passes LOW_CONTRAST (was #F59E0B, 2.1:1).
      accent: "#B45309",
      ink: "#1F2937",
      muted: "#6B7280",
      surface: "#F8FAFC",
      paper: "#FFFFFF",
      border: "#E5E7EB",
      onPrimary: "#FFFFFF",
      coverFrom: "#EEF2FF",
      coverTo: "#FFFFFF",
      good: "#15803D",
      bad: "#B91C1C",
      prior: "#CBD5E1",
      s1: "#2563EB",
      s2: "#14B8A6",
      s3: "#A855F7",
    },
  },
  night: {
    colors: {
      primary: "#7DD3FC",
      accent: "#FBBF24",
      ink: "#F1F5F9",
      muted: "#A3AEC2",
      surface: "#1E293B",
      paper: "#0F172A",
      border: "#334155",
      onPrimary: "#0F172A",
      coverFrom: "#020617",
      coverTo: "#0F172A",
      good: "#4ADE80",
      bad: "#F87171",
      prior: "#475569",
      s1: "#60A5FA",
      s2: "#2DD4BF",
      s3: "#C084FC",
    },
  },
};

const DEFAULT_FONTS: Record<Look, { heading: FontId; body: FontId }> = {
  classic: { heading: "source-serif-4", body: "source-sans-3" },
  light: { heading: "archivo", body: "ibm-plex-sans" },
  night: { heading: "fraunces", body: "ibm-plex-sans" },
};

const lookOf = (v: unknown): Look | null => (v === "classic" || v === "light" || v === "night" ? v : null);

/** The theme a doc renders with. Later sources win: look → brand → style → doc overrides. */
export function buildTheme(overrides: ThemeOverrides | undefined, brand?: RenderBrand | null, style?: RenderStyle | null): Theme {
  const look = lookOf(overrides?.look) ?? lookOf(brand?.look) ?? "classic";
  const c = { ...LOOKS[look].colors };
  const fonts = { ...DEFAULT_FONTS[look] };
  if (brand) {
    if (hex(brand.primary)) c.primary = brand.primary as string;
    if (hex(brand.accent)) c.accent = brand.accent as string;
    if (isFontId(brand.fontHeading)) fonts.heading = brand.fontHeading;
    if (isFontId(brand.fontBody)) fonts.body = brand.fontBody;
  }
  if (style) {
    const [primary, accent, ink, surface, muted] = style.palette;
    if (hex(primary)) c.primary = primary;
    if (hex(accent)) c.accent = accent;
    if (hex(ink) && look !== "night") c.ink = ink;
    if (hex(surface) && look !== "night") c.surface = surface;
    if (hex(muted) && look !== "night") c.muted = muted;
    if (isFontId(style.fonts.heading)) fonts.heading = style.fonts.heading;
    if (isFontId(style.fonts.body)) fonts.body = style.fonts.body;
  }
  const o = overrides?.colors ?? {};
  for (const k of ["primary", "accent", "ink", "muted", "surface", "coverFrom", "coverTo"] as const) {
    const v = hex(o[k]);
    if (v) c[k] = v;
  }
  if (!hex(o.coverTo) && look !== "light") c.coverTo = c.primary;
  if (!hex(o.coverFrom) && look === "classic") c.coverFrom = mix(c.primary, "#000000", 0.35);
  const of = overrides?.fonts;
  if (isFontId(of?.heading)) fonts.heading = of.heading;
  if (isFontId(of?.body)) fonts.body = of.body;
  c.onPrimary = contrastRatio(c.primary, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#0F172A";
  const series = [c.primary, c.accent, mix(c.primary, c.paper, 0.45), mix(c.accent, c.paper, 0.45), c.s3, c.s2];
  return { look, colors: c, series, fonts };
}

/** CSS custom properties for a theme, scoped to `selector`. */
export function themeCss(t: Theme, selector = ":root,:host,.ds-doc"): string {
  const vars = Object.entries(t.colors)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
  const series = t.series.map((v, i) => `--series-${i}:${v};`).join("");
  return `${selector}{${vars}${series}--font-heading:${fontStack(t.fonts.heading)};--font-body:${fontStack(t.fonts.body)};}`;
}

// ---------------------------------------------------------------------------
// Colour helpers (shared with the LOW_CONTRAST check, DS-12)
// ---------------------------------------------------------------------------

const rgb = (h: string): [number, number, number] => {
  const v = hex(h) ?? "#000000";
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
};
const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** `a` blended towards `b` by `t` (0 = a, 1 = b). */
export const mix = (a: string, b: string, t: number): string => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
};

/** WCAG relative luminance. */
export const luminance = (h: string): number => {
  const [r, g, b] = rgb(h).map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, 1–21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** A tint of `c` for callout backgrounds. */
export const tint = (c: string, paper: string, amount = 0.88): string => mix(c, paper, amount);
