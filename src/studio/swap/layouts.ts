/**
 * AT-2 · the DS-9 action `suggest_layouts`: three layouts for one page, built
 * from the company's library layouts (system + own, the doc's kind and format)
 * and the page's own elements. Reached through POST /docs/:id/ai (runner.ts
 * hands the action over here); nothing is written to the doc.
 *
 *   1. target: a visible free-form page (DS_VALIDATION otherwise, no model call);
 *   2. candidates: rankLayouts (compose.ts), the page's own layout and the
 *      `params.differentFrom` slugs ("More ideas") left out;
 *   3. budget → model (rewrites group) → log row, as every DS-9 call;
 *   4. SuggestLayoutsModelOutputSchema → slugs must be candidates, slots must
 *      exist and fit, names and reasons pass the literal-number rule → the
 *      server builds each page (composePage) and checks it (layoutOptionIssues:
 *      every element kept, only frame/z changed, ElementSchema, doc schema,
 *      DS-12 safe area and locked overlaps);
 *   5. issues → ONE retry listing them → DS_AI_OUTPUT_INVALID {issues}.
 *   Fewer than three good options: the best remaining candidates fill the gap
 *   (server-written reason), so the answer always has three when the library does.
 */
import crypto from "crypto";
import {
  DsError,
  LAYOUT_OPTIONS_PER_PAGE,
  LAYOUT_OPTION_IDS,
  SuggestLayoutsModelOutputSchema,
  type AiParams,
  type AiTarget,
  type Element,
  type FreeformPage,
  type LayoutOptionMeta,
  type ReportDoc,
  type ReportLayout,
  type Suggestion,
} from "../contracts";
import type { StudioCaller } from "../guard";
import { listLayouts } from "../library/service";
import { assertBudget, logCall } from "../ai/budget";
import { AiCallError, complete, parseJsonObject, type Completion } from "../ai/client";
import { literalNumberIssues, plainText } from "../ai/guard";
import { layoutsSystemPrompt, layoutsUserPrompt, type LayoutPromptCandidate, type LayoutPromptElement } from "../ai/prompts/layouts";
import { autoAssign, checkPairs, composePage, layoutOptionIssues, layoutSlots, movable, rankLayouts, type GivenPair } from "./compose";

/** How many candidate layouts the model is shown. */
export const LAYOUT_CANDIDATES = 8;

const badTarget = (message: string) => new DsError("DS_VALIDATION", { issues: [{ path: "target", message }] });

/** The free-form page the action is for. */
export function layoutTargetPage(doc: ReportDoc, target: AiTarget | undefined): FreeformPage {
  if (!target?.pageId) throw badTarget("Select a page");
  const page = doc.pages.find((p) => p.id === target.pageId);
  if (!page) throw badTarget("That page isn't in this design");
  if (page.kind !== "freeform") throw badTarget("Layouts are for free-form pages; this page flows its own content");
  if (page.hidden) throw badTarget("That page is hidden");
  if (!movable(page).length) throw badTarget("This page has nothing a layout could arrange");
  return page;
}

/** "More ideas": the slugs already shown, sent back as `params.differentFrom` (comma separated). */
export const shownSlugs = (params: AiParams | undefined): string[] =>
  (params?.differentFrom ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 120)
    .slice(0, 30);

const KIND_WORD: Record<string, string> = { heading: "heading text", text: "text", callout: "callout", chart: "chart", table: "table", figure: "figure tile", picture: "picture", badge: "icon or badge" };

function excerpt(e: Element, year: number): string {
  if (e.type === "text" || e.type === "callout") return plainText(e.props.doc, year).replace(/\{\{[^}]+\}\}/g, "⟨figure⟩").replace(/\s+/g, " ").slice(0, 120);
  if (e.type === "chart") return `${e.props.kind} chart${e.props.title ? ` "${e.props.title.slice(0, 80)}"` : ""}`;
  if (e.type === "table") return "a table";
  if (e.type === "image" || e.type === "frame") return e.props.alt ? `picture: ${e.props.alt.slice(0, 80)}` : "a picture";
  return "";
}

export function promptElements(doc: ReportDoc, page: FreeformPage): LayoutPromptElement[] {
  return movable(page).map(({ element: e, cls }) => ({ id: e.id, kind: KIND_WORD[cls] ?? cls, wMm: e.frame.w, hMm: e.frame.h, excerpt: excerpt(e, doc.meta.year) }));
}

export function promptCandidates(layouts: ReportLayout[]): LayoutPromptCandidate[] {
  return layouts.map((l) => ({ slug: l.slug, name: l.name, role: l.role, slots: layoutSlots(l).map((s) => ({ slot: s.slot, kind: KIND_WORD[s.cls] ?? s.cls, wMm: s.element.frame.w, hMm: s.element.frame.h })) }));
}

export interface BuiltOption {
  page: FreeformPage;
  meta: Omit<LayoutOptionMeta, "id">;
}

/** Server reason for a gap-filling option (no figures). */
const fallbackReason = (l: ReportLayout) => `Uses the library's ${l.name} layout; every text, chart and data chip on the page is kept.`;

/** Builds one option from a layout and the given pairs; returns its issues instead when it breaks a rule. */
export function buildOption(doc: ReportDoc, page: FreeformPage, layout: ReportLayout, pairs: GivenPair[], name: string, reason: string): BuiltOption | { issues: string[] } {
  const composed = composePage(doc, page, layout, autoAssign(page, layout, pairs));
  const issues = layoutOptionIssues(doc, page, composed.page);
  if (issues.length) return { issues: issues.map((i) => `${layout.slug}: ${i}`) };
  return { page: composed.page, meta: { name: name.slice(0, 80), layoutSlug: layout.slug, reason: reason.slice(0, 400), placedElementIds: composed.placedElementIds } };
}

/**
 * The model's answer → up to three built options, or the issues for the
 * retry. Pure (no DB): unit tests feed it recorded answers.
 */
export function interpretLayouts(answer: string, doc: ReportDoc, page: FreeformPage, candidates: ReportLayout[]): { options: BuiltOption[] } | { issues: string[] } {
  let json: unknown;
  try {
    json = parseJsonObject(answer);
  } catch {
    return { issues: ["The answer wasn't one JSON object"] };
  }
  const r = SuggestLayoutsModelOutputSchema.safeParse(json);
  if (!r.success) return { issues: r.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "answer"}: ${i.message}`) };
  const bySlug = new Map(candidates.map((l) => [l.slug, l]));
  const issues: string[] = [];
  const options: BuiltOption[] = [];
  const seen = new Set<string>();
  for (const o of r.data.options) {
    const layout = bySlug.get(o.layoutSlug);
    if (!layout) {
      issues.push(`${o.layoutSlug} isn't one of the LAYOUTS offered`);
      continue;
    }
    if (seen.has(layout.slug)) continue; // the same layout twice: keep the first
    seen.add(layout.slug);
    issues.push(...literalNumberIssues(`${o.name} ${o.reason}`).map((i) => `${o.layoutSlug} name or reason: ${i}`));
    const pairs = checkPairs(page, layout, o.slots);
    issues.push(...pairs.issues);
    const built = buildOption(doc, page, layout, pairs.ok, o.name, o.reason);
    if ("issues" in built) issues.push(...built.issues);
    else options.push(built);
  }
  return issues.length ? { issues } : { options };
}

/** Three options: the model's, then the best remaining candidates. */
export function completeOptions(doc: ReportDoc, page: FreeformPage, picked: BuiltOption[], ranked: ReportLayout[]): BuiltOption[] {
  const out = picked.slice(0, LAYOUT_OPTIONS_PER_PAGE);
  const used = new Set(out.map((o) => o.meta.layoutSlug));
  for (const layout of ranked) {
    if (out.length >= LAYOUT_OPTIONS_PER_PAGE) break;
    if (used.has(layout.slug)) continue;
    const built = buildOption(doc, page, layout, [], layout.name, fallbackReason(layout));
    if ("issues" in built) continue;
    used.add(layout.slug);
    out.push(built);
  }
  return out;
}

export function toLayoutSuggestion(model: string, options: BuiltOption[]): Suggestion {
  return {
    id: `sug_${crypto.randomUUID()}`,
    action: "suggest_layouts",
    model,
    createdAt: new Date().toISOString(),
    kind: "pages",
    payload: {
      pages: options.map((o) => o.page),
      layoutOptions: options.map((o, i) => ({ id: LAYOUT_OPTION_IDS[i], ...o.meta })),
    },
    sources: [],
  };
}

export interface SuggestLayoutsInput {
  caller: StudioCaller;
  docId: number | null;
  doc: ReportDoc;
  target?: AiTarget;
  params?: AiParams;
}

export async function suggestLayouts(input: SuggestLayoutsInput): Promise<Suggestion> {
  const { caller, doc } = input;
  const page = layoutTargetPage(doc, input.target);
  const library = await listLayouts(caller, { kind: doc.kind, format: doc.format });
  const avoid = shownSlugs(input.params);
  let ranked = rankLayouts(page, library, { exclude: avoid }).map((r) => r.layout);
  // "More ideas" with the library exhausted starts again from the best fits.
  if (ranked.length < LAYOUT_OPTIONS_PER_PAGE) ranked = rankLayouts(page, library).map((r) => r.layout);
  if (!ranked.length) throw new DsError("DS_LAYOUT_NOT_FOUND", { reason: "No library layout fits this page's format" });
  const candidates = ranked.slice(0, LAYOUT_CANDIDATES);

  const system = layoutsSystemPrompt(doc.kind);
  const base = layoutsUserPrompt({ pageName: page.name, elements: promptElements(doc, page), candidates: promptCandidates(candidates), ...(input.params?.note ? { note: input.params.note } : {}), avoid });
  let user = base;
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertBudget(caller.companyId, input.docId);
    let c: Completion;
    try {
      c = await complete({ group: "rewrites", system, user, maxTokens: 1400 });
    } catch (err) {
      if (err instanceof AiCallError) await logCall({ companyId: caller.companyId, docId: input.docId, userId: caller.userId, action: "suggest_layouts", model: err.model, tokensIn: 0, tokensOut: 0, costUsd: 0, ok: false, errorCode: "DS_AI_UNAVAILABLE" });
      throw err;
    }
    const result = interpretLayouts(c.text, doc, page, candidates);
    await logCall({
      companyId: caller.companyId,
      docId: input.docId,
      userId: caller.userId,
      action: "suggest_layouts",
      model: c.model,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      costUsd: c.costUsd,
      ok: !("issues" in result),
      errorCode: "issues" in result ? "DS_AI_OUTPUT_INVALID" : null,
    });
    if (!("issues" in result)) return toLayoutSuggestion(c.model, completeOptions(doc, page, result.options, ranked));
    lastIssues = result.issues;
    user = `${base}\n\nYOUR LAST ANSWER COULDN'T BE USED:\n${result.issues.slice(0, 12).map((i) => `- ${i}`).join("\n")}\nAnswer again, fixing every point.`;
  }
  throw new DsError("DS_AI_OUTPUT_INVALID", { issues: lastIssues.slice(0, 12) });
}
