/**
 * DS-9 · the action runner: one action → one `Suggestion` (01-contracts §8).
 * Nothing is written to the doc: the FE applies an accepted suggestion with a
 * normal PATCH (and the build hook applies it to the doc it is building).
 *
 *   1. the action and its target (text box, chart, image, page or the whole doc)
 *   2. the context (context.ts): facts, report details, brand voice, page text
 *   3. budget check → model call → log row (every call, ok or not)
 *   4. zod on the answer → token guard → on issues, ONE retry with the issues listed
 *   5. still invalid → DS_AI_OUTPUT_INVALID {issues}
 *
 * Text suggestions carry `payload.text` (the new TipTap doc, chips bound to
 * approved data) and `payload.elements` (the target element with that text,
 * `source: 'ai'`, `reviewed: false`), so the FE can diff and apply by element
 * id. With nothing selected, a text action fills the template slot it belongs
 * to (exec summary, methodology …) or proposes a new body-text box on the page.
 */
import crypto from "crypto";
import { z } from "zod";
import {
  DsError,
  ElementSchema,
  type AiAction,
  type AiParams,
  type AiTarget,
  type Element,
  type FreeformPage,
  type ReportDoc,
  type Suggestion,
  type TextDoc,
} from "../contracts";
import type { StudioCaller } from "../guard";
import { ACTIONS, matchesSlot, type ActionSpec } from "./actions";
import { assertBudget, logCall } from "./budget";
import { AiCallError, complete, parseJsonObject, type Completion } from "./client";
import { buildAiContext, charBudget, newTextFrame, type AiContext } from "./context";
import { guardText, literalNumberIssues, plainText, TOKEN_RE, textDocToTokens, toTextDoc, type SuggestionSource, type TokenScope } from "./guard";
import { FINDINGS_OUTPUT, TEXT_OUTPUT, systemPrompt, userPrompt, type TaskInput } from "./prompts/common";

type TextLike = Extract<Element, { type: "text" | "callout" }>;
const isText = (e: Element | null | undefined): e is TextLike => !!e && (e.type === "text" || e.type === "callout");

const unavailable = (action: string, why: string) => new DsError("DS_VALIDATION", { issues: [{ path: "action", message: `${action} ${why}` }] });
const badTarget = (message: string) => new DsError("DS_VALIDATION", { issues: [{ path: "target", message }] });

const freeform = (doc: ReportDoc): FreeformPage[] => doc.pages.filter((p): p is FreeformPage => p.kind === "freeform");

/** The element ending in one of the slots (layout element ids are `<page>.<slot>`). */
function slotElement(doc: ReportDoc, slots: readonly string[] | undefined): { page: FreeformPage; element: TextLike } | null {
  if (!slots?.length) return null;
  for (const slot of slots) {
    for (const page of freeform(doc)) {
      const el = page.elements.find((e) => matchesSlot(e.id, slot) && isText(e));
      if (el && !page.hidden) return { page, element: el as TextLike };
    }
  }
  return null;
}

export interface ResolvedTarget {
  page: FreeformPage | null;
  element: Element | null;
}

/** Checks the target against the action's rule (404-free: a bad id is DS_VALIDATION). */
export function resolveTarget(spec: ActionSpec, doc: ReportDoc, target: AiTarget | undefined): ResolvedTarget {
  let page: FreeformPage | null = null;
  let element: Element | null = null;
  if (target) {
    const p = doc.pages.find((x) => x.id === target.pageId);
    if (!p) throw badTarget("That page isn't in this design");
    if (p.kind === "freeform") page = p;
    if (target.elementId) {
      element = page?.elements.find((e) => e.id === target.elementId) ?? null;
      if (!element) throw badTarget("That element isn't on this page");
    }
  }
  switch (spec.target) {
    case "doc":
      return { page, element: null };
    case "chart":
      if (element?.type !== "chart") throw badTarget("Select a chart");
      return { page, element };
    case "image":
      if (element?.type !== "image" && element?.type !== "frame") throw badTarget("Select an image or a frame");
      return { page, element };
    case "text_required":
      if (!isText(element)) throw badTarget("Select a text box");
      if (spec.needsText && !plainText(element.props.doc, doc.meta.year).trim()) throw badTarget("The text box is empty");
      return { page, element };
    case "text_optional": {
      if (element && !isText(element)) throw badTarget("Select a text box, or nothing");
      if (element) return { page, element };
      const slot = slotElement(doc, spec.slots);
      if (slot && (!page || slot.page.id === page.id || !target)) return { page: slot.page, element: slot.element };
      const first = page ?? freeform(doc).find((p) => !p.hidden) ?? null;
      if (!first) throw badTarget("This design has no free-form page for the text");
      return { page: first, element: null };
    }
  }
}

const TextOut = z.object({ paragraphs: z.array(z.string().max(4000)).min(1).max(12) }).passthrough();
const TitleOut = z.object({ title: z.string().trim().min(1).max(160), subtitle: z.string().trim().max(240).optional() }).passthrough();
const AltOut = z.object({ alt: z.string().trim().min(1).max(500) }).passthrough();
const FindingsOut = z
  .object({
    findings: z
      .array(z.object({ message: z.string().trim().min(1).max(600), pageId: z.string().max(120).optional().nullable(), elementId: z.string().max(120).optional().nullable(), severity: z.string().optional() }).passthrough())
      .max(12),
  })
  .passthrough();

const OUTPUT_TEXT: Record<ActionSpec["output"], string> = {
  text: TEXT_OUTPUT,
  chart_title: '{"title": "the chart title", "subtitle": "optional unit and period"}',
  alt: '{"alt": "the alt text"}',
  findings: FINDINGS_OUTPUT,
};

/** Text of every visible page (for findings), with ids, capped. */
function pagesText(doc: ReportDoc): string {
  const out: string[] = [];
  let used = 0;
  for (const p of doc.pages) {
    if (p.hidden) continue;
    const text =
      p.kind === "freeform"
        ? p.elements
            .filter(isText)
            .map((e) => plainText((e as TextLike).props.doc, doc.meta.year))
            .filter(Boolean)
            .join(" / ")
        : plainText(p.content, doc.meta.year);
    const line = `[${p.id}] ${p.name}: ${text.slice(0, 600) || "(no text)"}`;
    if (used + line.length > 9000) break;
    used += line.length;
    out.push(line);
  }
  return out.join("\n");
}

function describeTarget(el: Element, docYear: number): string {
  if (el.type === "chart") {
    const p = el.props;
    return `A ${p.kind} chart. Current title: ${p.title ?? "(none)"}. Data: ${p.binding.source === "ghg" ? `GHG ${p.binding.metric}${p.binding.breakdown ? ` by ${p.binding.breakdown}` : ""}` : p.binding.source === "kpi" ? `KPI ${p.binding.kpis.join(", ")}` : "typed data"}.`;
  }
  if (el.type === "image" || el.type === "frame") return `An image. Current alt text: ${el.props.alt || "(none)"}.`;
  if (isText(el)) return plainText(el.props.doc, docYear);
  return el.type;
}

export interface RunInput {
  caller: StudioCaller;
  docId: number | null;
  doc: ReportDoc;
  action: AiAction;
  target?: AiTarget;
  params?: AiParams;
  /** Reuse a context built for this doc (chat, build hook). */
  ctx?: AiContext;
}

export async function runAction(input: RunInput): Promise<Suggestion> {
  const { caller, doc, action } = input;
  const spec = ACTIONS[action];
  if (!spec) throw unavailable(action, "isn't available yet");
  if (!spec.kinds.includes(doc.kind)) throw unavailable(action, `isn't for a ${doc.kind === "ghg" ? "GHG" : "sustainability"} report`);
  const params = input.params ?? {};
  const { page, element } = resolveTarget(spec, doc, input.target);
  const ctx = input.ctx ?? (await buildAiContext(caller, input.docId, doc));

  // The token scope for this call: rewrites keep their chips exactly.
  const scope: TokenScope = { ...ctx.scope };
  const task: TaskInput = { ctx, limit: 900, ...(params.note ? { note: params.note } : {}), ...(params.differentFrom ? { differentFrom: params.differentFrom } : {}), ...(params.category ? { category: params.category } : {}) };
  if (spec.output === "text") {
    if (isText(element)) {
      const t = textDocToTokens((element as TextLike).props.doc, doc.meta.year);
      scope.existing = t.existing;
      task.targetText = t.text;
      task.limit = charBudget(element!.frame);
    } else {
      task.limit = charBudget(newTextFrame(doc));
    }
    if (page) {
      task.pageName = page.name;
      task.pageText = page.elements
        .filter((e) => isText(e) && e.id !== element?.id)
        .map((e) => plainText((e as TextLike).props.doc, doc.meta.year))
        .filter(Boolean)
        .join("\n");
    }
  } else if (spec.output === "findings") {
    task.pageText = pagesText(doc);
    task.pageName = "PAGES (each line: [page id] name: text)";
    task.limit = 2400;
  } else if (element) {
    task.targetText = describeTarget(element, doc.meta.year);
    task.limit = spec.output === "alt" ? 200 : 120;
  }

  const system = systemPrompt(ctx, OUTPUT_TEXT[spec.output]);
  let user = userPrompt(task, spec.task(task));
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertBudget(caller.companyId, input.docId);
    let c: Completion;
    try {
      c = await complete({ group: spec.group, system, user, maxTokens: spec.output === "text" ? 1800 : 900 });
    } catch (err) {
      if (err instanceof AiCallError) await logCall({ companyId: caller.companyId, docId: input.docId, userId: caller.userId, action, model: err.model, tokensIn: 0, tokensOut: 0, costUsd: 0, ok: false, errorCode: "DS_AI_UNAVAILABLE" });
      throw err;
    }
    const result = interpret(spec, c.text, scope, doc, element);
    await logCall({
      companyId: caller.companyId,
      docId: input.docId,
      userId: caller.userId,
      action,
      model: c.model,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      costUsd: c.costUsd,
      ok: !("issues" in result),
      errorCode: "issues" in result ? "DS_AI_OUTPUT_INVALID" : null,
    });
    if (!("issues" in result)) return toSuggestion(spec, action, c.model, result, doc, page, element);
    lastIssues = result.issues;
    user = `${userPrompt(task, spec.task(task))}\n\nYOUR LAST ANSWER COULDN'T BE USED:\n${result.issues.slice(0, 12).map((i) => `- ${i}`).join("\n")}\nAnswer again, fixing every point.`;
  }
  throw new DsError("DS_AI_OUTPUT_INVALID", { issues: lastIssues.slice(0, 12) });
}

type Interpreted =
  | { issues: string[] }
  | { text: TextDoc; sources: SuggestionSource[] }
  | { title: string; subtitle?: string }
  | { alt: string }
  | { findings: NonNullable<Suggestion["payload"]["findings"]> };

/** Parse → zod → guard. Never throws: a bad answer is a list of issues. */
export function interpret(spec: Pick<ActionSpec, "output">, answer: string, scope: TokenScope, doc: ReportDoc, element: Element | null): Interpreted {
  let json: unknown;
  try {
    json = parseJsonObject(answer);
  } catch {
    return { issues: ["The answer wasn't one JSON object"] };
  }
  const zodIssues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`);
  switch (spec.output) {
    case "text": {
      const r = TextOut.safeParse(json);
      if (!r.success) return { issues: zodIssues(r.error) };
      const issues = guardText(r.data.paragraphs.join("\n\n"), scope);
      if (issues.length) return { issues };
      try {
        const t = toTextDoc(r.data.paragraphs, scope);
        return { text: t.doc, sources: t.sources };
      } catch (err) {
        return { issues: [(err as Error).message] };
      }
    }
    case "chart_title": {
      const r = TitleOut.safeParse(json);
      if (!r.success) return { issues: zodIssues(r.error) };
      const text = `${r.data.title} ${r.data.subtitle ?? ""}`;
      const issues = [...literalNumberIssues(text), ...(new RegExp(TOKEN_RE.source).test(text) ? ["A chart title has no tokens: the chart shows the figures"] : [])];
      return issues.length ? { issues } : { title: r.data.title, ...(r.data.subtitle ? { subtitle: r.data.subtitle } : {}) };
    }
    case "alt": {
      const r = AltOut.safeParse(json);
      if (!r.success) return { issues: zodIssues(r.error) };
      const issues = [...literalNumberIssues(r.data.alt), ...(new RegExp(TOKEN_RE.source).test(r.data.alt) ? ["Alt text has no tokens"] : [])];
      return issues.length ? { issues } : { alt: r.data.alt.slice(0, 500) };
    }
    case "findings": {
      const r = FindingsOut.safeParse(json);
      if (!r.success) return { issues: zodIssues(r.error) };
      const pages = new Map(doc.pages.map((p) => [p.id, p]));
      const issues: string[] = [];
      const findings = r.data.findings.map((f) => {
        issues.push(...literalNumberIssues(f.message));
        if (new RegExp(TOKEN_RE.source).test(f.message)) issues.push("Findings name figures in words, not tokens");
        const page = f.pageId ? pages.get(f.pageId) : undefined;
        const el = page?.kind === "freeform" && f.elementId ? page.elements.find((e) => e.id === f.elementId) : undefined;
        const severity = f.severity === "info" ? "info" : "warning";
        return { message: f.message, ...(page ? { pageId: page.id } : {}), ...(el ? { elementId: el.id } : {}), severity } as const;
      });
      return issues.length ? { issues } : { findings };
    }
  }
}

function toSuggestion(spec: ActionSpec, action: AiAction, model: string, result: Exclude<Interpreted, { issues: string[] }>, doc: ReportDoc, page: FreeformPage | null, element: Element | null): Suggestion {
  const base = { id: `sug_${crypto.randomUUID()}`, action, model, createdAt: new Date().toISOString() };
  const ai = { source: "ai" as const, reviewed: false };
  const valid = (e: unknown): Element => {
    const r = ElementSchema.safeParse(e);
    if (!r.success) throw new DsError("DS_AI_OUTPUT_INVALID", { issues: r.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`) });
    return r.data;
  };
  if ("text" in result) {
    let el: Element;
    if (isText(element)) {
      const t = element as TextLike;
      el = valid({ ...t, ...ai, props: { ...t.props, doc: result.text } });
    } else {
      const top = Math.max(0, ...(page?.elements.map((e) => e.z) ?? [0])) + 1;
      el = valid({ id: `ai-${crypto.randomUUID().slice(0, 8)}`, type: "text", frame: newTextFrame(doc), z: top, ...ai, props: { doc: result.text, style: "body", align: "left" } });
    }
    return { ...base, kind: "text", payload: { text: result.text, elements: [el] }, sources: result.sources };
  }
  if ("title" in result && element?.type === "chart") {
    const el = valid({ ...element, ...ai, props: { ...element.props, title: result.title, ...(result.subtitle ? { subtitle: result.subtitle } : {}) } });
    return { ...base, kind: "elements", payload: { elements: [el] }, sources: [] };
  }
  if ("alt" in result && (element?.type === "image" || element?.type === "frame")) {
    const el = valid({ ...element, ...ai, props: { ...element.props, alt: result.alt } });
    return { ...base, kind: "elements", payload: { elements: [el] }, sources: [] };
  }
  if ("findings" in result) return { ...base, kind: "findings", payload: { findings: result.findings }, sources: [] };
  throw new DsError("DS_AI_OUTPUT_INVALID", { issues: [`${spec.output} answer didn't fit the target`] });
}
