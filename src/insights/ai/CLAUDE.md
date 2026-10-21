# IN-9 · AI wording for insight cards

> **Module spec**, lane L1. Copy to `ESG-lite/src/insights/ai/CLAUDE.md`.
> **PR titles:** `[IN-9 k/m]`, two PRs: 1. BE `insight_ai_call`, `ai/*`, `?ai=1` on `/insights/cards`; 2. FE toggle, `AiLabel`, "Show original".
>
> **Depends on:** IN-3 · **Owns:** `insight_ai_call`, `src/insights/ai/*`, FE AI toggle on `InsightCards`
> **Touches:** imports the OpenRouter helper (RS-8's shared helper if merged; otherwise a thin wrapper around `src/reporting/ai-narrative.ts`'s client with no change to that file)

## Job to be done
Let cards read more naturally and in the company's context, without ever changing a number or adding a claim.

## Build
### Backend
1. `migrate:in-ai-calls` creates `insight_ai_call` (`01-contracts` §5).
2. `ai/reword.ts`: for each card, prompt (`ai/prompts/card.md`, versioned) with rule id, a plain description of the rule, params as `{{v:key}}` names with display values, company display name and sector. Model per I13. Batch all cards in one call.
3. `ai/guard.ts` (zod): `{cards: [{id, text}]}`; each text ≤ 180 chars, contains every required token for its rule, no digits outside tokens, no URLs, no rule-unrelated nouns from a small blocklist (e.g. "guarantee", "certified"). Failing cards keep rule text.
4. `ai/budget.ts`: I14 limits; cache per (rule, params hash, stamp). Over budget → `IN_AI_BUDGET` is logged and the response silently returns rule text with `source: 'rule'`.
5. `/insights/cards?ai=1`: cards with valid AI text get `source: 'ai'` and `text`. FE substitutes tokens from `params`.

### Frontend
1. A "Natural wording" toggle on the cards header (remembered per user in local storage, default off).
2. AI cards show `AiLabel` and "Show original" (rule copy).

## Tests
- **Unit:** guard rejects digits outside tokens, missing tokens, long text; token substitution.
- **API:** roles, switch-off, budget fallback, logging per call, AI down → rule text and 200.
- **Golden (`ci/golden/in/ai/`):** recorded model responses replayed (no live calls in CI).

## Done when
AI wording never changes a number or link, always falls back cleanly, and every call is logged and budgeted.

## IN-9 as built (backend)
- **Table** `insight_ai_call` (`migrate:in-ai-calls`, `src/scripts/migrateInAiCalls.ts`, entity `InsightAiCall`, registered `// IN-9` in `src/config/data-source.ts`): §5 columns, all nullable but `id`/`created_at`; index `(company_id, created_at)` for the budget. One row per model call: `card_rule` = the batch's rule ids comma-joined (cut to 40), model, tokens, cost, `ok` (false: provider error; true: an answer came back, whatever the guard then kept). Never any text.
- **`ai/reword.ts` `rewordCards(scope, cards, stamp)`**: one batched OpenRouter call (`src/lib/openrouter` `openRouterChat`, unchanged) for the cards not cached; JSON mode, temperature 0.3. Model `INSIGHTS_AI_MODEL` else `google/gemini-3-flash-preview` (I13). Key `INSIGHTS_AI_API_KEY` → `STUDIO_AI_API_KEY` → `OPENROUTER_API_KEY`; base URL `INSIGHTS_AI_BASE_URL` → `STUDIO_AI_BASE_URL` (so `ci/api/run.cjs` needed no change: tests run a stub on `STUDIO_AI_STUB_PORT`). Cost = OpenRouter's `usage.cost`, else the studio price table (`src/studio/ai/prices.ts`, read only). Cache per (prompt version, rule, params, stamp), 10 min, rejected wordings cached as "keep the rule text" so a bad answer isn't paid twice; provider errors aren't cached. No key → rule text, no call, no row.
- **`ai/guard.ts`**: zod `{cards:[{id, text}]}`; per card ≤ 180 chars, one line, every required token (`RULES[rule].params` **without `link`** — a route, never prose; deviation: `pending_large` only needs `{{v:count}}`), no token outside the rule's params, no digit / URL / markup / stray `{{` outside tokens, blocklist (guarantee, certified, compliant, verified, audited, assured, best, world-class, promise …). Anything failing keeps the rule text (`source: 'rule'`).
- **`ai/budget.ts`** (I14): this UTC month's rows per company; over at 2,000 calls or $10 → `IN_AI_BUDGET` logged (console, company id only), no call, rule text, HTTP 200.
- **`ai/prompts/card.ts`** (deviation: TypeScript, not `card.md`, because `tsc` doesn't copy `.md` into dist): `CARD_PROMPT_VERSION`, `RULE_DESCRIPTIONS` (plain words per rule), `CARD_SYSTEM`, `cardUserPrompt` (company name and `company.industry` as sector, then per card id, rule + description, tokens with display values). Nothing else reaches the model.
- **`GET /insights/cards?ai=1`**: `panels/cards.ts` wraps IN-3's `ruleCards` with `rewordCards` (two lines `// IN-9`); params, links, order and panel stay as the rule cards'. `?ai=1` was already in the panel cache key.
- **Tests:** `ci/unit/in-9-ai.test.cjs` (recorded answers through the guard, every rejection reason, required tokens, substitution, budget limits, prompt contents) — the `ai` golden suite's runner; `ci/api/tests/in-9-ai.test.cjs` (stub model: accepted wording and the request's contents, one log row with tokens and cost, cache hit with no second call, rejected answer, provider down, budget by calls and by dollars, roles, tenant, switch-off, migration twice). `ci/golden/in/ai/recorded.json` holds the recorded answers.
