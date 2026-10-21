# IN-8 · Polish: morph transitions, emission stripes, present mode, export

> **Module spec**, lane L2. Copy to `ESG-lite_FE/src/features/insights/present/CLAUDE.md`.
> **PR titles:** `[IN-8 k/m]`, four PRs:
> 1. FE `motion.ts` (real implementation) applied to all panels;
> 2. BE `/insights/stripes` + FE `Stripes` band;
> 3. FE present mode;
> 4. BE `/insights/snapshot.pdf` + FE Export menu.
>
> **Depends on:** IN-2, IN-4 · **Owns:** FE `src/lib/insights/motion.ts`, `components/Stripes.tsx`, `present/*`, BE `panels/{stripes,snapshot}.ts`
> **Touches:** `src/reporting/print.ts` (reuse its Playwright printer settings; no edits)

## Job to be done
Make the page feel premium and presentable: calm, purposeful motion; a signature graphic; a board-ready full-screen mode; and a one-page PDF.

## Build
1. **Motion** (`05-ux` §6): `entrance(option)` adds `animationDuration`, `animationDelay` per series index and `animationEasing`; `countUp(el, to)`; `morph` sets `universalTransition: {enabled: true}` and shared `id`/`groupId` so Pathway ⇄ Bridge and Ring ⇄ topic bars morph; `pulse(panelEl)`. All read `prefers-reduced-motion` once and return static options. Apply to every panel; panels never set animation options directly.
2. **Stripes:** `/insights/stripes` → `Stripes` (monthly approved net, up to 72 months ending at the period end). FE band 48 px, one cell per month on the heat ramp (min→max), tooltip month + value, aria-label sentence with first/last year and change. Hidden when fewer than 12 months.
3. **Present mode** (`05-ux` §8): `/insights/present` reuses panel components at large size; slides in `slides.ts`; ←/→, Esc, slide counter; focus trapped; filters from the URL; brand cover gradient from the theme pack on slide 1.
4. **PDF snapshot:** `/insights/snapshot.pdf` renders a print route (`/insights/print?…`, FE, no chrome) with the existing Playwright printer, A4 landscape, one page: hero, four story panels as static images (ECharts `renderer: 'svg'`, animation off), top 3 cards, footer with period, sites and "Generated {date} from approved data". 60 s limit (`IN_SNAPSHOT_TIMEOUT`). FE Export menu: "PDF snapshot" and "PNG of each chart" (existing `ChartFrame` export).

## Tests
- **Unit:** motion returns static options under reduced motion; slides order.
- **API:** snapshot roles, scope, switch-off, timeout path (mocked).
- **Playwright:** reduced-motion emulation shows no animation; present mode keyboard path; PDF downloads with one page (pdf page count check); stripes aria-label.

## Done when
Every panel animates once and calmly (or not at all under reduced motion), linked views morph, present mode works by keyboard, and the PDF is one clean page.

## IN-8 as built (backend; the module spec copy itself lives in ESG-lite_FE `src/features/insights/present/CLAUDE.md`, the FE lane owns motion, Stripes band, present mode and the Export menu)
- **Routes** (`src/insights/panels/in8.ts`, one `router.use` line `// IN-8`): `GET /insights/stripes`, `GET /insights/snapshot.pdf`.
- **Stripes** (`panels/stripes.ts`, `derive/stripes.ts`): the six reporting years up to the period's year in its year type (72 months, `STRIPES_MONTHS_MAX`), each month the approved net from Overview's `by_month` (`sources/emissions monthly`), **null** when the month has no approved monthly tCO₂e (gross and saved both 0); the band starts at the first month with a value; yearly batches are left out, as Overview's by_month leaves them out; `min`/`max` over the values; `no_data` (reason "Add at least twelve months…") when fewer than 12 months have a value — the fixture company (one June row per scope per year) is `no_data`. Links `band: /overview`.
- **Snapshot** (`panels/snapshot.ts`, `panels/snapshotHtml.ts`): server-side HTML instead of the FE print route (the backend can't reach the FE in CI), filled from the panels' own build functions through `panelResponse` (summary, decoupling 5 years, ESG ring when KPI on, pathway, target wall ≤ 8 rows, top 3 cards from IN-3's `buildCards`), A4 landscape, one fixed-height sheet, inline CSS + SVG, paged.js inlined (as KPI-11's GRI PDF), printed by the unchanged `htmlToPdf`. Figures are API values, only formatted; every data text escaped. Card print copy (`cardSentence`) mirrors 01-contracts §6 (the FE's `cardCopy.ts` stays the on-screen source). Footer: label, "Generated {date} from approved data", pending counts. Download name `Insights-<CY|FY><year>.pdf`.
  - 60 s limit over the whole request → 504 `IN_SNAPSHOT_TIMEOUT`; `INSIGHTS_SNAPSHOT_TIMEOUT_MS` overrides it, and under `NODE_ENV=test` only the `x-insights-snapshot-timeout-ms` header does (the API test forces the path with 1 ms).
  - Auth: the Authorization header only. `/insights` is mounted with `authenticate` in `src/index.ts`; `?token=` would need the report middleware there (an IN-0 follow-up if the FE wants a plain link).
  - Without Chromium the printer fails and the route answers 500; the API test then skips only the PDF-bytes check. Checked by hand in a local Chromium (r1194): one page.
- **Tests:** `ci/api/tests/in-8-stripes-snapshot.test.cjs` (stripes by hand on company 1 site 2 2007–2013 incl. nulls, saved rows, the yearly batch, the 72-month cap, FY window, no_data; roles, site scope, tenant, switch-off and validation for both routes; timeout 504; one landscape page when Chromium launches), `ci/unit/in-8-stripes-snapshot.test.cjs` (stripes derive, timeout helpers, HTML escaping, KPI on/off layout, card copy for every rule).
