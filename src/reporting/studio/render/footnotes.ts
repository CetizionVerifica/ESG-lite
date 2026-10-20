/**
 * DS-7 · footnotes. A `footnote` mark (attrs.note) on text gives that run a
 * superscript number; the notes print at the foot of the page (free-form
 * pages) or at the end of the section (flow sections).
 *
 * Numbering (one rule, used by the renderer and by the editor):
 *   - a run is consecutive text with a footnote mark of the same note inside
 *     one block (paragraph, heading); data chips in between don't break it;
 *     each run gets the next number, so the same note twice is two numbers;
 *   - free-form pages number per page in reading order: visible text and
 *     callout elements top to bottom, then left to right (a move renumbers);
 *   - flow sections number per section, in text order.
 */
import type { DataTokenNode, RenderFlowSection, RenderFreeformPage, TextDoc, TextNode } from "./types";

type Inline = TextNode | DataTokenNode;

/** The note of a text node's footnote mark, or null. */
export function footnoteOf(n: Inline | undefined): string | null {
  if (!n || n.type !== "text") return null;
  const m = (n as TextNode).marks?.find((x) => x.type === "footnote");
  const note = m?.attrs?.note;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

/**
 * True when the text node at `i` ends a footnote run: no later text node in the
 * same block (skipping data chips) carries the same note.
 */
export function endsFootnoteRun(nodes: Inline[], i: number): boolean {
  const note = footnoteOf(nodes[i]);
  if (!note) return false;
  for (let j = i + 1; j < nodes.length; j++) {
    const n = nodes[j];
    if (n.type === "data") continue;
    return footnoteOf(n) !== note;
  }
  return true;
}

/** Every footnote run's note in a TextDoc, in text order. */
export function footnoteNotes(doc: TextDoc | undefined): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[] | undefined) => {
    const list = nodes ?? [];
    list.forEach((n, i) => {
      if (n.type === "data") return;
      if (n.type === "text") {
        if (endsFootnoteRun(list, i)) out.push(footnoteOf(n) as string);
        return;
      }
      walk((n as TextNode).content);
    });
  };
  walk(doc?.content);
  return out;
}

type TextLike = { id: string; type: string; hidden?: boolean; frame: { x: number; y: number }; props: unknown };

const docOfElement = (el: TextLike): TextDoc | undefined => (el.type === "text" || el.type === "callout" ? (el.props as { doc?: TextDoc }).doc : undefined);

/** Visible text and callout elements of a page in reading order (top to bottom, then left to right). */
export function readingOrder<E extends TextLike>(elements: E[]): E[] {
  return elements
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.hidden && !!docOfElement(e))
    .sort((a, b) => a.e.frame.y - b.e.frame.y || a.e.frame.x - b.e.frame.x || a.i - b.i)
    .map(({ e }) => e);
}

export interface PageFootnotes {
  /** Element id → the number of its first footnote (only elements with footnotes). */
  bases: Record<string, number>;
  /** The notes in number order (notes[0] is number 1). */
  notes: string[];
}

/** A free-form page's footnotes: the first number of each element, and every note in order. */
export function pageFootnotes(page: Pick<RenderFreeformPage, "elements">): PageFootnotes {
  const bases: Record<string, number> = {};
  const notes: string[] = [];
  for (const el of readingOrder(page.elements as unknown as TextLike[])) {
    const own = footnoteNotes(docOfElement(el));
    if (!own.length) continue;
    bases[el.id] = notes.length + 1;
    notes.push(...own);
  }
  return { bases, notes };
}

/** A flow section's footnotes, in text order. */
export const sectionFootnotes = (section: Pick<RenderFlowSection, "content">): string[] => footnoteNotes(section.content);
