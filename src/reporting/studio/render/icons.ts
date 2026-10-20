/**
 * DS-1 · a small curated icon set, drawn for ESGLite (24 × 24, 2 px strokes,
 * round caps). Own drawings: no third-party glyphs. DS-4 adds a Lucide (ISC)
 * subset, named `lucide:<name>` (iconsLucide.ts, licence in
 * data/studio/LICENSES.md); unknown names render the `dot` icon so a page
 * never breaks.
 */
import { LUCIDE_ICONS } from "./iconsLucide";

export const ICONS: Record<string, string> = {
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l8-8"/>',
  bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  factory: '<path d="M3 21V10l6 4v-4l6 4V5h6v16z"/><path d="M7 17h2M12 17h2M17 17h2"/>',
  truck: '<path d="M2 6h11v10H2zM13 10h5l3 3v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  recycle: '<path d="M7 19H4l3-5M17 19h3l-3-5M9 5l3-3 3 3"/><path d="M8 14l4-7 4 7M7 19h10"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c3 0 5 2 5 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  flame: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 1 2 2 2 3 2-1-3 0-5 0-7z"/>',
  building: '<path d="M5 21V3h10v18M15 9h4v12M3 21h18"/><path d="M8 7h4M8 11h4M8 15h4"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-7"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  quote: '<path d="M5 17c0-4 1-7 5-9M14 17c0-4 1-7 5-9"/>',
  arrow_right: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
};

export const LUCIDE_PREFIX = "lucide:";
export const ICON_NAMES = [...Object.keys(ICONS), ...Object.keys(LUCIDE_ICONS).map((n) => LUCIDE_PREFIX + n)];

/** The inner SVG of an icon name: our own set, then `lucide:<name>`, else the dot. */
const iconBody = (name: string): string =>
  (Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : undefined) ??
  (name.startsWith(LUCIDE_PREFIX) && Object.prototype.hasOwnProperty.call(LUCIDE_ICONS, name.slice(LUCIDE_PREFIX.length)) ? LUCIDE_ICONS[name.slice(LUCIDE_PREFIX.length)] : undefined) ??
  ICONS.dot;

export const iconSvg = (name: string, color: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconBody(name)}</svg>`;

/**
 * UN Sustainable Development Goals: the goal colours (published values) and
 * our own short labels. The UN icons themselves are not used.
 */
export const SDG: { color: string; label: string }[] = [
  { color: "#E5243B", label: "No poverty" },
  { color: "#DDA63A", label: "Zero hunger" },
  { color: "#4C9F38", label: "Good health and well-being" },
  { color: "#C5192D", label: "Quality education" },
  { color: "#FF3A21", label: "Gender equality" },
  { color: "#26BDE2", label: "Clean water and sanitation" },
  { color: "#FCC30B", label: "Affordable and clean energy" },
  { color: "#A21942", label: "Decent work and economic growth" },
  { color: "#FD6925", label: "Industry, innovation and infrastructure" },
  { color: "#DD1367", label: "Reduced inequalities" },
  { color: "#FD9D24", label: "Sustainable cities and communities" },
  { color: "#BF8B2E", label: "Responsible consumption and production" },
  { color: "#3F7E44", label: "Climate action" },
  { color: "#0A97D9", label: "Life below water" },
  { color: "#56C02B", label: "Life on land" },
  { color: "#00689D", label: "Peace, justice and strong institutions" },
  { color: "#19486A", label: "Partnerships for the goals" },
];
