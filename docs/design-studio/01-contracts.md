# 01 · Contracts

This file is the single source for report kinds, the document schema, data sources, tables, API shapes, error and check codes, and FE routes.
- **Backend:** `ESG-lite/src/studio/contracts/` (`enums.ts`, `schema.ts` (zod), `sources.ts`, `errors.ts`, `checks.ts`, `ai.ts`).
- **FE mirror:** `ESG-lite_FE/src/lib/studio/contracts.ts`.
- Changes go in a DS-0 follow-up PR first.

**Base:** `plans/kpi-report/01-contracts.md` (RS), copied to `docs/design-studio/rs-base/01-contracts.md`. Everything there holds unless this file changes it, with these renames:
- prefix `RS_` → `DS_`;
- mount `/kpi/studio` → `/studio`;
- `src/kpi/studio` → `src/studio`;
- `report-studio` → `studio`.

## 1. Enums (new or changed)

```ts
ReportKind     = 'ghg' | 'sustainability'
PageFormat     = 'a4' | 'a4_landscape' | 'letter' | 'a5' | 'slide_16_9' | 'square' | 'social_191'   // mm sizes in render/formats.ts
DocPurpose     = 'report' | 'summary' | 'deck' | 'social'          // set by templates and by Resize (DS-10)
ElementType    = RS ElementType | 'frame' | 'grid' | 'line' | 'big_number' | 'progress' | 'callout' | 'qr'
               // frame: an image mask (rect, rounded, circle, arch, blob); grid: a photo collage of n frames
ChartKind      = RS ChartKind | 'scope_split' | 'category_bars' | 'gas_split' | 'site_bars' | 'monthly_stack'
               | 'base_year_waterfall' | 'intensity_line' | 'treemap'
DataSource     = 'kpi' | 'ghg' | 'input' | 'custom'                 // custom = typed table, never a reported figure
GhgMetric      = 'total' | 'scope1' | 'scope2_location' | 'scope2_market' | 'scope3' | 'scope3_category'
               | 'biogenic_co2' | 'gas_co2' | 'gas_ch4' | 'gas_n2o' | 'gas_other'
               | 'intensity_revenue' | 'intensity_output' | 'intensity_employee'
               | 'base_year_total' | 'dq_score' | 'primary_data_pct' | 'sites_covered' | 'months_covered'
GhgBreakdown   = 'scope' | 'scope3_category' | 'site' | 'month' | 'quarter' | 'gas' | 'fuel' | 'source_category'
DownloadKind   = 'pdf_screen' | 'pdf_print' | 'png_pages'
JobKind        = 'proof' | 'final' | 'thumbnail' | 'png' | 'print'
ApprovalState  = 'none' | 'requested' | 'approved' | 'changes_requested'
StylePreset    = { id, name, palette: [primary, accent, ink, surface, muted], fonts: { heading: FontId, body: FontId } }
```

## 2. ReportDoc v2 (JSON, `schemaVersion: 2`)

```ts
ReportDoc {
  schemaVersion: 2
  kind: ReportKind
  purpose: DocPurpose
  format: PageFormat                       // one format per doc; Resize makes a new doc
  meta:   { title, subtitle?, year: number, yearType: 'CY'|'FY', sites: 'all'|number[],
            frameworks: FrameworkCode[],     // sustainability: GRI/BRSR/ESRS; ghg: 'GHGP'|'ISO14064'|'BRSR_P6'|'ESRS_E1'
            compareYear?: number, language: 'en' }
  design: { templateId, templateVersion, styleId?, theme: ThemeOverrides }   // RS ThemeOverrides
  pages:  Page[]                           // RS Page (FreeformPage | FlowSection), plus FreeformPage.notes?: string (speaker notes)
  assets: AssetRef[]
  source?: { docId, rev, dataHash }        // set on a resized copy (DS-10)
}
```

**Bindings now name their source** (RS `Binding` becomes the `kpi` variant):
```ts
Binding = KpiBinding | GhgBinding | InputBinding | CustomData
KpiBinding   { source: 'kpi', kpis, years, sites, unit?, breakdown?, compare? }                     // RS Binding
GhgBinding   { source: 'ghg', metric: GhgMetric, years: {last:n}|number[], sites: 'all'|number[],
               breakdown?: GhgBreakdown, scope3Category?: 1..15, top?: number, compare?: 'prior'|'base' }
InputBinding { source: 'input', key: ReportInputKey }                                             // a disclosure field, §2.1
CustomData   { source: 'custom', columns: string[], rows: (string|number)[][] }                  // ≤ 200 × 20; shows "Unlinked data"
DataToken  (text chip) { type: 'data', attrs: { binding: GhgBinding|KpiBinding (single value), measure: Measure, format?: NumberFormat } }
```
RS `KpiToken` is read as a `DataToken` with `source: 'kpi'`. DS-2 ships a v1→v2 upgrader, though no v1 docs exist in production.

### 2.1 Report inputs (disclosures that aren't in the data)

`report_doc.inputs jsonb`, edited in the new-report flow (step 4) and the Data panel. Each input carries `{value, source: 'company'|'typed'|'kpi', updatedBy, updatedAt}`.

| Key | Kind | Prefill |
|---|---|---|
| `consolidation_approach` | ghg | `company.consolidation_approach` |
| `responsible_person` | ghg | — |
| `reporting_period` | both | from year and yearType |
| `base_year`, `recalculation_policy`, `significance_threshold_pct` | ghg | `company_base_year` (Scope 3) |
| `gwp_set` | ghg | from the factors used (AR5/AR6); `MIXED` if more than one |
| `exclusions[]` `{what, reason}` | ghg | Scope 3 categories marked not relevant in screening |
| `scope2_instruments` | ghg | — (D7) |
| `uncertainty_statement` | ghg | — |
| `verification` `{status: 'none'|'limited'|'reasonable', provider?, statementAssetId?}` | both | — |
| `conformance` (`GHGP`, `ISO14064`) | ghg | GHGP |
| `revenue`, `revenue_ppp_rate`, `output_units`, `employees` | ghg | KPI values when KPI tracking is on; else typed (flagged) |
| `leadership_message`, `about_company` | sustainability | RS wizard inputs |

## 3. Tables (entities `src/entities/Studio*.ts`; migrations `migrate:ds-*`)

RS §3 tables are kept and renamed where the prefix says so. New or changed:

| Table | Columns (all have `id`, `created_at`, `updated_at` unless noted) | Owner |
|---|---|---|
| `company` | + `design_studio_enabled boolean not null default false` | DS-0 |
| `company` | + `report_require_review boolean not null default false`, `brand_controls boolean not null default false` | DS-13 |
| `brand` | + `font_heading`, `font_body` (FontId, null = template default), `voice text` (≤ 3,000 chars) | DS-3 |
| `brand_palette` | `company_id`, `name`, `colors jsonb` (≤ 10 hex), `sort` | DS-3 |
| `report_template` | `company_id` (null = system), `kind`, `purpose`, `format`, `name`, `tags text[]`, `theme jsonb`, `doc jsonb` (a full ReportDoc with placeholders), `thumbnail_key`, `version`, `is_active`, `created_by` | DS-4 |
| `report_layout` | as RS, + `kind ReportKind`, `format` | DS-4 |
| `report_element` | `company_id` (null = system), `group` (shapes, lines, frames, grids, icons, sdg, esg, data), `name`, `tags text[]`, `payload jsonb` (an Element template), `license` | DS-4 |
| `report_asset` | as RS, + `folder text null` | DS-4 |
| `report_doc` | as RS, + `kind`, `purpose`, `format`, `inputs jsonb`, `source_doc_id null` | DS-5 |
| `report_doc_version` | as RS, + `kind 'autosave'` allowed (version history, kept 90 days or the last 200) | DS-5, DS-13 |
| `report_job` | as RS, + `kind` values `png`, `print`, + `options jsonb` (bleed, crop marks, page range) | DS-11 |
| `report_share` | `doc_id`, `version_id`, `token_hash`, `expires_at`, `revoked_at`, `created_by`, `views int` | DS-11 |
| `report_comment` | as RS, + `mentions int[]`, `task_assignee_id null`, `task_done_at null` | DS-13 |
| `report_approval` | `doc_id`, `rev`, `requested_by`, `reviewer_id`, `due_at null`, `state ApprovalState`, `note`, `decided_at` | DS-13 |
| `report_ai_call` | as RS | DS-9 |

## 4. API (mounted at `/studio`, behind `authenticate` → `requireDesignStudio`; the sustainability kind also `requireKpiTracking`)

Roles as RS: **R** = Admin, Manager, Superadmin; **M** = Manager, Superadmin. Users get 403 `DS_ROLE`. Another company's ids answer 404.

| Method and path | Role | Body / query | Returns | Module |
|---|---|---|---|---|
| `GET /status` | any | — | `{enabled, kinds: {ghg: boolean, sustainability: boolean}}` (not behind the switch) | DS-0 |
| `GET /readiness?kind=&year=&yearType=&sites=` | R | — | GHG: `{approvedRows, pendingRows, sitesCovered, monthsCovered, scope3Addressed: n/15, gaps[]}`; sustainability: RS readiness | DS-5 |
| `GET /brand-kit` · `PUT /brand-kit` | R · M | fonts, voice, palettes | `BrandKit` (logos from `brand`) | DS-3 |
| `GET /styles?kind=` | R | — | `StylePreset[]` built from the brand kit + system pairs | DS-3 |
| `GET /templates?kind=&format=&q=&tag=` · `GET /templates/:id` | R | — | templates with thumbnails | DS-4 |
| `GET /layouts?kind=&format=&pageKind=` | R | — | page layouts | DS-4 |
| `GET /elements?group=&q=` | R | — | element templates | DS-4 |
| `POST /assets` · `GET /assets?folder=` · `DELETE /assets/:id` | R | as RS | `AssetRef` | DS-4 |
| `POST /resolve` | R | `{kind, year, yearType, sites, bindings: Binding[], tokens: DataToken[]}` | `{values, tokens, dataHash, unavailable: {bindingIdx, reason}[]}` | DS-2 |
| `GET /docs/:id/inputs` · `PATCH /docs/:id/inputs` | R | `{rev, inputs}` | inputs with prefill sources | DS-2 |
| `GET /docs?kind=&year=` · `POST /docs` | R | `{kind, templateId, year, yearType, sites, frameworks, inputs, ai: boolean}` | list · `{doc, rev}` (built) | DS-5 |
| `GET/PATCH/DELETE /docs/:id`, `POST /docs/:id/rebuild`, `POST /docs/:id/presence` | R | as RS | as RS | DS-5 |
| `POST /docs/:id/duplicate` | R | `{title}` | `{id}` | DS-5 |
| `POST /docs/:id/resize` | R | `{format, purpose, pageIds?, title}` | `{id}` (new linked doc, built) | DS-10 |
| `GET /docs/:id/preview.html?mode=sheet\|paged\|present&pageId=&rev=` | R | — | sandboxed HTML | DS-11 |
| `POST /docs/:id/jobs` · `GET /jobs/:id` | R (proof, png, print), M (final) | `{kind, rev, options?, acknowledgedWarnings?}` | `ReportJob` | DS-11 |
| `GET /docs/:id/versions` · `POST /docs/:id/versions` · `POST /docs/:id/versions/:n/restore` · `GET /docs/:id/versions/:n/pdf` | R | `{note}` | versions, restore makes a new draft rev | DS-11, DS-13 |
| `POST /docs/:id/shares` · `GET /docs/:id/shares` · `DELETE /shares/:id` | M | `{versionId, expiresInDays ≤ 90}` | `{url}` (token shown once) | DS-11 |
| `GET /s/:token` (public, outside `/studio` auth) | — | — | a viewer page with the stored PDF; 410 when expired or revoked | DS-11 |
| `POST /docs/:id/ai` · `POST /docs/:id/ai/chat` · `GET /docs/:id/ai/usage` | R | `{action, target, params}` · `{messages, selection?}` | `Suggestion` · `{reply, suggestions: Suggestion[]}` | DS-9 |
| `POST /docs/:id/checks` | R | `{rev, measurements?}` | `{checks, blocking}` | DS-12 |
| `GET /docs/:id/drift` | R | — | as RS | DS-13 |
| comments (RS) + `POST /comments/:id/task` · `PATCH /comments/:id/task` | R | `{assigneeId}` / `{done}` | comment | DS-13 |
| `POST /docs/:id/approvals` · `POST /approvals/:id/decide` · `DELETE /approvals/:id` | R · M (reviewer) · requester | `{reviewerId, dueAt?, note?}` / `{decision, note?}` | `ReportApproval` | DS-13 |
| `POST /templates/from-doc` · `POST /layouts/from-page` | R | as RS | template / layout | DS-13 |

## 5. Error codes (`contracts/errors.ts`), new or changed

| Code | HTTP | When |
|---|---|---|
| `DS_STUDIO_OFF` | 403 | `design_studio_enabled` is off |
| `DS_KIND_OFF` | 403 | A sustainability doc while KPI tracking is off |
| `DS_FORMAT_INVALID` | 422 | Unknown format, or a layout or template from another format |
| `DS_SOURCE_UNAVAILABLE` | 422 | A binding to data that isn't recorded (e.g. `scope2_market`); `details.reason` |
| `DS_SHARE_EXPIRED` | 410 | Share link expired or revoked |
| `DS_APPROVAL_PENDING` | 409 | A final requested while an approval is requested and not decided (when `report_require_review`) |
| `DS_RESIZE_UNSUPPORTED` | 422 | Resizing a flow-only doc to `social` |
| all RS codes | — | renamed `RS_*` → `DS_*`, same meaning |

## 6. Checks (`contracts/checks.ts`)

All RS checks stay, with `YEAR_NOT_LOCKED` applying to the **sustainability** kind only. The GHG kind adds these (severity is the default; D8 decides which are errors):

| Check id | Severity | Rule | Requirement source |
|---|---|---|---|
| `GHG_PENDING_ENTRIES` | error (final) | Pending or rejected-not-resolved emission entries in the period for the doc's sites | ESGLite approval workflow |
| `GHG_SITES_MISSING` | warning | Sites in scope with no approved entries for the period | completeness |
| `GHG_MONTHS_MISSING` | warning | Months with no data at a site that reports monthly | completeness |
| `CONSOLIDATION_MISSING` | error | No consolidation approach | GHGP ch. 9 |
| `PERIOD_MISSING` | error | Reporting period not stated | GHGP ch. 9 |
| `BASE_YEAR_MISSING` | warning | A trend or target is shown with no base year and policy | GHGP ch. 9 |
| `RECALC_POLICY_MISSING` | warning | A base year with no recalculation policy or threshold | GHGP ch. 5 and ch. 9 |
| `SCOPE2_MARKET_MISSING` | warning | No market-based Scope 2 (D7) | Scope 2 Guidance, ESRS E1-6 |
| `GAS_BREAKDOWN_MISSING` | warning | No per-gas split shown, and no "not applicable" note | GHGP ch. 9 |
| `BIOGENIC_IN_SCOPE` | error | Biogenic CO₂ added into a scope total on any page | GHGP, ISO 14064-1 |
| `BIOGENIC_NOT_SHOWN` | warning | Biogenic CO₂ > 0 in data but not reported separately | GHGP, ISO 14064-1 |
| `SCOPE3_CATEGORY_UNADDRESSED` | error | A category of 1–15 neither reported nor excluded with a reason | Scope 3 Std ch. 11 |
| `EXCLUSION_NO_REASON` | error | An exclusion without a justification | GHGP, Scope 3 Std |
| `SCOPE3_DQ_MISSING` | warning | Scope 3 shown without data quality or primary-data share | Scope 3 Std ch. 11 |
| `EF_SOURCE_MISSING` | error | The methodology page omits factor sources or versions used in the data | GHGP ch. 9 |
| `GWP_MIXED` | warning | More than one GWP set in the data | GHGP, ISO 14064-1 |
| `RESPONSIBLE_PERSON_MISSING` | warning (error when ISO is selected) | | ISO 14064-1 |
| `UNCERTAINTY_MISSING` | info (warning when ISO is selected) | | ISO 14064-1 |
| `VERIFICATION_STATEMENT_MISSING` | warning | No verification status (a "not verified" status counts) | ISO 14064-1 |
| `INTENSITY_MISSING` | warning | BRSR or ESRS selected but no revenue intensity (BRSR also PPP and output) | BRSR P6, ESRS E1-6 |
| `TOTAL_MISMATCH` | error | Sum of a breakdown shown on a page ≠ the bound total (rounding tolerance) | consistency |
| `YOY_UNEXPLAINED` | info | Change > 20 % vs prior year, and no text on that page mentions it | review aid |
| `UNLINKED_DATA` | info | A `custom` chart or table exists; listed for review | DS rule 2.3 |

`Check` shape as RS. The ISO 14064-1 clause list is from secondary sources (`research.md` §3); DS-12 confirms it against the purchased standard before marking ISO checks as errors.

## 7. Render jobs

As RS §7, queue `studio.render`, plus:
- **`png`:** one PNG per page at 2× (144 dpi) or 300 dpi for print, zipped into one download; `options.pages` selects a range.
- **`print`:** PDF with 3 mm bleed (`@page { bleed: 3mm; marks: crop }`). Full-bleed backgrounds and images flagged `bleed` extend into it. Crop marks are optional. RGB only (D12).
- **`present`:** no job. `preview.html?mode=present` shows full-screen pages with arrow keys and speaker notes.
- Share-link viewers only ever get a stored PDF.

## 8. AI contract (`contracts/ai.ts`)

As RS §8 (the guard is unchanged), plus:
```ts
AiAction += 'design_from_brief' | 'suggest_style' | 'ghg_exec_summary' | 'ghg_methodology_text' | 'scope3_category_text'
          | 'exclusion_reason_draft' | 'summarise_for_deck' | 'summarise_for_social' | 'apply_brand_voice'
ChatTurn { role: 'user'|'assistant', text, suggestions?: Suggestion[] }
```
- **Chat:** the AI panel sends the conversation and the current selection. The server maps intent to one or more actions and returns suggestions. It never edits the doc directly.
- **Brand voice:** `brand.voice` is included in every writing prompt as fenced, untrusted data.
- **GHG prompts:** receive resolved values and report inputs only. They never get raw entries or factors. `exclusion_reason_draft` produces a draft that a person must confirm (it stays `AI_UNREVIEWED` until confirmed).

## 9. FE routes (`src/features/studio/routes.tsx`, gated by `designStudioOn`; sustainability docs also by `kpiTrackingOn`)

| Route | Page | Module |
|---|---|---|
| `/studio` | Home: "Start a design" strip (kinds and formats), readiness cards, recent designs | DS-5 |
| `/studio/new?kind=&template=` | New design: template → scope → inputs → build | DS-5 |
| `/studio/:id` | Editor | DS-5, DS-6 |
| `/studio/:id/preview` | Page view, PDF proof | DS-11 |
| `/studio/:id/present` | Present mode | DS-11 |
| `/studio/:id/versions` | Versions, history, approvals, shares | DS-11, DS-13 |
| `/studio/brand-kit` | Brand kit (fonts, palettes, voice; logos read from brand) | DS-3 |
| `/s/:token` | Public read-only viewer (no app chrome) | DS-11 |

Nav: "Design Studio" in the Reports group. The command palette gets "New GHG report design" and "New sustainability report design". The GHG report page (`/reports/ghg`) gets **Design this report**, which opens `/studio/new?kind=ghg` with its filters carried over.
