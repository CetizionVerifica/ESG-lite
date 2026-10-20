# DS-9 · AI assistant: chat panel, design from a brief, brand voice, suggestions

> **Module spec**, lane L5, wave 4. Copy to `ESG-lite/src/studio/ai/CLAUDE.md`.
> **PR titles:** `[DS-9 k/m]`, five PRs:
> 1. OpenRouter helper extraction + action runner + guard + budget (RS-8 port);
> 2. GHG prompts and actions;
> 3. chat endpoint + intent routing;
> 4. FE AI panel + suggestion cards + toolbar AI menu;
> 5. design from a brief.
>
> **Depends on:** DS-2, DS-5, DS-7 · **Owns:** `report_ai_call`, `src/studio/ai/*`, `src/lib/openrouter.ts`, FE `studio/ai/*`
> **Base:** RS-8 (actions, schemas, token guard, budget, suggestion card, findings). Kept. Changes are below.

## Changes from RS-8
1. **Shared OpenRouter helper:**
   - move the client out of `src/reporting/ai-narrative.ts` into `src/lib/openrouter.ts`;
   - `ai-narrative.ts` keeps working byte-identically (unit test on a recorded response).
2. **GHG actions** (`01-contracts` §8): `ghg_exec_summary`, `ghg_methodology_text`, `scope3_category_text`, `exclusion_reason_draft`.
   - Prompts get resolved values and report inputs only, plus the token syntax `{{data:METRIC|year|measure}}`.
   - `exclusion_reason_draft` output is a draft for a person to confirm.
3. **Brand voice:** `brand.voice` (DS-3) is fenced into every writing prompt; the `apply_brand_voice` rewrite is offered.
4. **Chat** (`POST /docs/:id/ai/chat`):
   - the last 12 turns plus the selection go to a cheap router model that maps them to ≤ 3 actions;
   - the actions run; the reply is a short text plus `Suggestion[]`;
   - questions about numbers are answered only with tokens.
   - Chat never edits the doc.
5. **Design from a brief:**
   - `design_from_brief` takes a brief and the kind, and returns 2–3 `{templateId, look, chapters, styleId, title}` proposals with reasons;
   - Accept calls DS-5 build.
6. **FE AI panel** (`05-ux` S4):
   - chat thread, quick chips, a selection-aware header;
   - suggestion cards inline in the thread and anchored on the page (ghost preview);
   - budget meter;
   - the toolbar "AI ▾" menu for text and charts.

## Tests
- **Unit:** the token guard rejects literal numbers in GHG text; the router maps sample intents; budget enforcement.
- **Golden:** recorded model responses for each GHG action validate and render.
- **Playwright:** ask "Write the executive summary" → card with a diff → Accept → text has chips; Discard leaves the page unchanged.

## Done when
A user can chat with the report, get suggestions in brand voice with linked numbers, and nothing changes without Accept.

## As built (DS-9, branch `ds-9-ai` in ESG-lite and ESG-lite_FE, on `ds/local`, 2026-10-20)

### Backend files (ESG-lite)
- `src/lib/openrouter.ts`: the one OpenRouter client. `openRouterFetch(body, opts)` sends exactly what `ai-narrative.ts` sent (URL, header order, `JSON.stringify(body)` in the caller's key order, no signal); `openRouterChat` adds a time limit and parses text, model and token usage (never throws). `src/reporting/ai-narrative.ts` now calls `openRouterFetch` (same request, same fallbacks); a unit test checks the request byte for byte against a recorded answer.
- `src/entities/StudioAiCall.ts` + `src/scripts/migrateDs9Ai.ts` (`npm run migrate:ds-9-ai`, idempotent): `report_ai_call` as RS (`doc_id` nullable for a brief without a doc), indexes `(doc_id, created_at)` and `(company_id, created_at)`. Registered in `src/config/data-source.ts` (`// DS-9`).
- `src/studio/contracts/ai.ts` (`// DS-9` block): `AiRequestSchema` `{action, target?: {pageId, elementId?}, params?: {category?, differentFrom?, note?}}`, `ChatRequestSchema` `{messages ≤ 40, selection?}`, `ChatReply`, `AiUsage`, `BriefRequestSchema`, `BriefProposal`, `BriefReply`, `CHAT_ROUTER_TURNS = 12`, `CHAT_MAX_ACTIONS = 3`. No enum or error code changed (the contracts snapshot is unchanged).
- `src/studio/ai/`:
  - `client.ts`: `complete({group, system, user, maxTokens})` in JSON mode, 45 s (`STUDIO_AI_TIMEOUT_MS`), models per group from D10 (`drafting` Sonnet, `rewrites` and `router` Gemini Flash; env `STUDIO_AI_MODEL_*`), key `STUDIO_AI_API_KEY` else `OPENROUTER_API_KEY`, endpoint `STUDIO_AI_BASE_URL` (tests: a recorded stub). Failure → `DS_AI_UNAVAILABLE {reason}`.
  - `prices.ts` (USD per million tokens; OpenRouter `usage.cost` wins; unknown model priced as the dearest), `budget.ts` (`budgetVerdict` pure; `assertBudget` → `DS_AI_BUDGET_EXCEEDED {limit: doc_day_usd | doc_day_calls | company_month_usd}`; `logCall`; `usageResponse`). UTC day and month. The 200th call runs, the 201st is refused.
  - `guard.ts` (pure): tokens `{{data:METRIC|YEAR|MEASURE}}` (Scope 3 categories as `scope3_category.N`), `{{kpi:CODE|YEAR|MEASURE}}`, `{{input:KEY}}`; the literal-number rule with the allowlist (years and year ranges, framework and disclosure codes, SDGs, Scope 1–3, Category 1–15, AR4–6, gas formulas); token scope (only facts the prompt offered; KPI tokens only in sustainability); prose → TipTap with `data` chips (bullets, report details as text, a typed `%` after a percent chip dropped); TipTap → prose with tokens so a rewrite keeps each existing chip's exact binding (sites, years, format).
  - `context.ts`: company (name, industry, one/several sites; no people, no emails), report (title, period, frameworks, look → tone), facts resolved by DS-2 (GHG: 17 metrics + categories 1–15 with value, prior and change tokens; unavailable ones listed without a token; sustainability: the design's KPIs), report details (all but `responsible_person`), brand voice (D11 default when empty). `displayToken` fills chat replies from approved data.
  - `prompts/common.ts` (rules, fencing `<untrusted name=…>`, rewrite and findings tasks, `PROMPT_VERSION = 1`), `prompts/ghg/index.ts` (exec summary, methodology, Scope 3 category, exclusion reasons, missing disclosures), `prompts/sustainability/index.ts` (leadership, about, target context, missing disclosures).
  - `actions.ts`: the registry (group, output, kinds, target rule, template slots). `runner.ts`: target checks → context → budget → call → log → zod → guard → one retry with the issues → `DS_AI_OUTPUT_INVALID {issues}`. Text suggestions carry `payload.text` and `payload.elements` (the target box with the new text, `source: 'ai'`, `reviewed: false`); with nothing selected a text action fills its template slot (e.g. `p04-exec_summary.summary`) or proposes a new body-text box on the page. Chart title and alt text → `kind: 'elements'`; checks → `kind: 'findings'` (unknown page ids dropped).
  - `chat.ts`: last 12 turns + selection; `matchIntent` maps the quick chips and common asks with no model call; anything else goes to the router model (`{reply, actions}` ≤ 3, only actions that fit the kind and selection); the reply is guarded and its tokens filled by the server. Chat never writes the doc.
  - `brief.ts`: `POST /studio/ai/brief {kind, brief}` → 2–3 proposals from the company's own templates (system + own company) and styles; chapters kept only when they name the template's pages; no figures go to the model.
  - `draft.ts`: the DS-5 build hook (`registerAiDraftHook`): GHG `exec_summary.summary` and `methodology.text`, sustainability `leadership.message` and `about.about`, each through the runner; a slot that fails keeps the template text; none written → the step fails with "template text kept".
  - `router.ts`: `POST /docs/:id/ai`, `POST /docs/:id/ai/chat`, `GET /docs/:id/ai/usage`, `POST /ai/brief` (role R; `company_id` stripped from bodies for Superadmins); one `router.use` in `src/studio/router.ts` (`// DS-9`).
- Tests: `ci/unit/ds-9-ai.test.cjs` (16: guard rejects literal figures in GHG text, allowlist, token scope, chips and rewrites, recorded answers, interpret, targets and slots, chat intents and router answers, reply filling, budget at the boundary, prices, brief proposals, the ai-narrative extraction byte for byte); `ci/api/tests/ds-9-ai.test.cjs` (15: migration twice, switch off / DS_ROLE / 401 on every route, tenant isolation and Superadmin, kind off, suggestion with chips and the doc unchanged, a call log row per call with tokens and cost, prompt fencing and no PII (emails, responsible person), retry then `DS_AI_OUTPUT_INVALID`, provider down, validation without a model call, chart title and findings, budget per doc USD/calls and per company month, chat chip without a router call, router with the last 12 turns and server-filled figures, brief, build hook); goldens `ci/golden/ds/ai/recorded/<action>.json` (group `ai`, one per `AI_ACTIONS`; built actions replay `ci/fixtures/studio/ai/recorded.json` through zod and the guard and render with the studio renderer; unbuilt ones record `built: false`), helper `ci/golden/ds/lib/ai.cjs`.
- Shared files touched: `src/studio/router.ts` (one line), `src/config/data-source.ts` (entity), `package.json` (`migrate:ds-9-ai`), `src/reporting/ai-narrative.ts` (client extraction only), `ci/api/run.cjs` (the server's studio AI points at `STUDIO_AI_STUB_PORT`, default API port + 1300; `// DS-9`), `ci/api/tests/ds-lib.cjs` and `ci/golden/ds/lib/routes.cjs` (`POST /ai/brief`), `ci/golden/ds/cases.json` (`ai/recorded` runs).

### Frontend files (ESG-lite_FE)
- `src/features/studio/ai/`: `AiPanel.tsx` (the AI drawer: "Ask AI", budget meter, "About: …" for the selection, brand voice note with Edit, thread with cards inline, quick chips by kind, ask box, "Design ideas from a brief"), `SuggestionCard.tsx` (title, "Suggested by AI", word diff with the server's chip values from `/studio/resolve`, old → new for titles and alt text, findings with "Go to page", "Based on", Accept / Try again / Discard, "Preview on page"), `DiffView.tsx`, `GhostPreview.tsx` (page overlay: dashed outline "Preview: not applied yet" while the editor previews the suggestion; keeps the editor API for toolbar items), `BudgetMeter.tsx`, `AiRewriteMenu.tsx` ("AI ▾" on the DS-7 text toolbar slot: Shorter, Longer, More formal, Plain English, In our brand voice, Suggest a headline), `BriefDialog.tsx` + `BriefButton.tsx` (design from a brief; Accept builds through DS-5 `POST /studio/docs` with AI text on and opens the editor), `store.ts` (thread per design, queued asks, ghost), `logic.ts` (apply a suggestion, word diff, quick chips, about line, sources, budget, error copy), `api.ts`, `register.ts`.
- Accept is the only doc change: one history step "AI: <title>", the element `source: 'ai'`, `reviewed: false` (DS-7's "Mark as reviewed" clears it). Discard and Preview never save.
- Shared files touched: `editor/plugins.ts` (`registerAiPlugins()`, `// DS-9`), `home/HomePage.tsx` (the "Design from a brief" button, `// DS-9`), `src/lib/studio/contracts.ts` (`// DS-9` request and brief shapes), `src/test/msw/studio.ts` (the DS-9 block: text actions answer for their target box, chat chips, `/studio/ai/brief`).
- Tests: `ai/logic.test.ts` (9), `ai/AiPanel.test.tsx` (5, MSW: about line and budget, chip → card with diff → Accept as one undo step and autosave, Discard and preview leave the doc unchanged, "AI ▾" opens a card, error copy, brief → build), `e2e/ds-9-ai.spec.ts` (Playwright: executive summary → diff → Accept → chips with the server's values saved as AI-written unreviewed; Discard → no save; switch off).

### Decisions and deviations
- **Target of a suggestion.** The `Suggestion` contract has no target field, so text suggestions also carry `payload.elements` (the changed box, by id); the FE applies by element id and puts a new box on the requested page. No contract change.
- **Chat routing.** Quick chips and common phrasings are matched in code (no router call, cheaper and testable); the router model handles the rest. Questions about figures are answered with tokens that the server fills in the reply string (the reply is plain text, so chips aren't interactive there).
- **`POST /studio/ai/brief`** is an addition outside 01-contracts §4 (design from a brief has no doc yet), listed in `ds-lib.cjs` and `routes.cjs` with the other module additions; awaiting a DS-0 contracts follow-up. Its budget is the company month only; its calls log `doc_id = null`.
- **Brief Accept** builds directly (DS-5 `POST /studio/docs`, synchronous build) with the latest closed FY, all sites and the kind's first framework; the proposal's `styleId` isn't applied by the build (DS-5 has no style input) and the chapters aren't used to drop pages yet.
- **No PII:** `responsible_person` is never sent to a model; user names and emails never are. Brand voice, page text, notes, the conversation and the brief are fenced as untrusted data, with closing tags broken up.
- **Tests never call a model:** the API suite's server talks to a recorded stub (`ci/api/run.cjs`), unit and golden tests replay recorded answers.
- **Superadmin per-company budget overrides** (RS-8) are not built: the D10 limits are constants.

### Not done
- Actions `draft_page`, `chart_kind`, `suggest_layouts`, `fill_page`, `cover_art` (DS-4's `/assets/generate` makes cover art), `suggest_style`, and `draft_report` as a single action (the build hook drafts the named slots instead); they answer `DS_VALIDATION "isn't available yet"` and the chat says layouts aren't available.
- Streaming build progress per page (the build step reports "AI wrote n of m texts").
- A dedicated report-wide FindingsPanel: findings show as cards in the thread with "Go to page".
- The ISO/BRSR-specific GHG prompts beyond missing disclosures; the manual eval on real client years (RS-8) before release.
- Per-company Superadmin budget overrides; prompt snapshot test of the full built context (the API test checks fencing and the absence of PII instead).
