# Help assistant (AS)

"Ask ESGLite": an AI assistant inside ESGLite. It is built in steps, and each step adds tools without changing the design:

| Step | What it does | Data it reads | Status |
|---|---|---|---|
| **AS-1 Help** | Answers "how do I…" questions from ESGLite's own help articles, for the role asking. | None: only the articles, plus the page path the person is on. | Built (this folder) |
| AS-2 Data questions | Read-only lookups for Managers and Admins ("which sites haven't sent June?", "why is Scope 2 up?"), each answer linking to the screen. | Approved data, within the person's sites and role. | Not started: needs the boss's OK (client data goes to an outside AI service) |
| AS-3 Drafts | A User uploads a bill; the assistant fills a draft entry that the person checks and saves. | The bill, the form. | Not started |

The assistant never approves, rejects, edits, deletes or saves anything. A person does every change.

## Rules (all steps)
- **A1 · Never calculates.** Every number comes from the app's own calculation (`src/services/emissionWrite`, the reporting layer). The model only explains.
- **A2 · Sees what the person sees.** Same client, sites and role. Users get no factor values, method words, FERA / Category 3, well-to-tank or data quality (simple data entry, SE-1): their articles leave those out, and the prompt says so.
- **A3 · Per-client switch, off by default.** `company.assistant_enabled`, Superadmin only, audited (`audit_log` entity `assistant`). A Superadmin can always use it (no client budget).
- **A4 · Every call is logged** in `assistant_call`: who, role, page path, articles offered and used, model, tokens, cost, ok / error. Never the question or the answer.
- **A5 · Budget.** 40 model calls per person per UTC day; 15 USD per client per UTC month (`src/assistant/budget.ts`). Over it: 429 `AS_BUDGET {limit}`.
- **A6 · The person's words are data.** The question, earlier turns, page and form details go inside `<untrusted>` fences with closing tags broken up; the prompt says to ignore instructions inside them.
- **A7 · Answers are checked.** JSON only (`{answer, answered, sources}`), sources only from the articles offered, Markdown links only to app paths, no HTML. A bad answer is retried once, then 503 `AS_AI_UNAVAILABLE {reason: invalid_output}`.
- **A8 · Tests never call a model.** The API test runs a recorded stub on `STUDIO_AI_STUB_PORT`, like DS-9 and IN-9.

## AS-1 as built
**Backend (ESG-lite)** `src/assistant/`:
- `kb/*.md`: the help articles (front matter `id`, `title`, `roles`, `paths`, `keywords`; body ≤ 350 words, plain English, app links only). `kb/evals.json`: questions with the articles that should answer them (unit test: ≥ 90 % found in the top 4; role-blocked questions find none of that role's).
- `kb.ts`: loads and checks the articles; `searchKb` is word matching (title ×3, keyword phrases ×3, keyword words ×1.5, body ×1, +2 for the article about the current page, minimum 3), only the role's articles, top 4. No embeddings: small set, testable.
- `prompt.ts`: the rules (`PROMPT_VERSION` 1), fences, `parseReply` / `cleanAnswer`.
- `client.ts`: one OpenRouter call through `src/lib/openrouter.ts` in JSON mode. Model `ASSISTANT_AI_MODEL` (default the studio's drafting model, `anthropic/claude-sonnet-5.5`). Key `ASSISTANT_AI_API_KEY` → `STUDIO_AI_API_KEY` → `OPENROUTER_API_KEY`. Endpoint `ASSISTANT_AI_BASE_URL` → `STUDIO_AI_BASE_URL`. Time limit `ASSISTANT_AI_TIMEOUT_MS` (30 s).
- `chat.ts`, `router.ts`: `GET /assistant/status` → `{enabled, configured}` (any role; the FE shows the button only when both are true); `POST /assistant/chat {messages ≤ 12, last the person's, question ≤ 2000 chars, page?, form?}` → `{reply, answered, sources:[{id, title, path}]}`. Errors `AS_OFF` 403, `AS_VALIDATION` 400, `AS_BUDGET` 429, `AS_AI_UNAVAILABLE` 503.
- `budget.ts`, `switch.ts`, `http.ts`; entity `AssistantCall`; `Company.assistant_enabled`; `npm run migrate:as-1-assistant` (idempotent, run by `scripts/migrate-all.cjs`); the switch in `PUT /admin/companies/:id`.
- Tests: `ci/unit/as-1-assistant.test.cjs`, `ci/api/tests/as-1-assistant.test.cjs`.

**Frontend (ESG-lite_FE)**:
- `src/lib/assistant/`: contracts, API hooks, logic (request, small Markdown, error copy, starter questions, the thread in sessionStorage for the tab).
- `src/features/shell/components/assistant/`: the top bar button and the chat drawer (the shell owns it, like the bell).
- `src/features/clients/components/AssistantToggle.tsx`: Clients → client → Overview → **Help assistant**.

## Decisions needed (boss / Shyam)
1. Turn it on for which clients first (suggest: the test sites' client only).
2. The model and its cost: Sonnet by default (about 2 US cents a question); a cheaper model can be set with `ASSISTANT_AI_MODEL`.
3. Keep the questions people ask (text) to improve the articles? Today only ids and counts are kept (A4).
4. The articles: someone who knows each screen should read them once before clients see them.
5. Go-ahead for AS-2 (client data to an outside AI service; clients should be told).

## Adding or changing an article
1. Add `src/assistant/kb/<id>.md` with the front matter above. Users' articles must not mention factors, methods, FERA, WTT or data quality.
2. Add 1–2 questions for it to `kb/evals.json`.
3. Run `npm run build && node --test ci/unit/as-1-assistant.test.cjs`.
