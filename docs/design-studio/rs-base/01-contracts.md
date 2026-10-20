# 01 · Contracts

The single source for enums, the document schema, tables, API shapes, error and check codes, and FE routes.
- **Backend:** `ESG-lite/src/kpi/studio/contracts/` (`enums.ts`, `schema.ts` (zod), `errors.ts`, `checks.ts`, `ai.ts`).
- **FE mirror:** `ESG-lite_FE/src/lib/report-studio/contracts.ts`.
- Changes go through an RS-0 follow-up PR first.

## 1. Enums

```ts
ReportStatus   = 'draft' | 'in_review' | 'approved' | 'final'      // of report_doc; 'final' = latest version is final
VersionKind    = 'snapshot' | 'review' | 'final'
PageKind       = 'freeform' | 'flow'
FlowType       = 'toc' | 'narrative' | 'data_tables' | 'gri_index' | 'brsr_index' | 'esrs_index' | 'methodology' | 'glossary'
LayoutKind     = 'cover' | 'contents' | 'leadership' | 'about' | 'highlights' | 'chapter_opener' | 'data_page'
               | 'targets' | 'materiality' | 'people' | 'quote' | 'back_cover' | 'blank'
ElementType    = 'text' | 'kpi_tile' | 'chart' | 'table' | 'image' | 'shape' | 'icon' | 'sdg' | 'divider' | 'page_number' | 'placeholder'
ChartKind      = 'stacked_bar' | 'bar' | 'line' | 'donut' | 'share_bar' | 'waterfall' | 'sankey' | 'target_bars'
               | 'dot_grid' | 'materiality_matrix' | 'sparkline'
ElementSource  = 'layout' | 'auto' | 'ai' | 'user'
TextStyleId    = 'kicker' | 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'big_number' | 'quote' | 'footnote'
Measure        = 'value' | 'change_abs' | 'change_pct' | 'share' | 'progress' | 'target' | 'baseline'
YearRef        = 'current' | 'prior' | 'base' | number
Look           = 'classic' | 'light' | 'night'                     // same values as Brand.default_look
JobKind        = 'proof' | 'final' | 'thumbnail'                  // thumbnail: internal, layout thumbnails (RS-3/RS-5)
FontId         = 'source-serif-4' | 'source-sans-3' | 'dm-serif-display' | 'ibm-plex-sans' | 'ibm-plex-serif' | 'archivo' | 'fraunces' | 'noto-sans'   // R12
JobStatus      = 'queued' | 'running' | 'done' | 'failed'
CheckSeverity  = 'error' | 'warning' | 'info'
```

## 2. ReportDoc (JSON, `schemaVersion: 1`)

```ts
ReportDoc {
  schemaVersion: 1
  meta:   { title, subtitle?, year: number, yearType: 'CY'|'FY', sites: 'all' | number[], frameworks: FrameworkCode[], language: 'en' }
  design: { designId: string, designVersion: number, theme: ThemeOverrides }
  pages:  Page[]                 // print order
  assets: AssetRef[]             // { id, kind: 'image'|'logo'|'ai_image', w, h, alt }
}
ThemeOverrides { look?: Look, colors?: Partial<{primary, accent, ink, muted, surface, coverFrom, coverTo}>, fonts?: { heading?: FontId, body?: FontId } }

Page = FreeformPage | FlowSection
FreeformPage { id, kind: 'freeform', name, layoutId?, background: { color?: string, assetId?: string, fit?: 'cover'|'contain' },
               elements: Element[], hidden?: boolean, lockedByTemplate?: boolean, bookmark?: string }
FlowSection  { id, kind: 'flow', name, flowType: FlowType, options: FlowOptions, content?: TextDoc, hidden?: boolean, bookmark?: string }
  FlowOptions: { columns?: 1|2, kpis?: KpiCode[], years?: {last: number}, groupBy?: 'pillar'|'topic', showEvidence?: boolean, startOnRight?: boolean }

Element {
  id: string                     // stable: '<pageId>.<slot>' for layout elements, nanoid for user ones
  type: ElementType
  frame: { x, y, w, h, rotation } // millimetres on A4 (210 × 297), origin top-left; rotation in degrees
  z: number
  locked?: boolean               // user lock (can unlock)
  templateLocked?: boolean       // set by a template author (RS-10); unlocked only by editing the design
  groupId?: string               // elements sharing a groupId move/select together (RS-6)
  hidden?: boolean
  source: ElementSource
  reviewed?: boolean             // AI text accepted/edited by a person
  basedOnHash?: string           // data hash of the bindings this element was written against (RS-2)
  props: TextProps | KpiTileProps | ChartProps | TableProps | ImageProps | ShapeProps | IconProps | SdgProps | ...
}
TextProps    { doc: TextDoc, style: TextStyleId, align: 'left'|'center'|'right'|'justify', color?: string, valign?: 'top'|'middle'|'bottom' }
TextDoc      = TipTap JSON; allowed nodes: paragraph, heading(2–4), bulletList, orderedList, listItem, hardBreak, text(marks: bold, italic, link, highlight), kpi
KpiToken     { type: 'kpi', attrs: { kpi: KpiCode | HeadlineCode, year: YearRef, measure: Measure, unit?: string, format?: NumberFormat, sites?: 'all'|number[] } }
KpiTileProps { binding: Binding, label?: string, showDelta: boolean, showSparkline: boolean, variant: 'plain'|'card'|'band' }
ChartProps   { binding: Binding, kind: ChartKind, title?: string, subtitle?: string, caption?: string,
               options: { greyPrior?: boolean, showValues?: boolean, horizontal?: boolean, stacked?: boolean, showTarget?: boolean } }
TableProps   { binding?: Binding, columns?: string[], rows?: Cell[][], style: 'lined'|'zebra'|'minimal', totalRow?: boolean }
ImageProps   { assetId: string, fit: 'cover'|'contain', alt: string, crop?: { x, y, w, h }, radius?: number }
ShapeProps   { shape: 'rect'|'ellipse'|'line', fill?: string, stroke?: string, strokeWidth?: number, radius?: number, opacity?: number }
IconProps    { name: string /* curated set */, color?: string } ; SdgProps { goal: 1..17, variant: 'full'|'compact' }

Binding { kpis: (KpiCode|HeadlineCode)[], years: { last: number } | number[], sites: 'all' | number[], unit?: string,
          breakdown?: string, compare?: 'prior'|'base'|'target' }
NumberFormat = 'auto' | 'int' | '1dp' | '2dp' | 'pct0' | 'pct1' | 'compact' | 'indian'   // 'indian' = lakh/crore grouping
```

**Rules:**
- Colours are hex. Every free-form element has a frame inside 0…210 × 0…297 (checks flag anything outside the safe area).
- Flow sections paginate. Free-form pages never paginate and never grow.
- The whole document is ≤ 2 MB of JSON (`RS_DOC_TOO_LARGE`). Images are referenced by asset id, never inlined.

## 3. Tables (entities `src/entities/Report*.ts`; migrations `migrate:rs-*`)

| Table | Columns (all have `id`, `created_at`, `updated_at` unless noted) | Owner |
|---|---|---|
| `company` | + `report_studio_enabled boolean not null default false` | RS-0 |
| `company` | + `report_require_review boolean not null default false` | RS-10 |
| `report_design` | `company_id` (null = system), `name`, `look`, `theme jsonb`, `version int`, `is_active`, `created_by` | RS-3 |
| `report_layout` | `design_id`, `company_id` (null = system), `kind LayoutKind`, `name`, `page jsonb` (FreeformPage with placeholders), `thumbnail_key`, `sort` | RS-3 |
| `report_asset` | `company_id`, `kind`, `r2_key`, `mime`, `bytes`, `w`, `h`, `alt`, `sha256`, `created_by` | RS-3 |
| `brand` | + `font_heading`, `font_body` (FontId, null = design default) | RS-3 |
| `company_material_topic` | + `impact_score numeric(3,1) null`, `financial_score numeric(3,1) null` (0–10) | RS-2 |
| `report_doc` | `company_id`, `year`, `year_type`, `title`, `status`, `draft jsonb` (ReportDoc), `rev int` (optimistic lock), `created_by`, `updated_by`, `deleted_at` | RS-4 |
| `report_doc_version` | `doc_id`, `n int`, `kind VersionKind`, `doc jsonb`, `data_snapshot jsonb` (resolved values, final only), `data_hash`, `design_version`, `renderer_hash`, `pdf_r2_key`, `pdf_sha256`, `page_count`, `note`, `created_by` | RS-4 (rows), RS-5 (pdf fields) |
| `report_job` | `doc_id`, `version_id null`, `kind JobKind`, `status JobStatus`, `error_code`, `requested_by`, `started_at`, `finished_at`, `pdf_r2_key`, `proof_expires_at` | RS-5 |
| `report_ai_call` | `company_id`, `doc_id`, `action`, `model`, `tokens_in`, `tokens_out`, `cost_usd numeric(10,5)`, `ok`, `error_code`, `user_id` | RS-8 |
| `report_comment` | `doc_id`, `page_id`, `element_id null`, `parent_id null`, `body text`, `author_id`, `resolved_by`, `resolved_at` | RS-10 |

Indexes: `report_doc(company_id, year)`, `report_doc_version(doc_id, n) unique`, `report_job(status, created_at)`, `report_ai_call(doc_id, created_at)`.

## 4. API (mounted at `/kpi/studio`, behind `authenticate` → `requireKpiTracking` → `requireReportStudio`)

Roles:
- **R** = Admin, Manager, Superadmin.
- **M** = Manager, Superadmin.
- Users (contributors) get 403 `RS_ROLE`.
- Another company's ids answer 404.

| Method and path | Role | Body / query | Returns | Module |
|---|---|---|---|---|
| `GET /status` | any authenticated | — | `{enabled, kpiEnabled}` (not behind the switch) | RS-0 |
| `GET /fonts/:file` | R | — | WOFF2 (immutable cache) | RS-1 |
| `POST /docs/:id/presence` | R | — | `{others: number}` (30 s heartbeat, R15) | RS-4 |
| `GET /readiness?year=&sites=` | R | — | `{year, locked, lockedAt, coverage:{framework, pct}[], missing:{kpi, sites, periods}[], pendingCount}` | RS-4 |
| `GET /designs` · `GET /designs/:id/layouts?kind=` | R | — | designs (system + own) · layouts with thumbnails | RS-3 |
| `POST /assets` (multipart) · `GET /assets` · `DELETE /assets/:id` | R | file ≤ 10 MB, jpg/png/webp/svg | `AssetRef` | RS-3 |
| `POST /resolve` | R | `{year, sites, bindings: Binding[], tokens: KpiToken[]}` | `{values: ResolvedBinding[], tokens: ResolvedToken[], dataHash}` | RS-2 |
| `GET /docs?year=` · `POST /docs` | R | `{year, designId, frameworks, sites, chapters: LayoutKind[]|topics, inputs: {leadership?, about?, coverAssetId?}, ai: boolean}` | list · `{doc, rev}` (built) | RS-4 |
| `GET /docs/:id` · `PATCH /docs/:id` · `DELETE /docs/:id` | R | PATCH `{rev, doc}` | `{doc, rev, status}`; 409 `RS_VERSION_CONFLICT` with the server rev | RS-4 |
| `POST /docs/:id/rebuild` | R | `{pageIds?: string[], keepUserEdits: true}` | `{doc, rev}` | RS-4 |
| `GET /docs/:id/preview.html?mode=sheet\|paged&pageId=&rev=` | R | — | self-contained HTML (sandboxed iframe) | RS-5 |
| `POST /docs/:id/jobs` · `GET /jobs/:id` | R (proof), M (final) | `{kind, rev, acknowledgedWarnings?: CheckId[]}` | `ReportJob` | RS-5 |
| `GET /docs/:id/versions` · `POST /docs/:id/versions` · `GET /docs/:id/versions/:n/pdf` | R | `{note}` | versions · snapshot · PDF stream (or a signed R2 URL) | RS-4, RS-5 |
| `POST /docs/:id/ai` | R | `{action: AiAction, target: {pageId?, elementId?, selection?}, params?}` | `Suggestion` (§8) | RS-8 |
| `GET /docs/:id/ai/usage` | R | — | `{todayUsd, budgetUsd, calls}` | RS-8 |
| `POST /docs/:id/checks` | R | `{rev, measurements?: Measurement[]}` | `{checks: Check[], blocking: boolean}` | RS-9 |
| `GET /docs/:id/drift` | R | — | `{changed: {elementId, before, after}[]}` | RS-10 |
| `POST /docs/:id/submit-review` · `POST /docs/:id/approve` · `POST /docs/:id/reopen` | R · M · M | `{note?}` | `{status}` | RS-10 |
| `GET/POST /docs/:id/comments` · `PATCH /comments/:id` | R | `{pageId, elementId?, parentId?, body}` / `{resolved}` | comments | RS-10 |
| `POST /designs/from-doc` · `POST /layouts/from-page` | R | `{docId, name}` / `{docId, pageId, name, kind}` | design / layout (company-owned) | RS-10 |

**Shape and caching:**
- Errors use the existing `{code, message, details}` shape.
- `PATCH` is debounced by the FE (1 s idle) and sends the whole doc. Ops/diffs are out of scope (R15).
- `/resolve` and `preview.html` responses are cacheable per `(docId, rev, dataHash)`.

## 5. Error codes (`contracts/errors.ts`)

| Code | HTTP | When |
|---|---|---|
| `RS_STUDIO_OFF` | 403 | The company switch is off |
| `RS_NEEDS_KPI` | 422 | Turning the studio on for a company without KPI tracking |
| `RS_ROLE` | 403 | A User, or a non-Manager asking for a final or approval |
| `RS_SITES_SCOPE` | 403 | A company-wide doc requested by someone without all-site access |
| `RS_DOC_NOT_FOUND` | 404 | Doc, version, job, asset or comment not in the caller's company |
| `RS_VERSION_CONFLICT` | 409 | Stale `rev` on PATCH or job |
| `RS_FINAL_IMMUTABLE` | 409 | Editing or deleting a final version |
| `RS_DOC_INVALID` | 422 | Schema validation failed (`details` = zod issues) |
| `RS_DOC_TOO_LARGE` | 413 | JSON over 2 MB |
| `RS_BINDING_INVALID` | 422 | Unknown KPI, unit not allowed, or KPI not selected by the company |
| `RS_LAYOUT_NOT_FOUND` | 404 | Unknown design or layout |
| `RS_ASSET_TYPE` / `RS_ASSET_TOO_LARGE` | 415 / 413 | Upload rules |
| `RS_YEAR_NOT_LOCKED` | 409 | Final requested before the whole-year lock (R3) |
| `RS_CHECKS_BLOCKING` | 409 | Final requested with open `error` checks or unacknowledged warnings |
| `RS_JOB_RUNNING` | 409 | A final job for this doc is already queued or running |
| `RS_JOB_FAILED` | 500 | The render failed (`details.reason`: `timeout` / `font` / `chromium` / `measure`) |
| `RS_AI_UNAVAILABLE` | 503 | Provider down (the FE offers "Try again"; build falls back to template text) |
| `RS_AI_BUDGET_EXCEEDED` | 429 | Daily per-doc budget reached (R8) |
| `RS_AI_OUTPUT_INVALID` | 502 | The model output failed the schema or the token guard twice |

## 6. Checks (`contracts/checks.ts`)

| Check id | Severity | Rule | Module |
|---|---|---|---|
| `YEAR_NOT_LOCKED` | error (final) | No whole-year lock for the doc's sites | RS-9 |
| `VALUES_MISSING` | warning | A bound KPI has no approved value for the year | RS-9 |
| `NUMBER_MISMATCH` | error | A typed number in text doesn't match any bound or derived value within tolerance | RS-9 |
| `NUMBER_UNBOUND` | info | A typed number that isn't a KPI figure (e.g. "22 MW"); listed for review | RS-9 |
| `TEXT_OVERFLOW` | error | Text taller than its frame (measured) | RS-9 |
| `OUTSIDE_SAFE_AREA` | error | An element outside the design's safe margin (except full-bleed backgrounds and images flagged `bleed`) | RS-9 |
| `OVERLAPS_LOCKED` | warning | An element overlaps a template-locked element | RS-9 |
| `FONT_TOO_SMALL` | error | Below 7 pt (footnotes) or 8 pt (anything else) | RS-9 |
| `LOW_CONTRAST` | error / warning | Text vs background below WCAG 4.5:1 (3:1 for ≥ 18 pt). Warning when the background is an image. | RS-9 |
| `EMPTY_PLACEHOLDER` | error | A layout placeholder still empty | RS-9 |
| `MISSING_ALT` | warning | An image without alt text | RS-9 |
| `AI_UNREVIEWED` | warning | AI text not yet accepted or edited | RS-9 |
| `LEADERSHIP_UNCONFIRMED` | error | The leadership message has not been confirmed by its signatory | RS-9 |
| `DATA_CHANGED` | warning | `basedOnHash` ≠ the current hash for a text element | RS-10 |

`Check { id, severity, pageId?, elementId?, message, details?, fix?: 'replace_with_token'|'shrink_text'|'move_inside'|'open_values' }`

## 7. Render jobs
- **Queue and payload:** queue `report.render` on the existing RabbitMQ connection (`src/config/rabbitmq.ts`). The payload is `{jobId}`. The worker loads the doc version, resolves the data and renders.
- **The worker:**
  - waits for fonts and `window.__ready`;
  - runs `window.__measure()` (overflow, safe area);
  - calls `page.pdf({preferCSSPageSize: true, printBackground: true, tagged: true, outline: true})`;
  - uploads to R2 at `reports/<companyId>/<docId>/<n>-<kind>.pdf`.
- **Limits and failure:** concurrency 1 per worker, a 120 s time limit, and one retry. A failed final leaves the version without a PDF and status `failed`.
- **Proof vs final:** a proof expires after 7 days (R2 lifecycle) and is not a version. A final creates `report_doc_version(kind='final')` with the data snapshot.
- **Notification:** the `report_ready` notification is sent to the requester.

## 8. AI contract (`contracts/ai.ts`)

```ts
AiAction = 'draft_report' | 'draft_page' | 'headline' | 'body' | 'leadership_draft' | 'about_report'
         | 'rewrite_shorter' | 'rewrite_longer' | 'rewrite_formal' | 'rewrite_plain' | 'explain_change' | 'add_target_context'
         | 'chart_title' | 'chart_kind' | 'suggest_layouts' | 'fill_page' | 'alt_text' | 'cover_art'
         | 'honesty_check' | 'jargon_check' | 'missing_disclosures'
Suggestion {
  id, action, model, createdAt,
  kind: 'text' | 'elements' | 'pages' | 'findings' | 'image',
  payload: { text?: TextDoc, elements?: Element[], pages?: FreeformPage[], findings?: { message, pageId?, elementId?, severity }[], assetId?: string },
  sources: { kpi: KpiCode, year: number }[]     // every token's binding, listed for the reviewer
}
```

**Guard (in this order, server side):**
1. Zod-validate the output.
2. Reject any literal digit sequence ≥ 2 digits, or a digit next to a unit, unless it is inside a `kpi` token or on the allowlist (years, framework codes like "GRI 305-1", SDG numbers).
3. Reject tokens for KPIs not selected by the company.
4. Retry once with the errors listed. Then answer `RS_AI_OUTPUT_INVALID`.

The model receives values already resolved and formatted, plus the token syntax `{{kpi:CODE|year|measure}}`, which the server turns into `kpi` nodes.

## 9. FE routes (`src/features/kpi/studio/routes.tsx`, gated by `kpiTrackingOn && reportStudioOn`)

| Route | Page | Module |
|---|---|---|
| `/kpi/report-studio` | Studio home: readiness card + report list | RS-4 |
| `/kpi/report-studio/new?year=` | New-report wizard | RS-4 |
| `/kpi/report-studio/:id` | Editor (read-only canvas until RS-6) | RS-4, RS-6 |
| `/kpi/report-studio/:id/preview` | Page view + PDF proof | RS-5 |
| `/kpi/report-studio/:id/versions` | Versions, downloads, review history | RS-5, RS-10 |

The nav item "Annual report" goes under the KPI block, and the command palette gets "Open report studio".
