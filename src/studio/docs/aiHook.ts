/**
 * DS-5 · the AI drafting hook of the auto-build (`POST /docs` with `ai: true`).
 * DS-9 registers its drafter here (one call at module load, `// DS-9`); until
 * then the build keeps the template's default text and says so in its steps.
 *
 * The hook gets the built doc (placeholders filled, data resolved) and returns
 * the doc to store. It must only change text the template marked as draftable,
 * mark what it wrote `source: 'ai'` (unreviewed), and never type numbers
 * (01-contracts §8). A hook that throws leaves the template text (the build
 * notes "AI wasn't available; template text kept").
 */
import type { StudioCaller } from "../guard";

export interface AiDraftInput {
  caller: StudioCaller;
  docId: number;
  doc: Record<string, unknown>;
  dataHash: string;
}
export type AiDraftHook = (input: AiDraftInput) => Promise<{ doc: Record<string, unknown>; note?: string }>;

let hook: AiDraftHook | null = null;

export function registerAiDraftHook(fn: AiDraftHook | null): void {
  hook = fn;
}
export const aiDraftHook = (): AiDraftHook | null => hook;
