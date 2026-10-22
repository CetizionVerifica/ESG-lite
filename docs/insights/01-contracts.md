# 01 · Contracts

The single source for enums, panel response shapes, tables, API, error codes, insight rules and FE routes.
- **Backend:** `ESG-lite/src/insights/contracts/` (`enums.ts`, `schemas.ts` (zod queries and bodies), `panels.ts` (response types), `errors.ts`, `rules.ts`).
- **FE mirror:** `ESG-lite_FE/src/lib/insights/contracts.ts`.
- Changes go through an IN-0 follow-up PR first.

## 1. Enums

```ts
PanelId        = 'summary' | 'esg_ring' | 'decoupling' | 'target_wall' | 'cards' | 'pathway'
               | 'completeness' | 'bridge' | 'flow' | 'materiality' | 'stripes' | 'site_compare'
Availability   = 'ok' | 'kpi_off' | 'no_data' | 'setup_incomplete'
TargetStatus   = 'on_track' | 'at_risk' | 'off_track' | 'reached' | 'no_data'   // at_risk: behind expected by ≤ I6 threshold
TargetSource   = 'sbti' | 'kpi'
Pillar         = 'environment' | 'social' | 'governance'          // = KPI_PILLARS (D19)
Driver         = 'activity' | 'intensity_s1' | 'energy_intensity_s2' | 'grid_and_renewables_s2' | 'scope3' | 'other'
EventKind      = 'initiative' | 'acquisition' | 'divestment' | 'method_change' | 'disruption' | 'other'
CardSeverity   = 'good' | 'info' | 'attention' | 'critical'
CardSource     = 'rule' | 'ai'                                    // ai = reworded by IN-9, still from a rule
Period         = { year: number, yearType: 'CY' | 'FY' }          // as /kpi/esg and Overview CY/FY
SiteFilter     = 'all' | number[]
```

## 2. Common query and envelope

**Query (every panel):** `?year=2026&yearType=CY&sites=all|1,2&pillar=&compare=prior|base` (zod `InsightsQuerySchema`).
- `sites` outside the caller's scope → 404 `IN_SITE_NOT_FOUND` (same as KPI-10 `dashboardScope`).
- `company_id` is required for a Superadmin and ignored for others.

**Envelope (every panel response):**
```ts
PanelResponse<T> {
  panel: PanelId
  availability: Availability          // not 'ok' → data is null and the FE shows the matching state
  reason?: string                     // plain words for the empty state
  period: Period, sites: SiteFilter, label: string   // "CY 2026 · All sites"
  data: T | null
  pending_not_in: { emissions: number, kpi_values: number, link: string | null }
  stamp: string                       // data stamp used for the cache key and ETag
  links: Record<string, string>       // drill-down targets, keyed by element id
}
```

## 3. Panel data shapes

```ts
// IN-1 · GET /insights/summary
Summary {
  net:        { value: number, unit: 'tCO2e', prior: number | null, change_pct: number | null, good: boolean | null }
  pathway:    { status: TargetStatus, gap_pct: number | null, target_year: number | null } | null   // null: no SBTi setup
  intensity:  { value: number | null, unit: string, combined: boolean, change_pct: number | null, good: boolean | null }
  readiness:  { pct: number, by_pillar: Record<Pillar, number | null> } | null   // null when KPI tracking off; a pillar with nothing counted is null (IN-1 follow-up)
  attention:  { total: number, items: { kind: 'approvals'|'kpi_gaps'|'off_track'|'missing_submitters'|'threshold', count: number, link: string }[] }
  renewable_share_pct: number | null   // IN-1 follow-up: hero cell 3 when KPI tracking is off (renewable kWh ÷ electricity kWh)
}

// IN-2 · GET /insights/esg-ring       (kpi_off when KPI tracking off)
EsgRing { pct: number, pillars: { pillar: Pillar, label: string, kpis: number, approved: number, coverage_pct: number,
          topics: { topic: string, label: string, kpis: number, approved: number, coverage_pct: number, auto_share: number }[] }[] }
          // auto_share: share of the topic's KPIs filled from data (KPI-5) — the "joined" signal

// IN-2 · GET /insights/decoupling
Decoupling { base_year: number, years: number[],
             series: { key: 'output'|'emissions'|'intensity', label: string, index: (number|null)[], raw: (number|null)[], unit: string }[],
             combined_output: boolean, decoupled: boolean,              // decoupled: output index ↑ and emissions index ↓ vs base
             headline: { output_change_pct: number, emissions_change_pct: number, intensity_change_pct: number } }

// IN-2 · GET /insights/target-wall
TargetWall { items: { id: string, source: TargetSource, pillar: Pillar, name: string, unit: string,
                      progress_pct: number | null, expected_pct: number | null, status: TargetStatus,
                      baseline: { year: number, value: number }, target: { year: number, value: number },
                      latest: { year: number, value: number } | null, direction_good: 'down'|'up', link: string }[] }
             // sorted: off_track, at_risk, on_track, reached, no_data; then by (expected − progress) desc

// IN-3 · GET /insights/cards
Cards { cards: InsightCard[] }      // at most 6, ranked by severity then rule weight
InsightCard { id: string, rule: RuleId, severity: CardSeverity, source: CardSource,
              params: Record<string, number | string>,   // values the copy template needs; numbers already rounded for display rules
              text?: string,                              // only when source = 'ai'; contains {{v:key}} tokens only
              link: string | null, panel?: PanelId }      // panel: which panel to scroll to and highlight

// IN-4 · GET /insights/pathway
Pathway { base_year: number, target_year: number, annual_rate_pct: number, years: number[],
          pathway: number[], actual: { s1: (number|null)[], s2: (number|null)[], s3: (number|null)[] },
          levers: { key: 'renewable_share'|'energy_intensity', label: string, unit: '%'|string, values: (number|null)[] }[],
          gap_band: { year: number, gap: number }[], events: EventRef[] }

// IN-4 · GET /insights/completeness
Completeness { months: string[],                    // 'YYYY-MM' of the period
               rows: { site_id: number, site: string,
                       cells: { month: string, pct: number | null, emissions_expected: number, emissions_approved: number,
                                kpi_expected: number, kpi_approved: number, link: string }[] }[] }

// IN-5 · GET /insights/bridge?compare=prior|base
Bridge { from: { year: number, value: number }, to: { year: number, value: number },
         steps: { driver: Driver, label: string, value: number, inputs: Record<string, number> }[],   // Σ steps = to − from exactly
         method: 'lmdi_additive', notes: string[] }

// IN-6 · GET /insights/flow
Flow { nodes: { id: string, label: string, column: 0|1|2|3, kind: 'site'|'scope'|'kpi'|'disclosure'|'category' }[],   // 'category': KPI off, top categories (IN-6 follow-up)
       links: { source: string, target: string, value: number, measure: 'tCO2e'|'count', fit?: 'exact'|'partial'|'derived' }[] }
       // columns 0→1→2 carry tCO2e; 2→3 carries count (I9)

// IN-7 · GET /insights/materiality       (kpi_off when KPI tracking off)
Materiality { scored: boolean,       // false → topics listed without positions, plus a link to add scores
              points: { esrs_topic: string, label: string, impact: number|null, financial: number|null,
                        weight: number, status: TargetStatus, kpis: number, on_track: number, off_track: number, link: string }[] }

// IN-8 · GET /insights/stripes
Stripes { months: string[], values: (number|null)[], unit: 'tCO2e', min: number, max: number }

// IN-11 · GET /insights/site-compare     (the Sites tab; panel id site_compare, as /insights/sites is the header chips)
SiteCompare { rows: { site_id: number, site: string,
                      net: number,                    // Overview by_site net
                      prior: number|null,             // Overview last_year.by_site net; null while last year isn't due
                      change_pct: number|null, good: boolean|null,   // Overview by_site net_vs_last_year_pct; good when it fell
                      share_pct: number|null,         // site net ÷ scope net
                      scope_1: number, scope_2: number, scope_3: number,
                      intensity: { value: number|null, unit: string|null, change_pct: number|null, good: boolean|null },
                      completeness_pct: number|null,  // Completeness tab counts summed over the months started
                      pending: number,                // Overview by_site pending
                      link: string }[] }              // /overview?period=…&siteIds=…; rows by net desc, then site_id

EventRef { id: number, date: string, label: string, kind: EventKind, site_id: number | null }
```

**Rules for every shape:**
- Numbers are raw (unrounded) except `params` in cards; the FE formats with `src/ui/format.ts`.
- `null` means "no data", never zero. A missing year is `null` in the series.
- Every percentage is a number of percent (12.5 means 12.5 %), never a fraction.

## 4. API

All under `/insights`, behind `authenticate` → `requireInsights`. Roles: M = Manager (own sites), A = Admin, S = Superadmin (with `company_id`).

| Method | Path | Roles | Module | Notes |
|---|---|---|---|---|
| GET | `/insights/status` | M A S U | IN-0 | `{enabled, kpi_tracking}`; no switch check (for the nav) |
| GET | `/insights/sites` | M A S | IN-0 | `{sites:[{site_id, name}]}`, the caller's sites for the header chips (IN-0 addition, works without KPI tracking) |
| GET | `/insights/summary` | M A S | IN-1 | |
| GET | `/insights/esg-ring` | M A S | IN-2 | KPI |
| GET | `/insights/decoupling` | M A S | IN-2 | `?years=5` (default 5, max 10) |
| GET | `/insights/target-wall` | M A S | IN-2 | KPI targets only when KPI on |
| GET | `/insights/cards` | M A S | IN-3 | `?ai=1` (IN-9) |
| GET | `/insights/pathway` | M A S | IN-4 | needs SBTi base year; `no_data` otherwise |
| GET | `/insights/completeness` | M A S | IN-4 | |
| GET | `/insights/events` | M A S | IN-4 | `?from=&to=` |
| POST | `/insights/events` | M A S | IN-4 | `{date, label (≤ 60), kind, site_id?}`; Manager only for own sites |
| PATCH | `/insights/events/:id` | M A S | IN-4 | creator, Admin or Superadmin |
| DELETE | `/insights/events/:id` | M A S | IN-4 | same |
| GET | `/insights/bridge` | M A S | IN-5 | `?compare=prior|base` |
| GET | `/insights/flow` | M A S | IN-6 | KPI part only when KPI on |
| GET | `/insights/materiality` | M A S | IN-7 | KPI |
| GET | `/kpi/setup/materiality-scores` | M A S U | IN-7 follow-up | `{topics:[{esrs_topic, label, material, impact_score, financial_score}]}`; the KPI setup scores block reads here, so it works without Design Studio |
| PUT | `/kpi/setup/materiality-scores` | A S | IN-7 | `{topics:[{esrs_topic, impact_score, financial_score}]}` (shared with RS-2) |
| GET | `/insights/stripes` | M A S | IN-8 | last 72 months max |
| GET | `/insights/snapshot.pdf` | M A S | IN-8 | same query; streamed; 60 s limit |
| GET | `/insights/site-compare` | M A S | IN-11 | the Sites tab; works without KPI tracking (completeness counts KPIs only when KPI is on) |

## 5. Tables and columns

```
company.insights_enabled            boolean not null default false               (IN-0, migrate:in-switch)

insight_event                                                                     (IN-4, migrate:in-events)
  id serial pk, company_id int not null, site_id int null, date date not null,
  label varchar(60) not null, kind varchar(20) not null, created_by int not null,
  created_at timestamptz default now(), updated_at timestamptz default now()
  index (company_id, date)

company_material_topic.impact_score     numeric(3,1) null check 0..10             (IN-7 or RS-2, migrate:rs-materiality-scores)
company_material_topic.financial_score  numeric(3,1) null check 0..10

insight_ai_call                                                                   (IN-9, migrate:in-ai-calls)
  id serial pk, company_id int, user_id int, card_rule varchar(40), model varchar(80),
  tokens_in int, tokens_out int, cost_usd numeric(8,4), ok boolean, created_at timestamptz
```

## 6. Insight rules (IN-3)

Each rule is a pure function `(facts) => InsightCard | null` in `src/insights/rules/<id>.ts`, reading only panel data already computed. Thresholds live in `rules/thresholds.ts` (I12).

| RuleId | Fires when | Severity | Params | Copy (FE template, `cardCopy.ts`) |
|---|---|---|---|---|
| `decoupling` | output ↑ and emissions ↓ vs base | good | `output_pct, emissions_pct, base_year` | "Output is up {output_pct}% since {base_year} while emissions fell {emissions_pct}%." |
| `largest_source` | top category ≥ 40 % of gross | info | `category, share_pct` | "{category} is {share_pct}% of your footprint." |
| `site_concentration` | one site ≥ 50 % of a scope | info | `site, scope, share_pct` | "{site} is {share_pct}% of Scope {scope}." |
| `pathway_gap` | pathway status off_track | critical | `gap_pct, target_year` | "Emissions are {gap_pct}% above the {target_year} pathway." |
| `pathway_on_track` | pathway status on_track | good | `margin_pct` | "You're {margin_pct}% below your pathway this year." |
| `target_off_track` | ≥ 1 KPI target off_track | attention | `count, first_name` | "{count} targets are off track, including {first_name}." |
| `renewables_jump` | renewable share +10 pp yoy | good | `from_pct, to_pct` | "Renewable electricity rose from {from_pct}% to {to_pct}%." |
| `intensity_change` | intensity change ≥ 5 % either way | good / attention | `change_pct, unit` | "Intensity {fell|rose} {change_pct}% to … per {unit}." |
| `biggest_mover` | `/kpi/esg` movers top item | good / attention | `name, change_pct` | "{name} changed {change_pct}% on last year." |
| `coverage_gap` | a pillar < 60 % coverage after month 9 | attention | `pillar, pct, missing` | "{pillar} data is {pct}% complete — {missing} values missing." |
| `pending_large` | pending items would move net by ≥ 5 % | attention | `count, link` | "{count} entries waiting for approval could change these figures." |

## 7. Error codes

```
IN_OFF              403  company.insights_enabled is false
IN_FORBIDDEN        403  role not allowed (User)
IN_SITE_NOT_FOUND   404  site outside scope or another company's
IN_EVENT_NOT_FOUND  404
IN_EVENT_INVALID    400  zod issues
IN_SCORES_INVALID   400  score outside 0..10, unknown topic
IN_AI_BUDGET        429  IN-9 budget exceeded; cards fall back to rule text
IN_SNAPSHOT_TIMEOUT 504  PDF snapshot exceeded 60 s
IN_SNAPSHOT_UNAVAILABLE 503  the server's PDF printer (Playwright's Chromium) can't start (IN-8 follow-up)
```

## 8. AI wording (IN-9)

- Input: one card's `rule`, `params` (as named values), company display name, sector (if set). No user emails, no evidence, no row-level data.
- Output (zod): `{ text: string }`, ≤ 180 characters, plain text, containing every required `{{v:key}}` token for that rule and no digits outside tokens.
- Guard rejects otherwise; the card keeps its rule text. Every call is logged in `insight_ai_call`.

## 9. FE routes and files

| Route | Page | Module |
|---|---|---|
| `/insights` | `src/features/insights/Page.tsx` | IN-0 shell, panels from IN-1…8 |
| `/insights/present` | `src/features/insights/present/PresentPage.tsx` | IN-8 |

- URL state: `?year=&yearType=&sites=&pillar=&compare=&panel=` (panel = scroll target).
- Nav: "Insights" under "Overview" for Manager and Admin; Superadmin via the client picker. Command palette entry. Hidden unless `insightsOn(user)`.
