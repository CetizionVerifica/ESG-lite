# AT-1 · AI template suggestions in the new-report flow

> Plan: `01-pro-editing-and-ai-templates.md` §2A and §3 (this folder); mockup `canvas/project/AiTemplates.dc.html`; contracts `PRO-0.md` (`TemplateSuggestBody`, `TemplateSuggestResponse`, `TemplateSuggestModelOutputSchema`).
> Owner decision **E2**: the AI may see template names/descriptions and the company's free-text brief, fenced as untrusted data; no PII, no figures, coverage counts only.

## What it does

`POST /studio/templates/suggest` (role R: Admin, Manager, Superadmin; behind `requireDesignStudio`):

1. **Rules (deterministic).** The kind's templates (system + the caller's company, active; DS-4 `listTemplates`), the requested `format`, and the template purposes that fit the brief's purpose (`ghg_inventory` / `sustainability_report` → report; `board_brief` → deck, summary; `site_fact_sheet` → summary, social; when none fits, the format's templates stay). One template per family: the look the tone prefers (formal → Classic, plain → Light, engaging → Night). Rule fit 0..100: purpose 40, length 30 (page count against about 2/20/40 pages), frameworks 20 (the brief's frameworks, limited to the frameworks the company switched on for sustainability), audience 6, tone look 4. A purpose of the other kind or a framework of the other kind → `DS_VALIDATION`.
2. **Data readiness (counts only).** Company facts for the period and sites: Scope 3 categories with approved data and excluded ones (DS-5 `loadGhgReadiness`), months with approved Scope 1/2 rows (a yearly approved row covers every month), KPI coverage per framework (DS-5 `loadSustainabilityReadiness`), KPI targets set, base year set. Per template (up to 6 families), its doc assembled for the brief's period (DS-5 `assembleDoc`) is resolved by DS-2 (`resolveForBuild`) and DS-5 `emptyDataPages` says which data pages would print "Not reported" — the same rule the build uses. Units = data-bound pages + each category of a `scope3_categories` flow; score = share with data; level ready ≥ 85, partial ≥ 50, else low. Badges: `scope12_months`, `scope3_categories`, `kpi_coverage` (per framework), `targets`, `base_year`, each with `have/of`, a status and the pages it leaves empty.
3. **AI order.** Rule order = 60 % rule fit + 40 % readiness. The top five go to the model (group `drafting`) with names, descriptions, page ids and names, layout slugs it may add, the badges' labels and the brief (enums as words; the note fenced as `<untrusted name="brief_note">`). No company name, people, emails or figures: company-written text (the note, a company template's name, description and page names) passes `scrubPromptText` first, which replaces emails (`[email]`), phone numbers (`[phone]`), the company's and brand kit's names ("the company") and figures (money, numbers with units, decimals, thousands, long numbers → `[figure]`); years, framework codes and small counts stay. The answer is guarded (`suggest/rules.ts readPicks`): zod (`TemplateSuggestModelOutputSchema`), ids must be candidates, no duplicate, no tokens, the literal-number rule (DS-9 `literalNumberIssues`) with only the offered counts and the period's years allowed; unknown page ids and layout slugs are dropped. One retry with the issues; then rule order with `aiUsed: false` and no reasons. Over budget (company month, DS-9 `assertBudget(company, null)`) or provider down → rule order, no error. Every model call logs a `report_ai_call` row (`action = 'suggest_templates'`, `doc_id` null).
4. **Answer.** Up to 3 `TemplateSuggestion`s: the AI's picks first, then the rule order fills the rest (no reasons); `considered` = templates of the kind the rules looked at.

FE (`/studio/new`, step 1): **Browse all | Help me choose**. The brief (purpose chips for the kind, standards, audience, length, tone, "Anything else?" ≤ 500 characters), "Suggest templates", then the cards: cover drawn by the renderer in the brand kit (as the Templates drawer), Best fit / readiness level badges, reasons, readiness badges, "Could leave out / Could add", **Preview with my data** (a drawer paging through the template's free-form pages in the flow's year, year type and sites with `/studio/resolve` values) and **Use this** (selects the template and moves to Scope). `aiUsed: false` shows "Ordered by our rules". Errors use the `suggestApi.ts` copy and offer "Browse all templates".

## As built (2026-10-20, branch `at-1-template-suggest` in ESG-lite and ESG-lite_FE, local only, based on `ds-pro/local`)

### Files
**ESG-lite**
- `src/studio/suggest/rules.ts` (new, pure): brief checks, rule shortlist and fit, template frameworks, data units, readiness scoring and badges, ranking, offered numbers, the model-answer guard, `scrubPromptText` (prompt hygiene, E2).
- `src/studio/suggest/service.ts` (new): facts (counts), per-template resolve + empty pages, layout slugs, prompt, model loop with budget and log, the response.
- `src/studio/suggest/router.ts`: replaces the PRO-0 stub (same mount line in `src/studio/router.ts`).
- Tests: `ci/unit/ds-pro-at1-suggest.test.cjs` (10), `ci/api/tests/ds-pro-at1-suggest.test.cjs` (9: switch off and roles, rules and readiness against `/studio/readiness`, AI re-order with fenced prompt (a closing tag in the note can't end the fence) / no emails / no company or brand name / no figures from the note and none of the company's approved totals / one log row, invalid twice → rule order, one retry, provider down, budget used up without a model call, tenant isolation and Superadmin, kind off and validation, sustainability with KPI tracking on).

**ESG-lite_FE**
- `src/features/studio/new/HelpMeChoose.tsx` (brief + cards), `SuggestPreview.tsx` (paged preview drawer), `suggestLogic.ts` (+ `suggestLogic.test.ts`, 4), `HelpMeChoose.test.tsx` (4, MSW: brief → cards → Use this → Scope and the template selected in Browse all; AI off; preview with `/resolve`; error copy and Browse all).
- `NewDesignPage.tsx`: `TemplateStep` hosts the toggle; the old gallery is `BrowseTemplates` (unchanged behaviour); `// AT-1` markers.

Shared files touched (backend): none beyond `src/studio/suggest/router.ts` (the module's own stub) and `NewDesignPage.tsx` (owned by DS-5, small marked edits). No contract, renderer, migration, `package.json` or MSW change.

### Deviations
1. **No new table or migration**: suggestions aren't stored; the call log is DS-9's `report_ai_call`.
2. **Readiness by resolving the template**, not by a page-kind lookup table: DS-2 says per page whether anything resolves (the build's own rule), so "Not reported" counts match what a build would leave out. It costs one resolve per candidate family (≤ 6).
3. **KPI coverage badges** use `have` = coverage percent and `of` = 100 (the KPI dashboard gives percent per framework, not counts).
4. **Budget**: there is no doc yet, so only the company's month limit applies (as DS-9's design from a brief); over budget answers rule order instead of 429 (the contract's `aiUsed: false` case). The FE shows no budget meter on this step (the meter is per doc).
5. **Brief purposes** are filtered to the chosen kind on the FE (the mockup shows all four); a purpose of the other kind is `DS_VALIDATION` on the server.
6. **Preview** shows free-form pages only; contents, index and Scope 3 category flows are laid out by the build. Placeholders are filled with the brand kit's company name.
7. **Prompt hygiene beyond the plan**: the plan only fences the note; the server also scrubs emails, phones, the company's names and figures from the note and from a company template's own texts, so a user typing them can't leak them to the model (E2 "no PII, no figures").
8. The FE doesn't send `format` (the purpose already narrows decks and one-pagers); the server supports it.

### Not done
- Applying `pagesToDrop` / `pagesToAdd` to the build (DS-5 `POST /docs` has no page selection input); they are shown on the card only.
- A Playwright spec for the Help me choose path (covered by the vitest MSW test and the API test).
- A golden of recorded model answers for `suggest_templates` in `ci/golden/ds/ai/recorded/` (the action isn't in `AI_ACTIONS`).

### Tests run
- 2026-10-20 (`7c8178b`, `423866b`): written, not run (the branch was paused, tip "WIP: paused for cloud move").
- 2026-10-21, finished in the cloud worktree (ESG-lite only; the FE half of the branch isn't in this environment, so `HelpMeChoose`/`suggestLogic` vitest and the FE contract check weren't run here):
  - `npm run build`: ok.
  - `npm run test:unit`: 647 tests, 635 pass, 0 fail, 12 skipped (baseline 625 pass) (ds-pro-at1: 10/10).
  - `npm run test:api` (fresh throwaway DB): 791 tests, 784 pass, 0 fail, 7 skipped (baseline 775 pass) (ds-pro-at1: 9/9; ds-pro-0-contracts: 3/3, the AT-1 route now answers for real).
  - `npm run test:ds-golden` (fresh DB): 423 run, 423 matched, 0 failed, 2 skipped (Chromium not installed).
