/**
 * DS-10 · the AI summary hook of Resize (`POST /docs/:id/resize` with `ai: true`).
 * DS-9 registers its summariser here (one call at module load, `// DS-9`),
 * running `summarise_for_deck` / `summarise_for_social` per text slot. Until
 * then, and whenever the hook throws, text is cut to the slot with an ellipsis
 * (TEXT_TRUNCATED, info) and the copy's build notes say so.
 *
 * The hook gets the text that doesn't fit (plain text with chips as
 * "[number]", the original TipTap doc and the slot's length) and returns a
 * TipTap doc per element id. Numbers stay data chips (01-contracts §8): the
 * server keeps only text and `data` chips that were in the original. The copy
 * stores the result with `source: 'ai'` and no `reviewed` flag, so
 * AI_UNREVIEWED lists it until a person ticks it reviewed or edits it.
 */
import type { StudioCaller } from "../guard";

export interface ResizeSummaryItem {
  elementId: string;
  action: "summarise_for_deck" | "summarise_for_social";
  maxChars: number;
  text: string;
  doc: Record<string, unknown>;
}

export interface ResizeSummaryInput {
  caller: StudioCaller;
  sourceDocId: number;
  kind: string;
  items: ResizeSummaryItem[];
}

/** element id → the summary doc; ids left out keep the cut text. */
export type ResizeSummaryHook = (input: ResizeSummaryInput) => Promise<Record<string, Record<string, unknown>>>;

let hook: ResizeSummaryHook | null = null;

export function registerResizeSummaryHook(fn: ResizeSummaryHook | null): void {
  hook = fn;
}
export const resizeSummaryHook = (): ResizeSummaryHook | null => hook;
