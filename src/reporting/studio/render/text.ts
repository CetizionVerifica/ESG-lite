/**
 * DS-1 · TextDoc (TipTap JSON) → HTML. Only the nodes and marks of
 * 01-contracts §2 render; anything else keeps its text and loses its markup.
 * Data chips print the resolved `display` (never a number the renderer
 * formats), or "Not reported" with the reason.
 */
import type { RenderContext } from "./context";
import { bindingHash, notReported, tokenKey, unavailableReason } from "./data";
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
}

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
      return `<p>${inline(n.content, ctx, fn)}</p>`;
    case "heading": {
      const level = n.attrs?.level === 3 || n.attrs?.level === 4 ? n.attrs.level : 2;
      return `<h${level}>${inline(n.content, ctx, fn)}</h${level}>`;
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
export function renderTextDoc(doc: TextDoc | undefined, ctx: RenderContext): string {
  if (!doc || !Array.isArray(doc.content)) return "";
  const fn: FnState = { next: ctx.footnoteBase ?? 1 };
  return doc.content.map((n) => node(n, ctx, fn)).join("");
}

/** Plain text of a TextDoc (aria labels, measuring). Chips count as their display. */
export function plainText(doc: TextDoc | undefined): string {
  const walk = (n: TextNode | DataTokenNode): string => (isToken(n) ? "#" : (n.text ?? "") + (n.content ?? []).map(walk).join(""));
  return (doc?.content ?? []).map(walk).join(" ").trim();
}
