/**
 * DS-9 · the drafting step of the auto-build (DS-5 `aiHook.ts`, RS-8 §7): when
 * a design is created with `ai: true`, the template's draftable text slots are
 * written by AI after the data is in. Each slot is one action through the
 * runner (budgeted, logged, guarded), so the text carries chips, never typed
 * figures, and is marked `source: 'ai'`, `reviewed: false` (AI_UNREVIEWED
 * until a person ticks it).
 *
 *   GHG             exec_summary.summary → ghg_exec_summary; methodology.text → ghg_methodology_text
 *   sustainability  leadership.message → leadership_draft; about.about → about_report
 *
 * A slot that fails keeps the template text; the step note says how many were
 * written. If none could be written because AI isn't available, the hook
 * throws and DS-5 marks the step failed ("template text kept").
 */
import { DsError, type AiAction, type Element, type FreeformPage, type ReportDoc } from "../contracts";
import type { AiDraftHook } from "../docs/aiHook";
import { ACTIONS } from "./actions";
import { buildAiContext } from "./context";
import { runAction } from "./runner";

const DRAFT_SLOTS: Record<ReportDoc["kind"], AiAction[]> = {
  ghg: ["ghg_exec_summary", "ghg_methodology_text"],
  sustainability: ["leadership_draft", "about_report"],
};

/** The slot element an action fills in this doc, or null. */
export function draftTarget(doc: ReportDoc, action: AiAction): { page: FreeformPage; element: Element } | null {
  const slots = ACTIONS[action]?.slots ?? [];
  for (const slot of slots) {
    for (const page of doc.pages) {
      if (page.kind !== "freeform") continue;
      const element = page.elements.find((e) => (e.type === "text" || e.type === "callout") && (e.id === slot || e.id.endsWith(`.${slot}`)));
      if (element) return { page, element };
    }
  }
  return null;
}

/** Replaces one element by id (pure). */
export function replaceElement(doc: ReportDoc, pageId: string, next: Element): ReportDoc {
  return { ...doc, pages: doc.pages.map((p) => (p.id !== pageId || p.kind !== "freeform" ? p : { ...p, elements: p.elements.map((e) => (e.id === next.id ? next : e)) })) };
}

export const draftHook: AiDraftHook = async ({ caller, docId, doc: raw }) => {
  let doc = raw as unknown as ReportDoc;
  const actions = DRAFT_SLOTS[doc.kind].filter((a) => draftTarget(doc, a));
  if (!actions.length) return { doc: raw, note: "No text in this template is drafted by AI." };
  const ctx = await buildAiContext(caller, docId, doc);
  let written = 0;
  let lastErr: unknown = null;
  for (const action of actions) {
    const t = draftTarget(doc, action)!;
    try {
      const s = await runAction({ caller, docId, doc, action, target: { pageId: t.page.id, elementId: t.element.id }, ctx });
      const el = s.payload.elements?.[0];
      if (el) {
        doc = replaceElement(doc, t.page.id, el);
        written++;
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof DsError && err.code === "DS_AI_BUDGET_EXCEEDED") break;
    }
  }
  if (!written && lastErr) throw lastErr;
  return { doc: doc as unknown as Record<string, unknown>, note: `AI wrote ${written} of ${actions.length} texts; please review them.` };
};
