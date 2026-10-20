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
