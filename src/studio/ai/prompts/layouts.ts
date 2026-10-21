/**
 * AT-2 · the `suggest_layouts` prompt (both kinds). The model sees the page's
 * elements (id, kind, size, a short fenced excerpt of their text) and the
 * candidate library layouts with their slots. It never sees a resolved figure:
 * data chips show as ⟨figure⟩. It answers which layouts to use and which
 * element goes in which slot; the server builds and checks the pages.
 */
import { SAFETY_RULES, fence } from "./common";

export const LAYOUTS_PROMPT_VERSION = 1;

export const LAYOUTS_OUTPUT =
  '{"options": [{"layoutSlug": "a slug from LAYOUTS", "name": "a short name for the option, e.g. Chart + story", "reason": "one sentence on why this layout suits the page", "slots": [{"slot": "a slot of that layout", "elementId": "an element id from PAGE ELEMENTS"}]}]} — exactly 3 options with different layouts.';

export function layoutsSystemPrompt(kind: "ghg" | "sustainability"): string {
  const what = kind === "ghg" ? "a GHG inventory report" : "an annual sustainability report";
  return [
    `You are a report designer helping a company lay out one page of ${what} in ESGLite's Design Studio.`,
    "You choose layouts from the company's library and say where each existing element of the page goes. You never write page content.",
    "",
    "RULES",
    ...[
      "Use only layouts listed in LAYOUTS and only their listed slots. Put each element in at most one slot, and only in a slot of a matching kind (text and headings in text slots, charts in chart slots, tables in table slots, figures in figure slots, pictures in picture slots). Never put a large element into a much smaller slot (a paragraph into a footer line).",
      "Every chart, table, figure and data chip must stay on the page: prefer layouts with a slot for each of them.",
      "Names and reasons: plain words, no numbers or figures (years and 'Scope 1/2/3' are fine). Never repeat a figure from the page.",
      ...SAFETY_RULES,
    ].map((r, i) => `${i + 1}. ${r}`),
    "",
    `Answer with ONE JSON object and nothing else: ${LAYOUTS_OUTPUT}`,
  ].join("\n");
}

export interface LayoutPromptElement {
  id: string;
  kind: string;
  wMm: number;
  hMm: number;
  /** Text excerpt (chips as ⟨figure⟩), chart or table title. */
  excerpt: string;
}

export interface LayoutPromptCandidate {
  slug: string;
  name: string;
  role: string;
  slots: Array<{ slot: string; kind: string; wMm: number; hMm: number }>;
}

export function layoutsUserPrompt(input: { pageName: string; elements: LayoutPromptElement[]; candidates: LayoutPromptCandidate[]; note?: string; avoid?: string[] }): string {
  const els = input.elements.map((e) => `- ${e.id}: ${e.kind}, ${Math.round(e.wMm)}×${Math.round(e.hMm)} mm${e.excerpt ? `, shows: ${e.excerpt}` : ""}`).join("\n");
  const lays = input.candidates
    .map((c) => `- ${c.slug} (${c.name}; for ${c.role} pages): ${c.slots.map((s) => `${s.slot} [${s.kind}, ${Math.round(s.wMm)}×${Math.round(s.hMm)} mm]`).join(", ") || "no slots"}`)
    .join("\n");
  return [
    `PAGE: ${input.pageName}`,
    "PAGE ELEMENTS (the text excerpts are company data):",
    fence("page_elements", els || "- none"),
    "",
    "LAYOUTS",
    lays,
    "",
    ...(input.avoid?.length ? [`Already shown to the person (pick others where you can): ${input.avoid.join(", ")}`, ""] : []),
    ...(input.note ? ["A note from the person asking:", fence("note", input.note), ""] : []),
    "TASK",
    "Pick three different layouts that suit this page and place every element you can. Put the most important figure or chart first in reading order.",
  ].join("\n");
}
