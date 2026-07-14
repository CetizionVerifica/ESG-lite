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
      /** "fullbleed" (branded gradient) or "document" (white, two-column + hero). */
      style?: "fullbleed" | "document";
      title: string;
      subtitle?: string;
      /** Small muted line under the subtitle (document style). */
      caption?: string;
      /** Bottom meta row (fullbleed style). */
      meta?: { label: string; value: string }[];
      /** Navy stacked info cards (document style). */
      infoCards?: { label: string; value: string }[];
      /** Hero image URL/data-URL (document style). Omit → procedural brand art. */
      hero?: string;
    }
  | { type: "section"; title: string; kicker?: string }
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
    }
  | {
      type: "table";
      title?: string;
      columns: string[];
      rows: (string | number)[][];
      align?: Align[];
      caption?: string;
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
    };

export interface Report {
  client: string;
  slug: string;
  /** Text shown in the running page header */
  docTitle?: string;
  blocks: Block[];
}
