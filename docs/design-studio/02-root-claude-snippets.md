# 02 · Always-on rules for each repo's root CLAUDE.md

DS-0 adds one block per repo, under a `## Design Studio — see docs/design-studio/` heading, in its first PR. Nothing from RS is ever pasted into a root CLAUDE.md, because RS is absorbed. Keep the blocks short; the plan files carry the detail.

## ESG-lite

```md
## Design Studio (GHG + sustainability report designer) — see docs/design-studio/
- Switch: `company.design_studio_enabled` (default off, Superadmin only). Every `/studio` route sits behind `requireDesignStudio` (403 `DS_STUDIO_OFF`). The `sustainability` kind also needs `requireKpiTracking` (403 `DS_KIND_OFF`). The `ghg` kind does not.
- Admins and Managers edit. Only a Manager (or Superadmin) generates a final, approves or creates a share link. Users never see the studio. A company-wide report needs all-site access.
- Enums, the ReportDoc v2 schema, sources, error and check codes live only in `src/studio/contracts/`. Change them there first (DS-0 follow-up).
- Numbers in a design come only from `src/studio/sources/`: `ghg` (approved emission entries via `computeGhgTables` / `computeScope3`), `kpi` (APPROVED KPI values), `input` (report details). Derived figures are computed there. `custom` chart data is never a reported figure.
- Do not change `src/reporting/ghg*.ts`, `blocks.ts`, `render.ts`, `print.ts`, `src/scope3/baseYear/*`, the EDE controller or KPI-11 exports for the studio. Call their exported functions read-only.
- One renderer: `src/reporting/studio/render/` makes the HTML for the editor, Page view, Present, PNG and PDFs. It is pure TypeScript (no DB, no Node APIs) because ESG-lite_FE mirrors it byte for byte. After changing it, bump `RENDER_HASH` and sync the FE.
- AI output is validated JSON with data tokens only. It is never HTML, never literal reported numbers, and never applied without a person's Accept. Log every call in `report_ai_call`.
- Final versions are immutable. Share links serve stored PDFs only. New tables ship as idempotent `migrate:ds-*` scripts. Every new endpoint gets tenant-isolation, role and switch-off tests.
- No Canva SDK, API, assets or names. "Canva-like" means interaction patterns only.
```

## ESG-lite_FE

```md
## Design Studio — see docs/design-studio/ (in ESG-lite)
- Pages live in `src/features/studio/`; shared logic in `src/lib/studio/`. Nothing is visible unless `designStudioOn(user)`. Sustainability designs also need `kpiTrackingOn(user)`.
- `src/lib/studio/render/` is a generated mirror of ESG-lite `src/reporting/studio/render/`. Never edit it by hand: run `npm run sync:studio-render`. CI checks `RENDER_HASH`.
- The editor draws pages with that renderer inside a shadow root, so the editor, Page view, Present and the PDF match. Never restyle report content with app CSS or Tailwind inside the sheet.
- Numbers on pages come from `/studio/resolve` and data chips. The FE never computes a reported figure.
- Every AI result is a suggestion card with Accept / Try again / Discard. Nothing AI-written lands on a page without a click.
- `docs/design-studio/05-ux.md` is binding (Canva-style rail, drawers, contextual toolbar, page strip). Never use "Magic" or Canva's names, icons or look. The editor needs ≥1280 px.
```

## python_AI_service

No change. The studio's AI runs in ESG-lite (RS R6, kept).
