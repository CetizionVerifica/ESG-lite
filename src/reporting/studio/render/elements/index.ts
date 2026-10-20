/**
 * DS-1 · ElementType → renderer. Every type in 01-contracts §1 has one.
 */
import type { RenderContext } from "../context";
import type { ElementType, RenderElement } from "../types";
import { bigNumberElement } from "./bigNumber";
import { calloutElement } from "./callout";
import { chartElement } from "./chart";
import { kpiTileElement } from "./kpiTile";
import { frameElement, gridElement, imageElement } from "./media";
import { pageNumberElement, placeholderElement, qrElement, sdgElement } from "./misc";
import { progressElement } from "./progress";
import { dividerElement, iconElement, lineElement, shapeElement } from "./shapes";
import { tableElement } from "./table";
import { textElement } from "./text";
import type { ElementOutput, ElementRenderer } from "./types";

const RENDERERS: { [T in ElementType]: ElementRenderer<T> } = {
  text: textElement,
  kpi_tile: kpiTileElement,
  chart: chartElement,
  table: tableElement,
  image: imageElement,
  shape: shapeElement,
  icon: iconElement,
  sdg: sdgElement,
  divider: dividerElement,
  page_number: pageNumberElement,
  placeholder: placeholderElement,
  frame: frameElement,
  grid: gridElement,
  line: lineElement,
  big_number: bigNumberElement,
  progress: progressElement,
  callout: calloutElement,
  qr: qrElement,
};

export const RENDERED_ELEMENT_TYPES = Object.keys(RENDERERS) as ElementType[];

export function renderElementInner(el: RenderElement, ctx: RenderContext): ElementOutput {
  const fn = RENDERERS[el.type] as ElementRenderer<ElementType> | undefined;
  if (!fn) return { html: "", attrs: ' data-reason="UNKNOWN_ELEMENT"' };
  return fn(el as never, ctx);
}
