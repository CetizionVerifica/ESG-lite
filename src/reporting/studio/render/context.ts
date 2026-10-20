/**
 * DS-1 · what every element and flow renderer receives.
 */
import type { FormatSpec } from "./formats";
import type { Theme } from "./theme";
import type { RenderAssets, RenderData, RenderDoc, RenderMode } from "./types";

export interface RenderContext {
  doc: Pick<RenderDoc, "kind" | "format" | "meta" | "assets">;
  data: RenderData;
  theme: Theme;
  format: FormatSpec;
  mode: RenderMode;
  assets: RenderAssets;
  /** 1-based index of the page among visible pages (sheet page numbers). */
  pageNo: number;
  pageCount: number;
  /** Visible pages in print order (toc). */
  pages: { id: string; name: string; bookmark?: string; kind: "freeform" | "flow" }[];
  /** DS-7: the number of the first footnote in the text being rendered (footnotes.ts). */
  footnoteBase?: number;
}

export const assetUrl = (ctx: RenderContext, id: string | undefined): string | null => (id ? (ctx.assets.urls[id] ?? null) : null);
