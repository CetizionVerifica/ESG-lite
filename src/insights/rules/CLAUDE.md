# IN-3 · Insight cards: rule engine and cards

> **Module spec**, lane L1. Copy to `ESG-lite/src/insights/rules/CLAUDE.md`.
> **PR titles:** `[IN-3 k/m]`, two PRs: 1. BE engine, rules, `/insights/cards`; 2. FE `InsightCards`, `cardCopy.ts`, panel sentence slots.
>
> **Depends on:** IN-2 (and reads IN-4/IN-5 panels when merged) · **Owns:** `src/insights/rules/*`, `GET /insights/cards`, FE `components/InsightCards.tsx`, `src/lib/insights/cardCopy.ts`
> **Touches:** —

## Job to be done
Turn the numbers into a few true sentences a Manager can repeat in a meeting, each with a way to see the evidence.

## Build
### Backend
1. **`engine.ts`:** builds a `facts` object by calling the panel functions (cached) for the same scope: summary, decoupling, target wall, ESG (movers, coverage), pathway (if merged), plus `byCategory` / `bySite` from sources. Runs every rule, drops nulls, ranks by severity (critical → attention → good → info) then rule weight, keeps 6.
2. **Rules** one file each per `01-contracts` §6, pure `(facts) => InsightCard | null`. `params` hold display-ready values: percentages rounded to 0 dp (1 dp when < 10), names as stored. `link` and `panel` set per rule.
3. **`thresholds.ts`:** all numbers from §6 as named constants (I12).
4. **`GET /insights/cards`** → `Cards`. A rule whose source panel is `kpi_off` or `no_data` simply doesn't fire.

### Frontend
1. **`cardCopy.ts`:** `RuleId → (params) => string` templates from §6, plain words per `05-ux` §7. Unit-tested for every rule.
2. **`InsightCards`:** up to 6 cards in a wrapping grid: severity chip (icon + word), sentence, "Show" (sets `?panel=` → pulse) and "Open" (`link`). Empty state: "No standout changes this period."
3. **Panel sentence slots:** Decoupling shows the `decoupling` card's sentence above the chart; Pathway (IN-4) shows `pathway_gap` / `pathway_on_track`.

## Golden cases (`ci/golden/in/rules/`)
One fixture per rule at the firing edge and just below it; the ranking with 8 firing rules keeps the right 6.

## Tests
- **Unit:** every rule fires / doesn't fire at thresholds; engine ranking; copy templates.
- **API:** roles, scope, switch-off; `kpi_off` drops KPI rules only.
- **Playwright:** a card's Show scrolls and pulses its panel; Open navigates.

## Done when
Every rule is covered by a golden at its edge, the cards render with working links, and no card text contains a number the API didn't send.
