# S3-14 · Base year and recalculation

> Module spec. Lane L1. Copy to `ESG-lite/src/scope3/baseYear/CLAUDE.md` and `ESG-lite_FE/src/features/scope3/baseYear/CLAUDE.md` as the first commit. PR titles `[S3-14 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on (merged): S3-13 · Owns: `src/scope3/baseYear/*`, `company_base_year`, `recalculation_event`, FE Settings section, targets-sbti hook · Touches: `targets-sbti/logic.ts`

## Job to be done
An Admin fixes the company's Scope 3 base year once, with a rationale and a recalculation policy, and ESGLite tells them when later corrections, method changes or structural changes move the base-year figure enough that it must be recalculated, and records each recalculation for the report.

## Guidance (what the GHG Protocol expects)
- Data quality should improve over time; if better data changes estimates significantly, base-year emissions must be recalculated with the new data (L1402-1412, L1420-1422; Scope 3 Standard §9.3, p. 106).
- Changes to Cat 11 methods or assumptions are a recalculation case (L5250-5253).
- Scope 3 Standard ch. 9 and §11.1 (not in the reference text; S3-0 to confirm wording): choose and report a base year with rationale, a recalculation policy with a significance threshold, base-year Scope 3 by category, and context for each recalculation. Triggers: structural changes (acquisitions, divestments, outsourcing, insourcing), changes in methodology or data accuracy, and significant errors.

## Today (evidence)
- A base year exists only as a URL choice on the targets page (`ESG-lite_FE/src/features/targets-sbti/logic.ts:13-48`, default "last year" at `:36-38`).
- The backend recomputes base totals per request; Scope 3 share ≥ 40 % switches the boundary (`ESG-lite/src/controllers/emission.controller.ts:2455-2560`, rule at `:2518-2519`). Nothing is stored, frozen or recalculated.
- Audit rows exist for emissions and imports only; `AuditLog.entity_type` is a closed union (`src/entities/AuditLog.ts:17`).
- S3-13 leaves a "Base year" block that reads "No Scope 3 base year set".

## Build
### Backend (ESG-lite)
1. `migrate:scope3-base-year`: `company_base_year` and `recalculation_event` (§4); unique (company_id, scope); `scope` holds 'Scope 3' here (one row per scope keeps room for Scope 1+2 later).
   S3-0 follow-ups: `company_base_year` needs `rationale text`, `year_type` (CY/FY) and `snapshot jsonb` (frozen base-year tCO₂e per category, with version and `frozen_at`); `recalculation_event` needs `status` (`proposed`, `approved`, `dismissed`), `note`, and `before`/`after` snapshots; errors `BASE_YEAR_NO_DATA` (no approved Scope 3 rows in that year) and `RECALCULATION_REASON_REQUIRED`; `AuditLog.entity_type` gains `scope3_base_year` and `scope3_recalculation`.
2. `baseYear/service.ts`, `GET/PUT /scope3/base-year`: read for any role with company access, write Admin and Superadmin (D12). PUT freezes the snapshot from S3-13 `computeScope3` for that year (approved rows only, kg-then-round per D5). Changing the year after a freeze needs a reason and writes an approved `methodology` event.
3. `baseYear/detect.ts` (pure, unit tested) and a nightly job plus `GET /scope3/recalculations?status=`: recompute the base year with today's rows and compare with the snapshot per category. Propose an event when |Σ delta| ≥ `significance_pct` (default 5) % of the frozen total, with a suggested reason:
   - `error`: approved base-year rows edited or deleted since the freeze (audit log);
   - `methodology`: base-year rows whose method, factor dataset, version or GWP set changed (factor snapshot), or a Cat 11 assumption change;
   - `data_quality`: rows replaced by ones with better `dq.overall`;
   - `structural`: sites added or removed with base-year data, or a lease role change (S3-11).
   One open proposal per company; a newer run updates it.
4. `POST /scope3/recalculations {reason, note}` (Admin, Superadmin): approves the open proposal, stores delta, re-freezes the snapshot as a new version and writes audit rows. It never edits emission rows; the corrections themselves are the rows managers already changed. Dismiss keeps the old snapshot with a note.
5. S3-13's base-year block: year, rationale, policy (threshold %), frozen Scope 3 by category beside the current year, and each approved event with reason, delta and note (checklist R6).

### Frontend (ESG-lite_FE)
1. `src/features/scope3/baseYear/BaseYearSection.tsx`, rendered as a section of the Boundary page (`/settings/scope3#base-year`): year select (2015 to last year), year type, rationale, policy note, significance % (default 5), "Freeze base year" in a `Modal` that shows the per-category totals being frozen (focus trapped, Esc closes). Managers see it read-only.
2. Recalculations panel in the same section: open proposal ("Base year moved by +7.2 %, above your 5 % threshold, mostly Category 1"), per-category before/after table, "Approve recalculation" (reason select + note, min 5 chars) and "Dismiss"; history list below with `AuditTimeline`. Empty state: "No changes since you froze 2023."
3. Targets hook (`src/features/targets-sbti/logic.ts`): when the company has a Scope 3 base year, `defaultBaseYear` returns it and the page shows "Company base year 2023 (set in Scope 3 settings)"; the URL value still wins. Show the 67 % Scope 3 coverage hint from `src/lib/scope3/sbti.ts` (S3-13) next to the existing 40 % rule.
4. GHG report Methodology tab base-year slot (S3-13 component) reads `GET /scope3/base-year`.

### AI service
None.

## Golden cases
No guidance example. Unit cases in `detect.ts`: frozen base 10,000 t, threshold 5 %; corrections +600 t → proposal `error`; +400 t → none; two changes of +300 t and −300 t in different categories → none (net), but both listed.

## Tests
- API (`ci/api/tests/s3-14-base-year.test.cjs`): company 2 token on company 1 base year and recalculations → 404; Manager PUT → 403; PUT on a year with no approved Scope 3 rows → `BASE_YEAR_NO_DATA`; approve without reason → `RECALCULATION_REASON_REQUIRED`; freeze twice keeps one row; migration twice; no emission row changes on approve (row count and totals equal).
- Unit: `detect.ts` triggers and threshold; FE `defaultBaseYear` with and without a company base year.
- Playwright (`e2e/scope3-base-year.spec.ts`): Admin sets 2023 with a rationale, freezes, sees the totals; targets page preselects 2023.

## Out of scope
Scope 1/2 base-year recalculation. Automatic restatement of old rows. SBTi target revalidation.

## Done when
- A company can freeze a Scope 3 base year with rationale and policy, and the report shows it with base-year totals by category.
- Significant changes produce one proposal with a reason; approving it re-freezes and records an event.
- The targets page defaults to the company base year.
