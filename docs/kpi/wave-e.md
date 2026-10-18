# KPI wave E · ESG pillars (E / S / G) and the ESG dashboard

Shyam asked for this on 2026-10-18:
> "Classify each KPI or topic into Environment, Social, and Governance to create a ESG dashboard for manager with user friendly and interactive graphs for tracking the KPIs on broader level. And also in superadmin and admin classify the topics into E,S and G."

This file is binding for wave E. When wave E is built, add D19 to `docs/kpi/04-decisions.md` and add the new endpoint to `01-contracts.md` §3.

## D19 · Every topic and KPI belongs to one ESG pillar

**Pillars** are a new contract enum, `KPI_PILLARS = ["environment", "social", "governance"]`. Their labels are "Environment", "Social" and "Governance". Their short letters are E, S and G.

**Default pillar per topic** (`TOPIC_PILLAR`, in `src/kpi/contracts/`):

| Pillar | Topics |
|---|---|
| Environment | climate, energy, water, waste, pollution, biodiversity, materials |
| Social | workforce, health_safety, diversity, training, human_rights, community, customers |
| Governance | governance, ethics |

**Per KPI.** Add a new column, `kpi_definition.pillar` (varchar(20), not null), through an additive, idempotent migration (`migrate:kpi-pillars`).
- When the column is added, it is backfilled from `TOPIC_PILLAR[topic]`.
- The library seed sets it the same way for new KPIs and keeps any value a Superadmin edited (the seed already respects `edited_at`).
- A KPI's pillar defaults to its topic's pillar. Only a Superadmin may change a library KPI's pillar, through `PUT /kpi/library/definitions/:id {pillar}`; this is the override for an edge case.
- An Admin or Superadmin choosing a custom KPI (`POST /kpi/setup/custom-kpis`) may set the pillar. If they don't, it defaults from the topic.

**Where the pillar is shown.** Every KPI row the API returns carries `pillar`:
- the library, catalogue and setup `kpis`;
- `topics_in_use` (one pillar per topic, taken from `TOPIC_PILLAR`);
- `/kpi/my` items;
- dashboard cards;
- values (`pillar` on value rows, where they carry the KPI name).

## The ESG dashboard

**Route:** `/kpi/esg`, titled "ESG dashboard". Managers (their sites), Admins and Superadmins (with the client picker) can open it. It sits in the KPIs nav group as the first item for Manager, Admin and Superadmin, and in the command palette. It's switch-gated like every KPI page.

**API:** `GET /kpi/esg?year=&site=&pillar=&topic=` is open to Manager, Admin and Superadmin; a User gets `KPI_FORBIDDEN`. It reads approved values only, uses the server's numbers, and applies D17's expected-sites rule. It answers:
```
{ year, year_type, label, filters,
  pillars: [{ pillar, label, kpis, approved, pending, missing, not_due, coverage_pct,
              change: { approved_pct_vs_last_year },
              topics: [{ topic, label, kpis, approved, pending, missing, coverage_pct }] }],
  trends: [{ pillar, topic, kpi_definition_id, code, name, unit, decimals, direction_good: "down"|"up"|null,
             series: [{ period, period_start, label, value }], value, previous, change_pct,
             target: { progress_pct, status, label, value, year } | null }],
  sites: [{ site_id, name, pillars: { environment, social, governance } }],
  movers: [{ kpi_definition_id, name, pillar, change_pct, direction_good, good: boolean }],
  pending_not_in: { count, link } }
```
- In `sites[].pillars`, each value is a coverage %, or null when nothing is expected at that site.
- `trends` holds the headline KPIs per pillar: a fixed headline list per topic in `src/kpi/esg/headlines.ts`, taken only from KPIs the company selected, at most 4 per pillar. Examples:
  - **Environment:** GHG Scope 1+2, total energy, water withdrawn, waste generated.
  - **Social:** employees, LTIFR, women in workforce %, training hours per employee.
  - **Governance:** women on board %, ethics complaints.
  - Each series has 12 points: the monthly values of the year, or the yearly values of the last 5 years for annual KPIs.
- `movers` holds the 5 largest year-on-year changes. `good` comes from `direction_good`; the headline list sets the direction (for example, energy down is good).

## The dashboard screen

It must be user friendly and interactive. Follow the dataviz rules: one axis, a legend whenever there are 2 or more series, a tooltip on hover, a table view or an aria label for each chart, and thin marks.

1. **Header and filters.** The header has the year, the site and the pillar chips (All · E · S · G). Every filter lives in the URL.
2. **Pillar cards.** Three cards, E, S and G:
   - each shows a coverage ring, "34 of 40 KPIs approved", the missing and pending counts, and the change on last year;
   - clicking a card filters the whole page to that pillar, and clicking it again clears the filter;
   - each card carries its letter badge as secondary encoding, so the cards are never told apart by colour alone.
3. **Topic coverage.** A horizontal bar chart of coverage % per topic, grouped under pillar headings.
   - Hovering shows "Water · 5 of 6 approved · 1 missing".
   - Clicking a bar opens a **topic drawer**. It lists that topic's KPIs with value, unit, change, a sparkline and status. It links to review for pending items and to the gaps list for missing ones.
4. **Headline trends.** Small multiples, one line chart per headline KPI, grouped by pillar.
   - Hovering shows a crosshair and a tooltip. A target is drawn as a dashed reference line when one exists.
   - The change chip reads good or bad by `direction_good`, with an arrow and a word, never colour alone.
5. **Sites × pillars.** A heat table of coverage % (sequential, one hue, light to dark), with values printed in the cells. Clicking a cell sets the site and pillar filters.
6. **Biggest movers.** A list of the top 5, each with its pillar badge.
7. **Pending banner.** "N values pending review aren't in these figures", linking to review.
8. **States.** Empty states with plain words, including "Choose a client" for a Superadmin. Loading skeletons and error states with retry. Every page passes at 390px. Light and dark plus the four app themes.

**Pillar colours** were validated with the dataviz palette validator and pass every check in both modes. Add them as theme tokens `--t-pillar-e/s/g`, with the same values in every theme's light or dark set:

| | Environment | Social | Governance |
|---|---|---|---|
| Light | `#00927a` | `#6e56cf` | `#c2621a` |
| Dark | `#1fa68c` | `#8a74e0` | `#c87533` |

Text keeps text tokens; colour marks the identity only.

## Classifying in Superadmin and Admin screens

**Superadmin KPI library (`/setup/kpi-library`)**
- The KPIs tab gets pillar filter chips (E / S / G) and a pillar badge on each row.
- Topics are grouped under Environment / Social / Governance headings.
- The KPI drawer gets a **Pillar** select. It defaults to the topic's pillar and shows a "Differs from its topic (Water → Environment)" note when it is overridden.

**Admin and Superadmin KPI setup (`/kpi/setup`)**
- **Step 3 (KPIs):** group by pillar first (E / S / G sections, each with a count of selected KPIs), then by topic.
- **Step 4 (By topic grid):** rows grouped under pillar headings.
- **Custom-KPI drawer:** a Pillar select that defaults from the chosen topic.
- **The settled-setup tabs:** same as the steps above.

**Everyone else**
- The regular KPI dashboard cards and My KPIs topic headings get a small pillar letter badge (E, S or G).
- The KPI-10 dashboard gets a link "See the ESG dashboard".

## Tests
- **API:**
  - the migration backfill, run twice;
  - the pillar override (Superadmin only) and that a custom KPI's pillar defaults from its topic;
  - `/kpi/esg` figures, worked out by hand on a fixture;
  - approved-only, expected sites and roles;
  - tenant isolation and switch off;
  - the D18 parity walk including the new route.
- **Unit:** the `TOPIC_PILLAR` total (each topic in exactly one pillar), plus the headline list and its directions.
- **Frontend:**
  - unit tests for the grouping logic;
  - Playwright for the pillar card filter, a topic bar opening the drawer, the heat-table cell filter, the library pillar edit, the setup grouping, the Superadmin client picker, switch off and 390px.
