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

## IN-3 as built (backend)
- **`rules/`:** `facts.ts` (the `Facts` shape), `card.ts` (`card(...)`, `Rule`), `thresholds.ts` (every §6 number as a named constant, `RULE_WEIGHT` for ranking inside a severity, `displayPct`: 0 dp, 1 dp under 10, never −0), one file per rule (`decoupling.ts` … `pending_large.ts`, pure `(facts) => InsightCard | null`), `engine.ts`:
  - `collectFacts(scope, today?)`: summary, decoupling (5 years) and target wall through `panelResponse` (shared panel cache; a panel that isn't `ok` is null), Overview's gross / `by_category` / pending (`pending_review_count`, `pending_emission`, net), per-site scopes (IN-6's `scopesBySite`, two or more sites only), renewable share last year and this year (`sources/energy`), `/kpi/esg` pillars and movers (KPI on and set up only).
  - `runRules(facts, max = 6)`: every rule, ranked critical → attention → good → info, then `RULE_WEIGHT`.
  - **`ruleCards(scope, today?)`: the hook IN-9 wraps** (reword `text` only; keep params, link, panel).
- **`GET /insights/cards`** (`panels/cards.ts`, `buildCards`, one `router.use` line `// IN-3`): `CardsQuerySchema`, `ai` in the cache key; cards are `source: 'rule'`, `id` = the rule id; `links` maps card id → link.
- **Rule decisions** (within §6):
  - `intensity_change`: `change_pct` is the size of the move, severity gives the direction; it doesn't fire on a combined index over mixed production units.
  - `pathway_on_track`: `margin_pct` = how far below the pathway (0 on it).
  - `target_off_track`: KPI targets only (the SBTi items have their own pathway cards); `first_name` = the wall's worst item; link = that target when one, else `/kpi/targets`.
  - `site_concentration`: needs two or more sites; the largest share over the three scopes; `scope` is the number 1–3.
  - `coverage_gap`: after 9 months of the period have passed (`monthsPassed`, or the period has ended); the lowest pillar below 60 %; `missing` = values not filed.
  - `biggest_mover`: `/kpi/esg`'s first mover with a change ≥ 0.05 %, signed `change_pct`.
  - `pending_large`: pending tCO₂e ≥ 5 % of the approved net (any pending tCO₂e when net is 0).
  - `renewables_jump`: renewable share of electricity from emission rows (sources/energy), this year vs last year, +10 pp.
- **Goldens:** `ci/golden/in/rules/fixture.json` (a quiet facts object; each rule at its edge and just below; eight rules firing → the right six), run by `ci/unit/in-3-rules.test.cjs` (pure). The golden index lets a `run` suite name its own runner (the in-10 runner checks the file exists instead of a group).
- **Tests:** `ci/api/tests/in-3-cards.test.cjs` (envelope; largest_source and pending_large by hand from the API fixture; ≤ 6 and ordered; KPI off drops only the KPI rules; `?ai=1`; roles, site scope, tenant, switch-off); `ci/unit/in-3-rules.test.cjs`.
