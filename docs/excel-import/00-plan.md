# Smart Excel import for managers: plan

**Approved by Shyam on 2026-10-14 05:30 UTC** ("I accept the recommendation") with one change: **imports are site-wise only** (one site per upload, chosen up front). Tracking issues: ESG-lite #119, python_AI_service #30, ESG-lite_FE #170. Coding may start after ESG-lite_FE #152 merges.
Written 2026-10-14 against the `production` heads: ESG-lite `b89f91e`, ESG-lite_FE `79e25eb`, python_AI_service `68ca625`.
Earlier research this builds on: `/mnt/project-files/bulk-import/smart-import-plan.md` (2026-10-12) and the MCP import plan `/mnt/project-files/mcp-import/00-plan.md` (IM0–IM12).

## 1. What Shyam asked for

1. A manager uploads a messy Excel workbook of GHG activity data, in any layout.
2. The app reads it and maps it automatically onto the data-entry entities (site, category, period, activity, unit, value and the form's extra fields) for every category assigned to the sites that manager can access.
3. "An LLM model I can train": the mapping gets better with use.
4. Hard rule: a manager or user of one company can never read or write another company's data through this feature, and the model must not leak anything outside the caller's role scope.
5. The manager reviews the imported entries one by one and approves them row by row or all together.

## 2. What already exists (so the plan is the gap, not a rebuild)

| Piece | State on `production` | Where |
|---|---|---|
| One calculation engine for typed, bulk and Claude rows | Done (IM1) | ESG-lite `src/services/emissionWrite` |
| Plans API: plan → fix → commit as one pending batch, versioned, idempotent, 2,000 rows per call, 20,000 per plan | Done (IM2) | ESG-lite `src/imports/plans` |
| Role and tenant scoping of a plan, server-side | Done. `buildWriterContext` gives a Manager only their `user_sites`, a User their site and category grants, an Admin their company, a Superadmin the named client; a foreign `company_id` is refused, never swapped; a foreign plan id is 404 | ESG-lite `src/imports/plans/scope.ts` |
| Import context: sites, categories, forms, factor names, P23 mappings, readiness, all scoped the same way | Done (IM3) | ESG-lite `src/imports/context` |
| Manager notification when a batch commits (bell, SSE, email per preference) | Done (IM4) | ESG-lite `src/services/uploadNotify.ts` |
| In-app Bulk upload page on the plans API: upload → map columns → preview → commit | python_AI_service #25 merged; ESG-lite_FE #152 held until Shyam says "python deployed" (IM11) | AI `app/services/excel_plan_client.py`, FE `src/features/bulk-upload` |
| Per-row review after commit: approve with undo, reject with reason, "Review rows" per batch, "Approve pending" for the batch | Done (P07 + ESG-lite #118 + FE #167) | FE `src/features/approvals-ledger` |
| Claude as the mapper through the MCP connector | Done, Superadmin only (D4) | ESG-lite `src/mcp` |
| Saving an activity-name match as a P23 category mapping | Superadmin and company Admin only (D5) | IM2 part 2 |

What a manager can do today: nothing through Bulk upload. The route `/capture/upload` allows Superadmin and User only (`routeMap.ts:93`). Column mapping is an exact name match (`bulk-upload/logic.ts autoMap`), one site and one category per file, first worksheet only, no memory of last month's file. The AI service's LLM (Gemini Flash through OpenRouter) is used for OCR extraction and factor-upload matching, not for sheet mapping.

## 3. The gap, in one paragraph

Everything below the mapping step is built and scoped. What is missing is the **mapping brain** (read any workbook, work out sites, categories, periods, columns and activities, with confidence), a **memory** so the same client's next file maps itself, a **manager-facing flow** on the existing page (open the route, show the proposed mapping for confirmation, then the plan, then commit, then Review rows), the **policy** that lets a manager's sheet go through an LLM, and **evals** that prove it maps correctly and never crosses a tenant.

## 4. Non-negotiables (carried over, plus two new)

1. One calculation engine (IM1). The mapper never computes, converts or sends totals; anything it sends is ignored (`CLIENT_TOTAL_IGNORED`).
2. Plan, then commit. Nothing reaches `emission` until the manager commits the current plan version.
3. Pending only. Imported rows are `pending`; approval happens in Approvals, per row or per batch.
4. **Scope is enforced by ESG-lite, never by the model.** The LLM only ever sees the context ESG-lite returned for the caller's token, and every row it proposes is re-checked by `buildWriterContext` at plan and again at commit. A row for a site or category outside the caller's scope is an issue on that row (`SITE_OUT_OF_SCOPE`, `CATEGORY_NOT_ASSIGNED`), never silently reassigned and never written.
5. **Mapping memory is per company.** Nothing learned from one client's sheets (header names, activity wording, layouts) is ever read while serving another client. A built-in synonym dictionary ships in code; it is not learned from client data.
6. Data-safety CI: additive, nullable, idempotent `migrate:*` scripts; the golden calculation snapshot must not move.
7. Off by default: a per-client switch (`company.ai_import_enabled`) that Superadmin turns on, separate from `mcp_enabled`.
8. **Site-wise only (Shyam, 2026-10-14).** Every upload is for one site, picked on the first screen from the sites the caller holds. One plan and one batch per site. A sheet row that names another site gets `SITE_OUT_OF_SCOPE` and is never reassigned; a workbook covering several sites is uploaded once per site.

## 5. Architecture

```
Manager's browser (FE, P27 page in "Smart import" mode, Manager/Admin/Superadmin)
   │ site_id (one of the caller's sites) + file + caller's own Bearer token
   ▼
python_AI_service                                    ESG-lite (Node)
  XI1 workbook reader (all sheets, headers,   ──►   GET /imports/context      (IM3, scoped by token)
      merged cells, subtotals, fingerprints)  ◄──   sites, categories, forms, factor names, P23 mappings
  XI2 mapping engine                          ──►   GET /imports/mapping-profiles (XI3, scoped)
      layer 1 exact / saved profile           ◄──   last confirmed mapping for this fingerprint
      layer 2 P23 mappings + synonym dict
      layer 3 LLM (structured proposal only)
      → MappingProposal with confidence per field, per sheet
   │ manager confirms or edits the proposal (XI4 screen 2)
   ▼
  rows_from_proposal (deterministic)          ──►   POST /imports/plans (+append)   (IM2, scoped)
                                              ◄──   plan: per-row factor, total, issues
   │ manager fixes/skips rows (XI4 screen 3, PATCH /imports/plans/:id)
   ▼
                                              ──►   POST /imports/plans/:id/commit  (IM2) → pending batch
                                                    IM4 notifies the site's managers
                                                    XI3 saves the confirmed profile (learning)
Manager → Approvals → Review rows (batch) → approve/reject per row, or Approve pending (P07, existing)
```

Key properties:
- The AI service holds no client data at rest beyond the uploaded file (already the case; `_own_document` ties a document to its uploader). It forwards the caller's token and nothing else; it has no service credential that could widen scope.
- The LLM receives: sheet names, header rows, up to 15 sample rows per sheet, the distinct values of candidate site/category/activity/unit columns (capped), and the caller's scoped context (site names, category names, form fields, known activity names). It returns a JSON proposal validated against a zod/pydantic schema. It never receives another company's names, never receives whole files, and its output is never executed, only validated.
- Cell text is data. Instructions found in cells are imported as text (IM9 hostile-cell rule), and the proposal schema has no field a cell could steer other than the mapping itself, which the manager confirms.

## 6. "An LLM model I can train": what this really means here

Shyam's goal is that the mapper gets better with each upload for a client. There are three ways to get that; the first is the recommendation.

| Option | What it is | Gets better how | Cost and risk |
|---|---|---|---|
| **A. Hosted model + per-company mapping memory + evals (recommended)** | A hosted model (Claude through the Anthropic API, or the existing Gemini through OpenRouter) prompted with the caller's scoped context and the client's saved mapping profiles. | Every confirmed mapping and every approved activity match is saved per company (XI3). Next upload: a sheet with the same header fingerprint maps itself with no LLM call; new wordings are matched against what this client confirmed before; the LLM only fills the remaining gaps. Prompt and synonym dictionary tuned from the eval set. | No training infrastructure, no model copy per client, nothing a prompt can leak across clients because memory is read per company. Each LLM call costs tokens (a few cents per workbook). Model vendor can change without retraining. |
| B. Fine-tune an open model (e.g. a small Llama/Gemma) on confirmed mappings | A model whose weights are updated on labelled examples. | Only when retrained on new examples; a client's correction is not reflected until the next training run. | Needs GPU hosting, an MLOps loop, an eval set anyway, and a decision on whether one model learns from all clients' sheets (cross-tenant leakage risk through memorised wording) or one model per client (cost explodes). Mapping quality of a small fine-tuned model is typically below a frontier hosted model on messy layouts. |
| C. No LLM: rules + fuzzy matching + saved profiles | Header synonyms, fuzzy string matching, per-company memory. | Same memory as A, without the LLM layer. | Cheapest and fully deterministic; fails on genuinely messy sheets (pivoted months as columns, mixed sites in one sheet, units inside cell text). This is layers 1 and 2 of option A, so A contains C. |

Why A: "training" in the sense Shyam wants (it learns this client's files) is a memory problem, not a weights problem. Memory is exact, auditable, per company and takes effect on the very next upload. Fine-tuning gives none of that and adds a leakage surface. Evals (XI6) are what keeps A honest: a fixed set of workbooks with expected plans, scored on every prompt or model change.

Model choice inside A (Shyam decides, decision 2): Claude (Sonnet class) through the Anthropic SDK in python_AI_service is the recommendation because it is already the mapper for the MCP path (so the same guide and eval set apply), handles long context well, and supports strict structured output. Keeping Gemini Flash through OpenRouter is cheaper per call and already wired. Either way the model is behind one `MappingModel` interface so it can be swapped.

## 7. Tenant and role isolation, layer by layer

| Layer | Rule | Enforced where |
|---|---|---|
| Who can open the page | Manager, Admin, Superadmin (User keeps today's contributor path) | FE route roles + ESG-lite role check on every `/imports` call (route guard is cosmetic; the API is the gate) |
| Which sites and categories a proposal may name | Only those in the caller's import context (Manager: `user_sites`; User: site + category grants; Admin: company; Superadmin: named client) | ESG-lite IM3 context (what the LLM is shown) and `buildWriterContext` at plan and commit (what gets written) |
| A sheet naming any site other than the chosen one | Row issue `SITE_OUT_OF_SCOPE` on every such row (whether or not the caller holds that site); the rest of the file still plans; commit refuses the plan unless those rows are skipped explicitly | ESG-lite IM2 (`skip_rows_with_issues` is per plan; XI0 adds row-level skip-by-issue-code) |
| Mapping memory | Table keyed by `company_id`; read and write only through the caller's writer context; a profile for site X is served only to callers whose scope includes site X | ESG-lite XI3 |
| P23 category mappings written from a match | Today Superadmin and Admin (D5); decision 5 asks whether Managers may, for their own sites | ESG-lite IM2 `save_mapping` |
| Uploaded file | Owned by the uploader (`_own_document`); deleted after commit; never readable by another principal | python_AI_service (existing) |
| LLM prompt content | Caller's scoped context only; sample rows capped; no other company's names; no secrets | python_AI_service XI2, unit-tested prompt builder |
| LLM output | Validated against the proposal schema; any site/category/field not in the context is dropped and flagged `NOT_IN_CONTEXT` | python_AI_service XI2 |
| Logs | Ids and counts, never cell text or sheet names with personal data | all three repos (existing rule) |
| Cross-tenant tests | Company 2 Manager token on company 1 document, plan, profile and batch ids → 404/403; Manager of site 1 uploading a sheet that names site 2 → rows flagged, nothing written | XI6 probes + each module's own tests |

The model cannot "spread the info outside the scope" because it is never given anything outside the scope, and nothing it says is written without ESG-lite's own check.

## 8. Modules

IDs use the `XI` prefix (Excel import). Each has a spec in `modules/XIn-…/CLAUDE.md`, copied into the repo as the module's working spec when coding starts. PR titles `[XI2 1/2]`, last PR body `Completes: XI2`.

| ID | Module | Repo | Depends on | Size |
|---|---|---|---|---|
| XI0 | Contracts: `MappingProposal`, `MappingProfile`, new row issue codes, limits, `company.ai_import_enabled` | ESG-lite (`src/imports/contracts.ts` follow-up) + python pydantic twin | IM0 | S |
| XI1 | Workbook reader: every sheet, header-row detection per sheet, merged and multi-row headers, subtotal/total/blank rows, pivoted months, sheet fingerprint | python_AI_service | XI0 | M |
| XI2 | Mapping engine: layered mapper (exact → saved profile → P23 + synonyms → LLM), confidence, `rows_from_proposal`, `MappingModel` interface with Claude and OpenRouter adapters | python_AI_service | XI0, XI1, XI3 API shape | L |
| XI3 | Mapping memory: `import_mapping_profile` table and scoped API; learn on commit; Manager rights for `save_mapping` per decision 5 | ESG-lite | XI0 | M |
| XI4 | Smart import flow on the P27 page: open the route to Manager/Admin; screens Upload → Confirm mapping (per sheet) → Review plan rows → Commit → Review rows link; `ai_import_enabled` switch on P17 client detail | ESG-lite_FE | XI0 (mocked until XI2/XI3 merge), IM11 FE #152 merged | L |
| XI5 | Review and approval polish: "Needs attention" filter in Review rows (rows that were AI-matched below a threshold or edited in the plan), uploader-is-approver audit note, batch "Approve pending" confirmation copy | ESG-lite + ESG-lite_FE | XI0 | S |
| XI6 | Evals and audit: workbook eval set (extends IM9's 12 with manager-scope cases), mapping accuracy scorer, tenant probes in the audit harness, §13 audit rows | project files + python `ci/evals` | XI0 to write; runs as modules merge | M |

Not in scope (same as the MCP plan): distances given as places (D6 stays; rows get `DISTANCE_REQUIRED`), approve/edit/delete from the AI service (never).

## 9. Waves and lanes

```
XI0 ─┬─ XI1 ──┐
     ├─ XI3 ──┼─ XI2 ── XI4 (screens 2–3 on real APIs) ── XI6 eval run
     ├─ XI5   │
     └─ XI4 (screen 1 + route + switch, mocked proposal) ┘
     └─ XI6 (eval set + probes, written early)
```

| Lane | Modules | Why together |
|---|---|---|
| L1 Reader + engine | XI1 → XI2 | Same Python package, the engine consumes the reader's output |
| L2 Backend | XI0 → XI3 → XI5 backend half | Contracts first, then the table and API over them |
| L3 Frontend | XI4 (mocked) → XI4 (wired) → XI5 FE half | One page, one owner |
| Audit | XI6 continuous | Writes the eval set and probes from XI0, runs them as modules merge |

Expected PRs: about 9 (XI0 one, XI1 one, XI2 two, XI3 one, XI4 two, XI5 one, XI6 one in project files). Lanes follow the existing rules (branch from and PR into `production`, no two merges within minutes, review job, merge job).

Prerequisite: ESG-lite_FE #152 (IM11 part 2) must merge first; XI4 builds on the plans-based page, not on the retired Python calculation path.

## 10. Definition of done (every XI module)

1. Matches its spec; contract changes go through an XI0 follow-up first.
2. Own tests pass; CI green; golden snapshot unchanged.
3. Tenant isolation: at least one test per new endpoint, table or prompt builder with a company 2 token on company 1 ids, and one with a Manager whose sheet names a site they do not hold.
4. Migrations additive, idempotent, in `migrate:all`, run twice in CI.
5. No cell text in logs or error messages; errors use IM0/XI0 codes.
6. FE: definition of done from ESG-lite_FE `CLAUDE.md` (tokens only, four themes, loading/empty/error, keyboard, 390px, Playwright smoke).
7. Module CLAUDE.md copied into its folder and updated with "As built".

## 11. Risks

| Risk | Mitigation |
|---|---|
| Client activity data goes through a third-party LLM for non-staff users | Per-client switch off by default; prompt carries only headers, capped samples and scoped names; documented for clients; vendor with no-training terms (Anthropic API, or OpenRouter with the no-logging flag) |
| The model maps a column wrongly and the manager approves without looking | Mapping is always confirmed on screen before planning; low-confidence fields are highlighted and block "Continue" until confirmed; plan shows totals by category and month; rows are pending; "Needs attention" filter in Review rows (XI5); eval threshold before release |
| Memory makes a wrong mapping sticky | Profiles store confidence and last-confirmed-by; a profile is applied only when the header fingerprint matches exactly, and it is shown as "Last time you mapped this as…" with one-click change; an edit overwrites the profile |
| Prompt injection through cells | Same as IM9: no action tools, output is a validated mapping only, hostile-cell eval case |
| Pivoted and multi-header sheets break the reader | XI1 ships with a fixture set (12 layouts) and unit tests before XI2 touches it |
| Cost per upload | Fingerprint hit = zero LLM calls; otherwise one call per sheet, samples capped; cost logged per plan |
| Two Python code paths (OCR LLM and mapping LLM) drift | One `MappingModel` interface, one `llm.py` client; prompt builders unit-tested |

## 12. Milestones

| Milestone | Done when |
|---|---|
| XM-0 | XI0 merged; FE #152 merged and deployed |
| XM-1 Mapper works | XI1 + XI2 + XI3 merged; a messy 3-sheet workbook maps with ≥ 90 % fields correct on the eval set with no profile; second upload of the same layout needs no LLM call |
| XM-2 Managers can use it | XI4 merged; a Manager on staging uploads, confirms, commits and reviews rows; tenant probes pass |
| XM-3 Release | XI5 + XI6 merged; eval ≥ 95 % mapping accuracy, 0 cross-tenant writes, hostile cells inert; Shyam turns `ai_import_enabled` on for a pilot client |

## 13. Decisions (taken by Shyam on 2026-10-14: all defaults accepted, plus site-wise only)

| # | Question | Default |
|---|---|---|
| 1 | **Open AI import to Managers (and Admins) in the app?** This keeps D4 (Claude/MCP stays Superadmin only) but lets a non-staff user's sheet go through an LLM. | Yes, in-app only, behind a per-client switch Superadmin turns on. MCP stays Superadmin. |
| 2 | **Which model?** | Claude (Sonnet class) through the Anthropic API, behind a `MappingModel` interface; OpenRouter/Gemini kept as the second adapter. No fine-tuning (§6). |
| 3 | **Memory scope: per company only, or a shared anonymised synonym memory across clients?** | Per company only. The shared layer is a code-shipped synonym dictionary maintained from evals, never from client data. |
| 4 | **Auto-apply or confirm?** | Always confirm the mapping on screen; fingerprint hits and high-confidence fields are pre-ticked; low-confidence fields block Continue until confirmed. |
| 5 | **May a Manager save an activity match as a P23 category mapping (today Superadmin/Admin only, D5)?** | Yes, for their own sites only; the mapping is written with an audit row naming the plan. Otherwise the match lives in the import profile only. |
| 6 | **May the uploading manager approve their own upload?** | Yes (same as typed entries today); the audit log notes uploader = approver. A four-eyes option can come later. |
| 7 | **Rows for a site other than the chosen one** | Flagged per row, rest of the file still plans; commit needs those rows explicitly skipped. Never silently dropped or reassigned. |
| 9 | **One site per upload?** (Shyam's addition) | Yes. The site is picked first; the sheet supplies categories, periods, activities and values. Multi-site workbooks are uploaded once per site. |
| 8 | **Order against other open work** | After FE #152 merges. XI0 and XI6 can start as soon as the plan is approved; nothing else before. |
