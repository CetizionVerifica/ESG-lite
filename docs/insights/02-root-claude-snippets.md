# 02 · Always-on rules for each repo's root CLAUDE.md

IN-0 adds one block per repo, under a `## Insights — see docs/insights/` heading, in its first PR. Keep them short; the plan files carry the detail.

## ESG-lite

```md
## Insights (combined ESG + emissions view) — see docs/insights/
- Switch: `company.insights_enabled` (default off, Superadmin only). Every `/insights` route except `/insights/status` sits behind `requireInsights` (403 `IN_OFF`). KPI-backed panels answer `availability: 'kpi_off'` (not an error) when KPI tracking is off.
- Managers see their sites, Admins and Superadmins the company. Users never see Insights (`IN_FORBIDDEN`).
- Enums, panel shapes, rule ids and error codes live only in `src/insights/contracts/`. Change them there first (IN-0 follow-up).
- Insights READS the source of truth: emission totals through the functions `/manager/overview` uses, pathway through the `/user/targets/*` functions, KPI figures through `src/kpi/values/yearly.ts`, `targets/service.ts`, `esg/service.ts`. Never copy that logic; extract it into a service in a refactor-only PR.
- New figures (index, LMDI drivers, flow widths, rule values) are computed only in `src/insights/derive/`. Approved data only; every panel returns `pending_not_in`.
- Insight cards come from deterministic rules in `src/insights/rules/`. AI may reword a card (IN-9) with `{{v:key}}` tokens only — never numbers, never new claims. Log every call in `insight_ai_call`.
- Don't change Overview, Targets, `/kpi/dashboard`, `/kpi/esg`, the GHG report or KPI-11 behaviour for Insights. New tables ship as idempotent `migrate:in-*` scripts. Every new endpoint gets tenant-isolation, role, site-scope and switch-off tests.
```

## ESG-lite_FE

```md
## Insights — see docs/insights/ (in ESG-lite)
- Page lives in `src/features/insights/`; shared logic in `src/lib/insights/`. Nothing is visible unless `insightsOn(user)`. KPI panels hide themselves on `availability: 'kpi_off'`.
- Charts: ECharts 6 via `ChartFrame` and `useChartTheme()` only. No new chart library, no hex colours, no `isDark`. Scope, pillar, heat and status colours are fixed tokens.
- Every number comes from an `/insights` endpoint. The FE never computes a reported figure, index, share or driver — it only formats.
- Each panel loads, fails and retries on its own. Every chart has a table view and an aria label; colour is never the only signal.
- Motion goes through `src/lib/insights/motion.ts` and is off under `prefers-reduced-motion`.
- `docs/insights/05-ux.md` is binding.
```

## python_AI_service

No change. IN-9's AI wording runs in ESG-lite (I13).
