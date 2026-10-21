/**
 * DS-1 · TextDoc (TipTap JSON) → HTML. Only the nodes and marks of
 * 01-contracts §2 render; anything else keeps its text and loses its markup.
 * Data chips print the resolved `display` (never a number the renderer
 * formats), or "Not reported" with the reason.
 */
import type { RenderContext } from "./context";
import { NOT_REPORTED, bindingHash, notReported, tokenKey, unavailableReason } from "./data";
import { endsFootnoteRun } from "./footnotes";
import type { DataTokenNode, TextDoc, TextNode } from "./types";
import { esc, hex, safeHref } from "./util";

const isToken = (n: TextNode | DataTokenNode): n is DataTokenNode => n.type === "data";

function chip(node: DataTokenNode, ctx: RenderContext): string {
  const a = node.attrs;
  const v = ctx.data.tokens[tokenKey(a)] ?? null;
  const src = esc(a.binding?.source ?? "kpi");
  const hash = a.binding ? bindingHash(a.binding) : "";
  const reason = unavailableReason(v);
  if (reason || !v) return `<span class="ds-chip ds-chip--nr" data-source="${src}" data-binding-hash="${hash}" data-measure="${esc(a.measure)}">${notReported(reason ?? "NOT_RESOLVED")}</span>`;
  return `<span class="ds-chip" data-source="${src}" data-binding-hash="${hash}" data-measure="${esc(a.measure)}">${esc(v.display)}</span>`;
}

function marks(text: string, node: TextNode): string {
  let out = esc(text);
  for (const m of node.marks ?? []) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "highlight") {
      const c = hex(m.attrs?.color);
      out = `<mark${c ? ` style="background:${c}"` : ""}>${out}</mark>`;
    } else if (m.type === "link") {
      const href = safeHref(m.attrs?.href);
      if (href) out = `<a href="${esc(href)}">${out}</a>`;
    }
  }
  return out;
}

/** DS-7: the running footnote number while one TextDoc renders. */
interface FnState {
  next: number;
  /** PE-2: an opening tag wrapped around each block's inline content (highlight runs). */
  wrap?: string;
}

/** PE-2: wraps a block's inline HTML in the highlight run when one is asked for. */
const wrapped = (html: string, fn: FnState): string => (fn.wrap && html ? `${fn.wrap}${html}</span>` : html);

/** DS-7: the superscript after the last text of a footnote run. */
const footnoteRef = (n: number): string => `<sup class="ds-fn-ref" data-fn="${n}">${n}</sup>`;

function inline(nodes: (TextNode | DataTokenNode)[] | undefined, ctx: RenderContext, fn: FnState): string {
  const list = nodes ?? [];
  return list
    .map((n, i) => {
      const html = node(n, ctx, fn);
      return n.type === "text" && endsFootnoteRun(list, i) ? html + footnoteRef(fn.next++) : html;
    })
    .join("");
}

function node(n: TextNode | DataTokenNode, ctx: RenderContext, fn: FnState): string {
  if (isToken(n)) return chip(n, ctx);
  switch (n.type) {
    case "text":
      return marks(n.text ?? "", n);
    case "hardBreak":
      return "<br>";
    case "paragraph":
      return `<p>${wrapped(inline(n.content, ctx, fn), fn)}</p>`;
    case "heading": {
      const level = n.attrs?.level === 3 || n.attrs?.level === 4 ? n.attrs.level : 2;
      return `<h${level}>${wrapped(inline(n.content, ctx, fn), fn)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${inline(n.content, ctx, fn)}</ul>`;
    case "orderedList":
      return `<ol>${inline(n.content, ctx, fn)}</ol>`;
    case "listItem":
      return `<li>${inline(n.content, ctx, fn)}</li>`;
    default:
      return inline(n.content, ctx, fn) || (n.text ? esc(n.text) : "");
  }
}

/**
 * TextDoc → HTML. Footnote runs are numbered from `ctx.footnoteBase` (the
 * element's first number on its page, DS-7 footnotes.ts), else from 1.
 */
export function renderTextDoc(doc: TextDoc | undefined, ctx: RenderContext, opts: { wrap?: string } = {}): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const fn: FnState = { next: ctx.footnoteBase ?? 1, ...(opts.wrap ? { wrap: opts.wrap } : {}) };
  return doc.content.map((n) => node(n, ctx, fn)).join("");
}

/** Plain text of a TextDoc (aria labels, measuring). Chips count as their display. */
export function plainText(doc: TextDoc | undefined): string {
  const walk = (n: TextNode | DataTokenNode): string => (isToken(n) ? "#" : (n.text ?? "") + (n.content ?? []).map(walk).join(""));
  return (doc?.content ?? []).map(walk).join(" ").trim();
}

/**
 * PE-2 · a TextDoc as one line of SVG <tspan>s (curved text on a textPath).
 * Blocks are joined with a space; bold and italic become tspan attributes;
 * data chips print the resolved `display` (or "Not reported") with their data
 * marks, exactly as in HTML. Links and highlights keep their text only.
 */
export function renderTextDocSvg(doc: TextDoc | undefined, ctx: RenderContext): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const parts: string[] = [];
  const walk = (n: TextNode | DataTokenNode) => {
    if (isToken(n)) {
      const a = n.attrs;
      const v = ctx.data.tokens[tokenKey(a)] ?? null;
      const reason = unavailableReason(v);
      const marks = `data-source="${esc(a.binding?.source ?? "kpi")}" data-binding-hash="${a.binding ? bindingHash(a.binding) : ""}" data-measure="${esc(a.measure)}"`;
      parts.push(reason || !v ? `<tspan class="ds-chip ds-chip--nr" ${marks} data-reason="${esc(reason ?? "NOT_RESOLVED")}">${NOT_REPORTED}</tspan>` : `<tspan class="ds-chip" ${marks}>${esc(v.display)}</tspan>`);
      return;
    }
    if (n.type === "text") {
      const ms = (n.marks ?? []).map((m) => m.type);
      const attrs = `${ms.includes("bold") ? ' font-weight="700"' : ""}${ms.includes("italic") ? ' font-style="italic"' : ""}`;
      const t = esc(n.text ?? "");
      parts.push(attrs ? `<tspan${attrs}>${t}</tspan>` : t);
      return;
    }
    if (n.type === "hardBreak") {
      parts.push(" ");
      return;
    }
    const block = ["paragraph", "heading", "listItem"].includes(n.type);
    if (block && parts.length && parts[parts.length - 1] !== " ") parts.push(" ");
    (n.content ?? []).forEach(walk);
  };
  doc.content.forEach(walk);
  return parts.join("").trim();
}
