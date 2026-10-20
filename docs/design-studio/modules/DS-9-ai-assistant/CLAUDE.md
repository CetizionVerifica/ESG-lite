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
