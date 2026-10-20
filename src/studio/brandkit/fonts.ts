/**
 * DS-3 · the curated OFL font set (RS R12, contracts FONT_IDS) with display
 * names, and the heading/body pairs Styles offers. Fonts are self-hosted by
 * DS-1/DS-4 (`GET /studio/fonts/:file`); this file only names them.
 */
import type { FontId } from "../contracts/enums";

export const FONT_NAMES: Record<FontId, string> = {
  "source-serif-4": "Source Serif 4",
  "source-sans-3": "Source Sans 3",
  "dm-serif-display": "DM Serif Display",
  "ibm-plex-sans": "IBM Plex Sans",
  "ibm-plex-serif": "IBM Plex Serif",
  archivo: "Archivo",
  fraunces: "Fraunces",
  "noto-sans": "Noto Sans",
};

export interface FontPair {
  heading: FontId;
  body: FontId;
}

/** The template default when a brand names no fonts. */
export const DEFAULT_PAIR: FontPair = { heading: "source-serif-4", body: "source-sans-3" };

/** Alternative pairs, in the order Styles tries them (all OFL). */
export const ALT_PAIRS: readonly FontPair[] = [
  { heading: "fraunces", body: "ibm-plex-sans" },
  { heading: "dm-serif-display", body: "source-sans-3" },
  { heading: "archivo", body: "ibm-plex-sans" },
  { heading: "ibm-plex-serif", body: "ibm-plex-sans" },
  { heading: "source-serif-4", body: "source-sans-3" },
];

export const samePair = (a: FontPair, b: FontPair) => a.heading === b.heading && a.body === b.body;
export const pairName = (p: FontPair) => FONT_NAMES[p.heading];
