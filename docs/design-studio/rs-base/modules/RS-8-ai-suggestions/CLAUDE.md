# RS-8 · AI suggestions: drafting, rewrites, layouts, report-wide checks

> **Module spec**, lane L5. Copy to `ESG-lite/src/kpi/studio/ai/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/studio/ai/CLAUDE.md`.
> **PR titles:** `[RS-8 k/m]`, five PRs:
> 1. client, budget, guard and log;
> 2. text actions (draft, headline, body, rewrites, leadership, about);
> 3. element and page actions (chart title and kind, suggest layouts, fill page, alt text, cover art);
> 4. report-wide findings;
> 5. FE suggestion UI.
>
> **Depends on:** RS-2, RS-4, RS-7 · **Owns:** `report_ai_call`, `src/kpi/studio/ai/*`, FE `studio/ai/*`
> **Touches:** `src/reporting/ai-narrative.ts` (extract the OpenRouter client to `src/services/llm/openrouter.ts`; same behaviour, GHG goldens unchanged)

## Job to be done
The AI does the first draft and helps on request, like a careful colleague. It writes clear, honest text and proposes layouts, never invents a number, and never changes the report without a person's click.

## Today
`ai-narrative.ts` asks OpenRouter (default `google/gemini-3-flash-preview`) for prose-only JSON, with figures from SQL and a fallback to built-in text. `imagery.ts` makes cover images.

## Build
### Backend
1. **`client.ts`:** `complete({model, system, user, schema, maxTokens})` uses the extracted OpenRouter helper with JSON mode, a 45 s time limit, and token usage returned. The models come from env per action group (R7).
2. **`budget.ts`:** before each call, check the doc's day spend and call count and the company's month spend against the R8 limits (Superadmin overrides per company). Over the limit → `RS_AI_BUDGET_EXCEEDED`. After the call, write `report_ai_call` (tokens, cost from the model price table, ok, error_code).
3. **`guard.ts`** (`01-contracts` §8): zod validate; the literal-number rule (allowlist: 4-digit years 1990–2100, framework codes, SDG numbers, ordinal words); tokens must reference selected KPIs; convert `{{kpi:CODE|year|measure}}` to `kpi` nodes; one retry with the errors listed; then `RS_AI_OUTPUT_INVALID`.
4. **Context builder:** for a target, assemble only what it needs:
   - company profile (name, industry, sites count, consolidation);
   - the resolved values of the chapter's KPIs (current, prior, base, target, progress, good direction) **already formatted**;
   - material-topic reasons;
   - the existing text on the page;
   - design tone (Editorial: measured; Night: bold; Minimal: plain).

   It never includes user emails, evidence contents or other companies' data.
5. **Actions** (`actions/*.ts`; prompts as versioned files in `prompts/`):
   - **Text:** `draft_report` (all pages: headline that states the finding, body, captions; runs page by page, streaming progress to the build list), `draft_page`, `headline`, `body`, `leadership_draft` (first person, signatory placeholder, marked unconfirmed), `about_report`, `rewrite_shorter|longer|formal|plain`, `explain_change` (uses RS-2 derived figures and drivers, if a waterfall binding exists), `add_target_context`.
   - **Elements:** `chart_title`, `chart_kind` (picks only from kinds valid for the binding shape), `alt_text`.
   - **Pages:** `suggest_layouts` returns 2–3 alternative arrangements of the same elements (the model proposes frames on a 12-column grid within the safe area; the server validates against the layout checks and drops invalid ones), and `fill_page` (on an empty page, proposes elements from the chapter's KPIs).
   - **Images:** `cover_art` (wraps `imagery.ts` and saves an asset).
   - **Findings:** `honesty_check` (KPIs that worsened or targets behind that the text doesn't mention), `jargon_check`, `missing_disclosures` (from KPI-11 omissions plus framework coverage).
6. **Endpoint:** `POST /docs/:id/ai` returns a `Suggestion`. Nothing is written to the doc; the FE applies accepted suggestions through a normal PATCH. `GET /docs/:id/ai/usage` returns the budget meter.
7. **Build integration:** when the RS-4 wizard has `ai: true`, the build runs `draft_report` after layout, as a background step with progress. Failures leave the template text and say so.

### Frontend (05-ux S4)
- **Entry points:** the AI menu in the inspector, "Ask AI" in the insert bar, and right-click "Ask AI about this".
- **SuggestionCard:**
  - text shows a word diff;
  - elements and pages show a ghost preview on the sheet;
  - layouts show 2–3 thumbnails;
  - sources are listed.
- **Accept** applies as one history step and sets `source: 'ai'`, `reviewed: false`. **Try again** re-calls with "different from: …". **Discard** closes.
- The FindingsPanel shows report-wide results with "Go to page".
- The BudgetMeter, the "paused" state, and the error state "Your report is unchanged".

## Golden cases (`ci/golden/rs/ai/`)
Run with a recorded provider (fixtures of model outputs, no network in CI):
- the guard accepts token-only text and rejects "emissions fell to 48,620 t" written as a literal;
- the allowlist keeps "GRI 305-1" and "2030";
- unselected-KPI tokens are rejected;
- `suggest_layouts` drops proposals outside the safe area;
- budget limits trigger at the boundary.

## Tests
- **API:** roles, tenant isolation, switch-off, budget, provider down → `RS_AI_UNAVAILABLE`, invalid twice → `RS_AI_OUTPUT_INVALID`, a call log row per call, no PII in prompts (a snapshot test of the built context).
- **Playwright** (mocked provider): headline suggestion accept/undo, rewrite shorter with diff, layout suggestion applied, honesty findings list.
- **Manual eval** before release: 3 real client years, a human rating of drafts on accuracy, tone and usefulness (record in the PR).

## Out of scope
Auto-applying anything. Translation (R14). Chat with the report (a later idea).

## Done when
- Every action in `01-contracts` §8 works end to end as a suggestion.
- AI never places a literal KPI number.
- Every call is budgeted and logged.
- A fresh report reads as a credible first draft that people refine rather than rewrite.
