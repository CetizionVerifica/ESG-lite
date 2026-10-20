/**
 * DS-9 · the action registry: which model group, output shape, report kinds
 * and target each AI action has, and its task text (prompts/*).
 *
 * Built: the RS-8 text actions (headline, body, rewrites, explain_change,
 * add_target_context, leadership_draft, about_report), the GHG actions
 * (ghg_exec_summary, ghg_methodology_text, scope3_category_text,
 * exclusion_reason_draft), apply_brand_voice, summarise_for_deck/social,
 * chart_title, alt_text and the findings (honesty_check, jargon_check,
 * missing_disclosures). design_from_brief has its own endpoint (brief.ts).
 * Not built yet (DS_VALIDATION "isn't available yet"): draft_page,
 * chart_kind, suggest_layouts, fill_page, cover_art (DS-4's /assets/generate
 * makes cover art), suggest_style, draft_report (the build hook runs the
 * per-slot actions instead, draft.ts).
 */
import type { AiAction, ReportKind } from "../contracts";
import type { ModelGroup } from "./client";
import { FINDINGS_TASKS, REWRITE_TASKS, type TaskInput } from "./prompts/common";
import { GHG_TASKS, scope3CategoryTask } from "./prompts/ghg";
import { SUSTAINABILITY_TASKS } from "./prompts/sustainability";

export type OutputKind = "text" | "chart_title" | "alt" | "findings";
export type TargetRule = "text_required" | "text_optional" | "chart" | "image" | "doc";

export interface ActionSpec {
  group: ModelGroup;
  output: OutputKind;
  kinds: readonly ReportKind[];
  target: TargetRule;
  /** Rewrites need text to work on. */
  needsText?: boolean;
  /** Where the text goes when nothing is selected: element id suffixes in the template (DS-4 slots). */
  slots?: readonly string[];
  /** One line for the chat router. */
  label: string;
  task(t: TaskInput): string;
}

const BOTH = ["ghg", "sustainability"] as const;
const GHG = ["ghg"] as const;
const SUS = ["sustainability"] as const;

const rewrite = (key: keyof typeof REWRITE_TASKS, label: string): ActionSpec => ({ group: "rewrites", output: "text", kinds: BOTH, target: "text_required", needsText: true, label, task: () => REWRITE_TASKS[key] });

export const ACTIONS: Partial<Record<AiAction, ActionSpec>> = {
  rewrite_shorter: rewrite("rewrite_shorter", "make the selected text shorter or more concise"),
  rewrite_longer: rewrite("rewrite_longer", "make the selected text longer"),
  rewrite_formal: rewrite("rewrite_formal", "make the selected text more formal"),
  rewrite_plain: rewrite("rewrite_plain", "rewrite the selected text in plain English"),
  apply_brand_voice: rewrite("apply_brand_voice", "rewrite the selected text in the company's brand voice"),
  summarise_for_deck: rewrite("summarise_for_deck", "summarise the selected text as slide bullets"),
  summarise_for_social: rewrite("summarise_for_social", "summarise the selected text for a social card"),
  add_target_context: { group: "drafting", output: "text", kinds: SUS, target: "text_required", needsText: true, label: "add target context to the selected text", task: () => SUSTAINABILITY_TASKS.add_target_context },
  headline: { group: "drafting", output: "text", kinds: BOTH, target: "text_required", label: "write a headline for the selected text box's page", task: () => REWRITE_TASKS.headline },
  body: { group: "drafting", output: "text", kinds: BOTH, target: "text_optional", label: "write body text for the page", task: () => REWRITE_TASKS.body },
  explain_change: { group: "drafting", output: "text", kinds: BOTH, target: "text_optional", label: "explain the change against the prior year", task: () => REWRITE_TASKS.explain_change },
  ghg_exec_summary: { group: "drafting", output: "text", kinds: GHG, target: "text_optional", slots: ["exec_summary.summary", "headline.text", "summary.text"], label: "write the executive summary", task: () => GHG_TASKS.ghg_exec_summary },
  ghg_methodology_text: { group: "drafting", output: "text", kinds: GHG, target: "text_optional", slots: ["methodology.text"], label: "write the methodology text", task: () => GHG_TASKS.ghg_methodology_text },
  scope3_category_text: {
    group: "drafting",
    output: "text",
    kinds: GHG,
    target: "text_optional",
    label: "write the text for one Scope 3 category (params.category 1-15)",
    task: (t) => scope3CategoryTask(t.category ?? 1),
  },
  exclusion_reason_draft: { group: "drafting", output: "text", kinds: GHG, target: "text_optional", label: "draft reasons for excluded Scope 3 categories", task: () => GHG_TASKS.exclusion_reason_draft },
  leadership_draft: { group: "drafting", output: "text", kinds: SUS, target: "text_optional", slots: ["leadership.message"], label: "draft the leadership message", task: () => SUSTAINABILITY_TASKS.leadership_draft },
  about_report: { group: "drafting", output: "text", kinds: SUS, target: "text_optional", slots: ["about.about"], label: "write the about-this-report text", task: () => SUSTAINABILITY_TASKS.about_report },
  chart_title: {
    group: "rewrites",
    output: "chart_title",
    kinds: BOTH,
    target: "chart",
    label: "suggest a title for the selected chart",
    task: () => "Suggest a chart title (at most 10 words) that states the takeaway of the chart's data, and an optional subtitle naming the unit and period. The chart is described in TARGET.",
  },
  alt_text: { group: "rewrites", output: "alt", kinds: BOTH, target: "image", label: "write alt text for the selected image", task: () => "Write alt text (at most 200 characters) for the image described in TARGET: what it shows, for a screen reader. No figures." },
  honesty_check: { group: "drafting", output: "findings", kinds: BOTH, target: "doc", label: "check the text is balanced and honest about the figures", task: () => FINDINGS_TASKS.honesty_check },
  jargon_check: { group: "rewrites", output: "findings", kinds: BOTH, target: "doc", label: "check the text for jargon", task: () => FINDINGS_TASKS.jargon_check },
  missing_disclosures: {
    group: "drafting",
    output: "findings",
    kinds: BOTH,
    target: "doc",
    label: "check the report for missing disclosures",
    task: (t) => (t.ctx.kind === "ghg" ? GHG_TASKS.missing_disclosures : SUSTAINABILITY_TASKS.missing_disclosures),
  },
};

export const builtActions = (): AiAction[] => Object.keys(ACTIONS) as AiAction[];
