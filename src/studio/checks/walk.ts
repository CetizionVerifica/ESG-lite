/**
 * DS-12 · where every binding, chip and piece of typed text of a doc sits.
 *
 *   docIndex(doc)   binding i ↔ {page, element} in the order sources/doc.ts `docBindings`
 *                   walks; token i ↔ {page, element?} in the order `collectTokens` walks;
 *                   and the typed text of each text element / callout / flow section
 *                   (chips replaced by a separator, footnote notes kept apart).
 *
 * The orders must stay exactly those of docBindings/collectTokens, because the
 * resolver answers by index (ResolveResponse.values / .tokens).
 */
import { DataTokenSchema, type Binding, type DataToken, type Element, type Page, type ReportDoc } from "../contracts";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export interface Place {
  pageId: string;
  /** Absent for a flow section's own text. */
  elementId?: string;
  /** The page (or element) is hidden: not printed, so not checked. */
  hidden: boolean;
  pageIndex: number;
}

export interface BindingPlace extends Place {
  idx: number;
  binding: Binding;
  element: Element;
}

export interface TokenPlace extends Place {
  idx: number;
  token: DataToken;
}

export interface TextBlock extends Place {
  /** Typed text, one entry per paragraph / heading / list item; chips are "⁣". */
  paragraphs: string[];
  /** Footnote notes (DS-7) in this text. */
  notes: string[];
  /** Token indexes inside this text, in order. */
  tokens: number[];
  /** The element when the text belongs to one. */
  element?: Element;
}

export interface DocIndex {
  bindings: BindingPlace[];
  tokens: TokenPlace[];
  texts: TextBlock[];
  /** Page id → index in doc.pages. */
  pageOrder: Map<string, number>;
  /** Element id → order on its page. */
  elementOrder: Map<string, number>;
}

/** Is the page printed (not hidden)? */
export const pageVisible = (p: Page): boolean => !p.hidden;

const CHIP = "⁣";

/** Walks one TextDoc (TipTap JSON): paragraphs of typed text, notes and token indexes (validated chips only). */
function walkText(root: unknown, onToken: (t: DataToken) => number): { paragraphs: string[]; notes: string[]; tokens: number[] } {
  const paragraphs: string[] = [];
  const notes: string[] = [];
  const ids: number[] = [];
  const blockText = (n: unknown): string => {
    if (!isObj(n)) return "";
    if (n.type === "data") {
      const t = DataTokenSchema.safeParse({ type: "data", attrs: n.attrs });
      if (t.success) ids.push(onToken(t.data));
      return CHIP;
    }
    if (n.type === "text") {
      if (Array.isArray(n.marks)) for (const m of n.marks) if (isObj(m) && m.type === "footnote" && isObj(m.attrs) && typeof m.attrs.note === "string") notes.push(m.attrs.note);
      return typeof n.text === "string" ? n.text : "";
    }
    if (n.type === "hardBreak") return "\n";
    return Array.isArray(n.content) ? n.content.map(blockText).join("") : "";
  };
  const walkBlocks = (n: unknown) => {
    if (!isObj(n)) return;
    if (n.type === "paragraph" || n.type === "heading") {
      paragraphs.push(blockText(n));
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walkBlocks);
  };
  walkBlocks(root);
  return { paragraphs, notes, tokens: ids };
}

export function docIndex(doc: ReportDoc): DocIndex {
  const bindings: BindingPlace[] = [];
  const tokens: TokenPlace[] = [];
  const texts: TextBlock[] = [];
  const pageOrder = new Map<string, number>();
  const elementOrder = new Map<string, number>();

  doc.pages.forEach((page, pageIndex) => {
    pageOrder.set(page.id, pageIndex);
    const pageHidden = !pageVisible(page);
    if (page.kind === "flow") {
      const place = { pageId: page.id, hidden: pageHidden, pageIndex };
      const w = walkText(page.content, (t) => {
        tokens.push({ ...place, idx: tokens.length, token: t });
        return tokens.length - 1;
      });
      if (page.content) texts.push({ ...place, ...w });
      return;
    }
    page.elements.forEach((e, i) => {
      elementOrder.set(e.id, i);
      const place = { pageId: page.id, elementId: e.id, hidden: pageHidden || !!e.hidden, pageIndex };
      const props = e.props as Json;
      if (isObj(props.binding)) bindings.push({ ...place, idx: bindings.length, binding: props.binding as Binding, element: e });
      if (isObj(props.doc)) {
        const w = walkText(props.doc, (t) => {
          tokens.push({ ...place, idx: tokens.length, token: t });
          return tokens.length - 1;
        });
        texts.push({ ...place, ...w, element: e });
      }
    });
  });
  return { bindings, tokens, texts, pageOrder, elementOrder };
}

/** Every visible element of the doc with its page. */
export function visibleElements(doc: ReportDoc): Array<{ pageId: string; pageIndex: number; element: Element }> {
  const out: Array<{ pageId: string; pageIndex: number; element: Element }> = [];
  doc.pages.forEach((p, pageIndex) => {
    if (p.kind !== "freeform" || !pageVisible(p)) return;
    for (const e of p.elements) if (!e.hidden) out.push({ pageId: p.id, pageIndex, element: e });
  });
  return out;
}

/** All typed words of the visible doc (text, notes, chart titles and captions, tile labels), lower-cased. */
export function visibleCorpus(doc: ReportDoc, ix: DocIndex): string {
  const parts: string[] = [];
  for (const t of ix.texts) if (!t.hidden) parts.push(...t.paragraphs, ...t.notes);
  for (const { element: e } of visibleElements(doc)) {
    const p = e.props as Json;
    for (const k of ["title", "subtitle", "caption", "label", "hint"]) if (typeof p[k] === "string") parts.push(p[k] as string);
  }
  for (const page of doc.pages) if (pageVisible(page)) parts.push(page.name, page.kind === "flow" ? page.bookmark ?? "" : page.bookmark ?? "");
  return parts.join("\n").replace(/⁣/g, " ").toLowerCase();
}
