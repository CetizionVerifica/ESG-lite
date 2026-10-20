/**
 * DS-3 · Style presets (`GET /studio/styles?kind=`): 6–12 palette + font pairs
 * built from the brand kit, pure and deterministic (same kit → same list).
 *
 *   1. the brand's primary palette (the first palette, else the brand colours) with its fonts;
 *   2. the same palette with up to three alternative OFL pairs (fonts.ts ALT_PAIRS);
 *   3. the Classic / Light / Night looks from the brand colours;
 *   4. neutral presets (two per kind), which also pad the list to six.
 *
 * `palette` is [primary, accent, ink, surface, muted] (01-contracts §1).
 * A preset whose body text (ink on surface) is under AA_TEXT is dropped;
 * identical presets keep the first.
 */
import { AA_TEXT, type FontId, type ReportKind, type StylePreset } from "../contracts";
import { contrast, ensureContrast, luminance, normalizeHex } from "./contrast";
import { ALT_PAIRS, DEFAULT_PAIR, FONT_NAMES, samePair, type FontPair } from "./fonts";

export const STYLES_MIN = 6;
export const STYLES_MAX = 12;

export interface StyleSource {
  name: string;
  colors: { primary: string; accent: string; coverFrom: string; coverTo: string };
  fonts: { heading: FontId | null; body: FontId | null };
  /** In sort order; the first is the primary palette. */
  palettes: { name: string; colors: string[] }[];
}

type Palette = StylePreset["palette"];

const CLASSIC = { ink: "#16202e", surface: "#ffffff", muted: "#5f6b7c" };
const LIGHT = { ink: "#1f2937", surface: "#f8fafc", muted: "#64748b" };
const NIGHT = { ink: "#f1f5f9", surface: "#0d1526", muted: "#94a3b8" };

const NEUTRALS: Record<ReportKind, StylePreset[]> = {
  ghg: [
    { id: "neutral-graphite", name: "Graphite", palette: ["#1f2937", "#0f766e", "#111827", "#ffffff", "#4b5563"], fonts: { heading: "ibm-plex-serif", body: "ibm-plex-sans" } },
    { id: "neutral-paper", name: "Paper", palette: ["#334155", "#b45309", "#1e293b", "#fbfaf7", "#57534e"], fonts: { heading: "source-serif-4", body: "source-sans-3" } },
    { id: "neutral-slate", name: "Slate", palette: ["#0f172a", "#2563eb", "#0f172a", "#f1f5f9", "#475569"], fonts: { heading: "archivo", body: "ibm-plex-sans" } },
  ],
  sustainability: [
    { id: "neutral-meadow", name: "Meadow", palette: ["#166534", "#ca8a04", "#14261a", "#fbfdf8", "#4d5b50"], fonts: { heading: "fraunces", body: "source-sans-3" } },
    { id: "neutral-paper", name: "Paper", palette: ["#334155", "#b45309", "#1e293b", "#fbfaf7", "#57534e"], fonts: { heading: "source-serif-4", body: "source-sans-3" } },
    { id: "neutral-graphite", name: "Graphite", palette: ["#1f2937", "#0f766e", "#111827", "#ffffff", "#4b5563"], fonts: { heading: "ibm-plex-serif", body: "ibm-plex-sans" } },
  ],
};

/** Body text (ink on surface) is readable: ≥ 4.5:1. */
export const bodyContrastOk = (p: StylePreset): boolean => contrast(p.palette[2], p.palette[3]) >= AA_TEXT;

/** The brand's font pair; a missing half takes the default's. */
export const brandPair = (fonts: StyleSource["fonts"]): FontPair => ({ heading: fonts.heading ?? DEFAULT_PAIR.heading, body: fonts.body ?? DEFAULT_PAIR.body });

/** A palette's colours as [primary, accent, ink, surface, muted]. */
export function paletteRoles(colors: string[], fallbackAccent: string): Palette {
  const cs = colors.map(normalizeHex);
  const primary = cs[0];
  const accent = cs[1] ?? normalizeHex(fallbackAccent);
  const lightest = [...cs].sort((a, b) => luminance(b) - luminance(a))[0];
  const surface = luminance(lightest) >= 0.85 ? lightest : CLASSIC.surface;
  const darkest = [...cs].sort((a, b) => luminance(a) - luminance(b))[0];
  const ink = contrast(darkest, surface) >= AA_TEXT ? darkest : CLASSIC.ink;
  const muted = ensureContrast(CLASSIC.muted, [surface], AA_TEXT, "darken");
  return [primary, accent, ink, surface, muted];
}

/** The Classic, Light and Night looks from the brand colours. */
export function lookPalettes(colors: StyleSource["colors"]): Record<"classic" | "light" | "night", Palette> {
  const primary = normalizeHex(colors.primary);
  const accent = normalizeHex(colors.accent);
  const coverFrom = normalizeHex(colors.coverFrom);
  const nightSurface = luminance(coverFrom) <= 0.05 ? coverFrom : NIGHT.surface;
  return {
    classic: [primary, accent, CLASSIC.ink, CLASSIC.surface, CLASSIC.muted],
    light: [primary, accent, LIGHT.ink, LIGHT.surface, LIGHT.muted],
    night: [ensureContrast(primary, [nightSurface], 3, "lighten"), ensureContrast(accent, [nightSurface], 3, "lighten"), NIGHT.ink, nightSurface, NIGHT.muted],
  };
}

export function buildStyles(src: StyleSource, kind: ReportKind): StylePreset[] {
  const brandName = src.name.trim() || "Brand";
  const pair = brandPair(src.fonts);
  const primaryPalette = src.palettes[0];
  const brandPalette: Palette = primaryPalette
    ? paletteRoles(primaryPalette.colors, src.colors.accent)
    : [normalizeHex(src.colors.primary), normalizeHex(src.colors.accent), CLASSIC.ink, CLASSIC.surface, CLASSIC.muted];
  const looks = lookPalettes(src.colors);

  const candidates: StylePreset[] = [
    { id: "brand", name: `${brandName} · ${FONT_NAMES[pair.heading]}`, palette: brandPalette, fonts: pair },
    ...ALT_PAIRS.filter((p) => !samePair(p, pair))
      .slice(0, 3)
      .map((p, i) => ({ id: `brand-alt-${i + 1}`, name: `${brandName} · ${FONT_NAMES[p.heading]}`, palette: brandPalette, fonts: p })),
    { id: "look-classic", name: `Classic · ${FONT_NAMES[pair.heading]}`, palette: looks.classic, fonts: pair },
    { id: "look-light", name: `Light · ${FONT_NAMES[pair.heading]}`, palette: looks.light, fonts: pair },
    { id: "look-night", name: `Night · ${FONT_NAMES[pair.heading]}`, palette: looks.night, fonts: pair },
    ...NEUTRALS[kind].slice(0, 2),
  ];

  const seen = new Set<string>();
  const keep = (p: StylePreset) => {
    const key = JSON.stringify([p.palette, p.fonts]);
    if (seen.has(key) || !bodyContrastOk(p)) return false;
    seen.add(key);
    return true;
  };
  const out = candidates.filter(keep);
  for (const extra of NEUTRALS[kind].slice(2)) if (out.length < STYLES_MIN && keep(extra)) out.push(extra);
  return out.slice(0, STYLES_MAX);
}
