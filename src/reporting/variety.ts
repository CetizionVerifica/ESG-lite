// Variety layer: makes every report look freshly designed while staying on-brand.
// A per-report numeric seed drives a deterministic RNG that (a) picks layout
// variants and (b) generates procedural brand artwork (mesh / geometric cover
// backgrounds) in the client's palette. Same seed → same look (reproducible);
// new seed → new look. Brand colors/fonts/logo never change — only layout and
// artwork do.

import type { Theme } from "./types";

export type CoverVariant = "gradient" | "mesh" | "geo";
export type KpiStyle = "row" | "grid";
export type SectionStyle = "plain" | "band";

export interface Variety {
  seed: number;
  coverVariant: CoverVariant;
  coverBgSvg: string | null;
  /** AI-generated hero image (data URL); when set it wins over coverBgSvg. */
  heroImage: string | null;
  /** Procedural brand art for the document-cover hero panel (always present). */
  heroPanelSvg: string;
  /** Document cover: two-column split vs dramatic full-bleed hero. */
  docCoverMode: "split" | "fullbleed";
  kpiStyle: KpiStyle;
  sectionStyle: SectionStyle;
}

/* deterministic RNG (mulberry32) */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Public seeded RNG factory (deterministic, mulberry32). */
export function makeRng(seed: number): () => number {
  return mulberry32(seed >>> 0);
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T>(arr: readonly T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];

/** Soft "aurora/mesh" background: blurred brand-colored blobs over a gradient. */
function meshSvg(theme: Theme, rng: () => number): string {
  const pal = [theme.colors.accent, ...theme.chartPalette];
  const blobs: string[] = [];
  const count = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const cx = (rng() * 100).toFixed(1);
    const cy = (rng() * 141).toFixed(1);
    const r = (20 + rng() * 30).toFixed(1);
    const fill = pick(pal, rng());
    const op = (0.35 + rng() * 0.4).toFixed(2);
    blobs.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${op}"/>`);
  }
  return `<svg viewBox="0 0 100 141" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.colors.coverBgFrom}"/>
      <stop offset="1" stop-color="${theme.colors.coverBgTo}"/>
    </linearGradient>
    <filter id="cb" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <rect width="100" height="141" fill="url(#cg)"/>
  <g filter="url(#cb)">${blobs.join("")}</g>
</svg>`;
}

/** Restrained geometric scatter: faint rings and dots over a gradient. */
function geoSvg(theme: Theme, rng: () => number): string {
  const on = theme.colors.onPrimary;
  const acc = theme.colors.accent;
  const shapes: string[] = [];
  const count = 14 + Math.floor(rng() * 8);
  for (let i = 0; i < count; i++) {
    const cx = (rng() * 100).toFixed(1);
    const cy = (rng() * 141).toFixed(1);
    const r = (2 + rng() * 7).toFixed(1);
    if (rng() < 0.5) {
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${on}" stroke-width="0.5" opacity="0.14"/>`);
    } else {
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${(Number(r) * 0.5).toFixed(1)}" fill="${acc}" opacity="0.16"/>`);
    }
  }
  return `<svg viewBox="0 0 100 141" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.colors.coverBgFrom}"/>
      <stop offset="1" stop-color="${theme.colors.coverBgTo}"/>
    </linearGradient>
  </defs>
  <rect width="100" height="141" fill="url(#cg)"/>
  ${shapes.join("")}
</svg>`;
}

export function buildVariety(theme: Theme, seed: number, heroImage: string | null = null): Variety {
  const rng = mulberry32(seed >>> 0);
  const coverVariant = pick<CoverVariant>(["gradient", "mesh", "geo"], rng());
  const coverBgSvg =
    coverVariant === "mesh" ? meshSvg(theme, rng) : coverVariant === "geo" ? geoSvg(theme, rng) : null;
  const heroPanelSvg = meshSvg(theme, rng);
  return {
    seed,
    coverVariant,
    coverBgSvg,
    heroImage,
    heroPanelSvg,
    docCoverMode: rng() < 0.5 ? "split" : "fullbleed",
    kpiStyle: rng() < 0.5 ? "row" : "grid",
    sectionStyle: rng() < 0.5 ? "plain" : "band",
  };
}
