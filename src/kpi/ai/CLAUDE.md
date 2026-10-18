# KPI-12 · AI assist: values from documents, mapping suggestions (suggest only)

> Module spec. Lane L5. Copy to `python_AI_service/app/kpi/KPI-12.CLAUDE.md`, `ESG-lite/src/kpi/ai/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/my-kpis/KPI-12.CLAUDE.md`. PR titles `[KPI-12 k/m]` (1/3 python, 2/3 ESG-lite proxy, 3/3 FE chips).
> Depends on: KPI-4, KPI-7, KPI-2 · Owns: python `app/kpi/*`, ESG-lite `src/kpi/ai/*`, FE suggestion chips in `KpiQuestionCard` and the custom-KPI drawer · Touches: —

## Job to be done
Two jobs, with a person always confirming:
- A contributor drops a water bill, an HR summary or a waste manifest, and the matching KPI cards fill in with a suggested value, unit and period, labelled "Suggested from water-bill.pdf, page 2".
- An Admin adding a custom KPI gets suggested framework disclosures to map it to.

## Today
- **The AI service** already reads documents for emission bills (`/v1/bills`, `uploaded_documents`) and maps Excel (`/v1/excel`) and Scope 3 sectors (`/v1/scope3/eeio-sector`), with a service key. Rule: read and map only, never calculate.
- **The FE** shows AI fields with `AiLabel` / `isAiField` in add-data.

## Build
### AI service (python layer file)
1. **`POST /v1/kpi/suggest-values`** `{company_id, document_id, kpis:[{code, question, unit, allowed_units, breakdowns}], period_hint}` returns candidates per the layer file. Candidates for KPIs outside the request list are dropped. Tests use fixtures.
2. **`POST /v1/kpi/suggest-mapping`** `{name, question, unit, topic, catalogue:[{framework, code, title, section}]}` returns the top 5 disclosures with a `why` and a confidence. It uses the catalogue passed in; there's no free-form framework knowledge.

### Backend
1. `POST /kpi/ai/suggest-values` (an owner of the KPIs on that site): checks scope, builds the request from the caller's due KPIs, calls python, and returns the suggestions. Nothing is stored except an audit-free cache keyed by document id for 24 h.
2. `POST /kpi/ai/suggest-mapping` (Admin): passes the company's enabled catalogue.
3. Both answer `KPI_TRACKING_OFF` when the switch is off, and degrade to "AI not available right now", which isn't an error, when python is down.

### Frontend
1. **My KPIs:** a "Fill from a document" drop zone in the header.
   - Suggestions appear on the matching cards as an "AI suggestion" chip (value, unit, source page, quote on hover) with Use / Dismiss.
   - "Use" fills the input only; the person still saves and submits. Below 0.6 confidence the chip reads "Check this".
2. **Custom-KPI drawer** (KPI-3): suggested disclosures as checkboxes with their `why`.

## Tests
- **python:** fixtures for a water bill, an HR summary and a waste manifest; suggestions limited to the requested KPIs; service key and company scoping.
- **API:** scope (another site's KPI is refused); switch off; AI down degrades gracefully.
- **Playwright:** drop a document, then a suggestion appears, then Use, then the value is in the draft, not submitted.

## Out of scope
Automatic approval. Calculating totals. Reading documents the caller can't access.

## Done when
Contributors can fill KPI cards from their documents and Admins get mapping suggestions. Every suggestion is labelled, sourced and confirmed by a person.

## As built (ESG-lite proxy, 2026-10-18; python as built in wt/kpi-ai 42d655b)
- `client.ts`: base URL `OCR_SERVICE_URL` (as every AI call), `X-Service-Key` from `utils/aiServiceHeaders` for `/v1/kpi/suggest-values` and `/v1/kpi/suggest-mapping`; `/v1/kpi/documents` gets the caller's own `Authorization` header (python records the uploader and refuses a Superadmin). Timeout `KPI_AI_TIMEOUT_MS`, default max(75 s, `AI_SERVICE_TIMEOUT_MS`): python needs up to 60 s. Unreachable or timed out = status 0, never a throw.
- `POST /kpi/ai/suggest-values` (`service.ts`): JSON `{document_id, site_id?, period? (YYYY-MM, default last month), period_start?, kpis? [codes]}` or multipart `file` + the same fields (Superadmin: `company_id` in the query). KPIs sent = the caller's own manual due / sent-back items of `/kpi/my` for that month (D17 owners), on `site_id` when given (another site → 404 through /kpi/my); a `kpis` code not owed → 403 `KPI_NOT_ASSIGNED`; nothing owed → `{available: true, suggestions: [], message}` without calling python. Python gets `{company_id, document_id, user_id: caller, kpis: [{code, question, unit: canonical, allowed_units, breakdowns}] (unique codes), period_hint: {period_start, period_end, frequency | null}}`. Answer `{available: true, document_id, document_name, pages, period, suggestions: [{kpi_code, kpi_definition_id, kpi_name, site_id (null when the code is owed on several sites), site_ids, value, unit, breakdown_key, period_start, period_end, site_hint, source_page, quote, confidence, why, check_this (< 0.6), document_id, document_name, label: "Suggested from <name>, page <n>"}]}`; candidates for codes not asked are dropped. Python 404 → 404 `KPI_NOT_FOUND`; 410 / 422 → `{available: false, message}` saying why; 503, 5xx, down → `{available: false, message: "AI not available right now", suggestions: []}`. Superadmin → `{available: false, message: "Fill from a document isn't available for Superadmin yet", suggestions: []}`. Python's answer is cached in process for 24 h per (company, user, document, codes, period hint); nothing is stored or audited.
- `POST /kpi/ai/suggest-mapping` (Admin, Superadmin; else `KPI_FORBIDDEN`): `{name, question, unit?, topic}` → python with the company's enabled catalogue (every active version until it enables one), `(framework, code)` unique → `{available: true, suggestions: [{disclosure_id, framework, version, code, title, section, why, confidence, check_this, fit}]}` (≤ 5, only disclosures of that catalogue); `fit` is `"exact"` only when it can be inferred (confidence ≥ 0.8 and the disclosure already takes a library KPI exactly in the custom KPI's unit), else null; degrades like above.
- Tests: `ci/api/tests/kpi-12-ai.test.cjs` with a python stub on `AI_STUB_PORT`; `ci/api/run.cjs` now always points the test server's `OCR_SERVICE_URL` at that port (nothing listens there unless a test starts its stub), so no test reaches a developer's python on :8000.
- TODO(KPI-12): a Superadmin can't fill from a document until python accepts an upload on behalf of a client (python has no company for a Superadmin).
