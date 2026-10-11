// Shared types: the Theme (per-client brand tokens) and the Report structure.
// The LLM (later milestone) will emit a Report matching this shape; it never writes HTML.

export interface Theme {
  id: string;
  name: string;
  /** Raw <svg> markup, injected at runtime from clients/<id>/logo.svg */
  logoSvg?: string;
  page: { size: string; margin: string };
  colors: {
    primary: string;
    accent: string;
    ink: string;
    muted: string;
    surface: string;
    border: string;
    onPrimary: string;
    coverBgFrom: string;
    coverBgTo: string;
  };
  chartPalette: string[];
  fonts: { heading: string; body: string };
  footer: string;
  /** Optional: Gamma workspace theme id, used only by the Gamma API backend. */
  gammaThemeId?: string;
  /** Optional: public https URL of the logo, for Gamma card header/footer. */
  logoUrl?: string;
}

export type Align = "left" | "right" | "center";

export type Block =
  | {
      type: "cover";
      /** "fullbleed" (branded gradient), "document" (white, two-column + hero) or
       * "band" (logo on white over a brand-colour band carrying the headline figure). */
      style?: "fullbleed" | "document" | "band";
      /** Band style: small label above the band (e.g. the report type). */
      kicker?: string;
      /** Band style: line above the title (e.g. the reporting period). */
      eyebrow?: string;
      /** Band style: the headline figure, its unit and an optional change pill. */
      hero?: { value: string; unit: string; delta?: string };
      title: string;
      subtitle?: string;
      /** Small muted line under the subtitle (document style). */
      caption?: string;
      /** Bottom meta row (fullbleed style). */
      meta?: { label: string; value: string }[];
      /** Navy stacked info cards (document style). */
      infoCards?: { label: string; value: string }[];
      /** Hero image URL/data-URL (document style). Omit → procedural brand art. */
      heroImage?: string;
    }
  | {
      type: "section";
      /** The page's headline: states the finding, not just the topic. */
      title: string;
      /** Small label above the title, e.g. "02 · Executive summary". */
      kicker?: string;
      /** flow onto the current page instead of forcing a page break (for sub-sections) */
      flow?: boolean;
    }
  | {
      type: "kpiTiles";
      title?: string;
      tiles: {
        label: string;
        value: string;
        unit?: string;
        delta?: string;
        positive?: boolean;
      }[];
    }
  | { type: "narrative"; title?: string; body: string[] }
  | {
      type: "chart";
      title?: string;
      subtitle?: string;
      chartType: "bar" | "line" | "pie";
      unit?: string;
      categories?: string[];
      series: { name: string; data: number[] }[];
      caption?: string;
      /** Bar only: draw bars horizontally so long category names read in full. */
      horizontal?: boolean;
      /** Horizontal single-series bars: append each bar's share of the total to its value label. */
      showShare?: boolean;
      /** Unrounded total for the donut centre / share labels (defaults to the sum of the data). */
      total?: number;
    }
  | {
      type: "table";
      title?: string;
      columns: string[];
      rows: Cell[][];
      align?: Align[];
      caption?: string;
      /** Small muted text after the column title, e.g. the unit. */
      subtitle?: string;
      /** Style the last row as a totals row (bold, ruled above). */
      totalRow?: boolean;
    }
  | {
      type: "callout";
      variant?: "info" | "success" | "warning";
      title: string;
      body: string;
    }
  | {
      type: "image";
      /** Vivid description for an AI image (no text/charts/logos). */
      prompt: string;
      caption?: string;
      layout?: "full" | "banner";
      /** Data URL, filled in at generation time by the server. */
      src?: string;
    }
  | {
      type: "statBoard";
      /** Small pill label, e.g. "EXECUTIVE DASHBOARD". */
      badge?: string;
      title?: string;
      /** Big headline metrics with a caption each. */
      kpis: { value: string; label: string; sub?: string }[];
      /** Dark stat tiles across the bottom. */
      tiles?: { label: string; value: string }[];
    }
  | {
      type: "kpiRow";
      /** Headline figures under a rule; `swatch` is a colour chip before the label. */
      tiles: { label: string; value: string; sub?: string; swatch?: string }[];
    }
  | {
      /** Ranked horizontal bars drawn as SVG, each labelled with its value (and share). */
      type: "hbar";
      title?: string;
      subtitle?: string;
      rows: { label: string; value: number; color?: string }[];
      color?: string;
      unit?: string;
      /** Shares are computed against this (defaults to the sum of the rows). */
      total?: number;
      showShare?: boolean;
      caption?: string;
    }
  | {
      /** One 100% stacked bar with each part labelled above it (part-of-whole). */
      type: "shareBar";
      title?: string;
      subtitle?: string;
      parts: { label: string; value: number; color: string }[];
      unit?: string;
      caption?: string;
    }
  | {
      /** Horizontal stacked bars: one row per item, one segment per series. */
      type: "stackedBars";
      title?: string;
      subtitle?: string;
      series: { name: string; color: string }[];
      rows: { label: string; values: number[] }[];
      unit?: string;
      /** Each row's share is computed against this (defaults to the sum of all rows). */
      total?: number;
      caption?: string;
    }
  | {
      /** A scope (or other group) heading with its colour chip, total and a ranked bar chart. */
      type: "groupBars";
      name: string;
      color: string;
      subtitle?: string;
      total: string;
      rows: { label: string; value: number }[];
      unit?: string;
      caption?: string;
    }
  | { type: "figures"; items: { value: string; text: string }[] }
  | { type: "bullets"; title?: string; items: { lead?: string; text: string }[] }
  | { type: "notes"; items: { heading: string; body: string }[] }
  | { type: "paragraph"; body: string };

/** A table cell: plain text, or text shown as a fixed-colour status pill. */
export type Cell = string | number | { text: string; pill: "ok" | "warn" | "high" | "medium" };

export interface Report {
  client: string;
  slug: string;
  /** Text shown in the running page header */
  docTitle?: string;
  /** Left side of the running header (defaults to the theme name). */
  runningLeft?: string;
  /** Running footer line (defaults to the theme footer). */
  runningFooter?: string;
  blocks: Block[];
}
