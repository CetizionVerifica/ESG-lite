/**
 * DS-1 · type scale for the nine TextStyleIds. Sizes are in pt and scale with
 * the format (a slide reads at a distance; an A5 page is held close).
 */
import type { PageFormat, TextStyleId } from "./types";

export interface TextStyle {
  font: "heading" | "body";
  sizePt: number;
  weight: number;
  leading: number;
  tracking: number;
  upper?: boolean;
  italic?: boolean;
  color?: "ink" | "muted" | "primary" | "accent";
}

export const TEXT_STYLES: Record<TextStyleId, TextStyle> = {
  kicker: { font: "body", sizePt: 8.5, weight: 700, leading: 1.3, tracking: 0.12, upper: true, color: "accent" },
  title: { font: "heading", sizePt: 34, weight: 600, leading: 1.06, tracking: -0.01 },
  heading: { font: "heading", sizePt: 20, weight: 600, leading: 1.15, tracking: 0 },
  subheading: { font: "heading", sizePt: 13, weight: 600, leading: 1.25, tracking: 0 },
  body: { font: "body", sizePt: 10, weight: 400, leading: 1.45, tracking: 0 },
  caption: { font: "body", sizePt: 8, weight: 400, leading: 1.35, tracking: 0, color: "muted" },
  big_number: { font: "heading", sizePt: 40, weight: 600, leading: 1, tracking: -0.01, color: "primary" },
  quote: { font: "heading", sizePt: 16, weight: 400, leading: 1.35, tracking: 0, italic: true },
  footnote: { font: "body", sizePt: 7, weight: 400, leading: 1.3, tracking: 0, color: "muted" },
};

/** Type scale per format. Paper formats are 1; slides and social cards are larger. */
export const FORMAT_TYPE_SCALE: Record<PageFormat, number> = {
  a4: 1,
  a4_landscape: 1,
  letter: 1,
  a5: 0.9,
  slide_16_9: 1.5,
  square: 1.6,
  social_191: 1.5,
};

/** CSS classes for every style (`.ts-<id>`), for a format. */
export function textStyleCss(format: PageFormat): string {
  const k = FORMAT_TYPE_SCALE[format] ?? 1;
  return (Object.keys(TEXT_STYLES) as TextStyleId[])
    .map((id) => {
      const s = TEXT_STYLES[id];
      const size = Math.round(s.sizePt * k * 10) / 10;
      return (
        `.ts-${id}{font-family:var(--font-${s.font});font-size:${size}pt;font-weight:${s.weight};line-height:${s.leading};` +
        `letter-spacing:${s.tracking}em;${s.upper ? "text-transform:uppercase;" : ""}${s.italic ? "font-style:italic;" : ""}` +
        `${s.color ? `color:var(--${s.color});` : ""}}`
      );
    })
    .join("\n");
}
