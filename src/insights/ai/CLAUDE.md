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
