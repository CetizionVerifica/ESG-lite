/**
 * DS-1 · one renderer per ElementType. Each returns the element's inner HTML
 * and any extra attributes for its wrapper (data marks); sheet.ts positions
 * the wrapper in mm.
 */
import type { RenderContext } from "../context";
import type { ElementOf, ElementType } from "../types";

export interface ElementOutput {
  html: string;
  /** Extra attributes for the wrapper, each starting with a space. */
  attrs?: string;
  /** Extra classes for the wrapper. */
  cls?: string;
}

export type ElementRenderer<T extends ElementType> = (el: ElementOf<T>, ctx: RenderContext) => ElementOutput;
