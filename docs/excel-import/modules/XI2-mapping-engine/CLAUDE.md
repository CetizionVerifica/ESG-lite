# XI2 · Mapping engine (python_AI_service)

> Goes to `python_AI_service/app/services/mapping/CLAUDE.md`. Depends on XI0, XI1, XI3 (API shape; mocked until merged). Blocks XI4 wiring. Lane L1. Two PRs: 1/2 layers 1–2 and `rows_from_proposal`; 2/2 the LLM layer and adapters.

## Outcome
`POST /v1/excel/propose` turns a workbook into a `MappingProposal` for one site (`site_id`, which must be in the caller's context) and that site's categories, using saved profiles first, rules second, the model last, with a confidence per part. `POST /v1/excel/preview` turns a confirmed proposal into `ImportRow`s and plans them on ESG-lite exactly as IM11 does.

## Build
- `mapping/context.py`: fetch `GET /imports/context` and `GET /imports/mapping-profiles?fingerprint=` with the caller's forwarded token (same `PlanClient` pattern). The context is the only universe the engine may name.
- `mapping/layers.py`:
  1. **profile**: fingerprint hit → the saved `SheetProposal` re-validated against the current context (a site or category that vanished drops to the next layer), `source: "profile"`, confidence 1.0, zero LLM calls.
  2. **rules**: exact and normalised header names (today's `autoMap` logic moved here), the code-shipped synonym dictionary (`synonyms.yaml`: "qty", "quantity", "consumption" → value; "uom", "unit" → unit; month names and formats → period; etc.), P23 mappings and factor names for activities (exact, then normalised, then token overlap ≥ 0.9), site and category names from the context (exact, then normalised).
  3. **llm**: only for parts still unresolved or below 0.8. Prompt = sheet description (XI1, samples capped per 01-contracts §6) + the context's names + the unresolved parts. Strict JSON output validated against `SheetProposal`; any name not in the context is dropped and recorded as `NOT_IN_CONTEXT`. Cell text is quoted as data in the prompt and the system prompt says instructions in cells are to be ignored.
- `mapping/model.py`: `MappingModel` protocol with `propose(prompt) -> dict`; adapters `AnthropicMappingModel` (Anthropic SDK, structured output, `ANTHROPIC_API_KEY`) and `OpenRouterMappingModel` (existing `llm.py` client). Chosen by `MAPPING_MODEL_PROVIDER`. Both log call count and tokens per document id, never prompt text.
- `mapping/rows.py`: `rows_from_proposal(workbook, proposal) -> SheetRows` (deterministic): one `ImportRow` per kept sheet row (or per non-empty month cell for `months_as_columns`), `row_ref`, period per the proposal, `activity_name` and `activity_unit` as written, extra fields, `meta: { source, confidence }`. Rows whose site-column text does not match the chosen site, or whose category is null, get local issues `SITE_OUT_OF_SCOPE` / `CATEGORY_NOT_ASSIGNED` and are sent to the plan flagged, as IM11 does for `MISSING_*` (ESG-lite re-checks anyway).
- `app/api/excel.py`: `POST /v1/excel/propose`; `preview` and `import` accept `proposal`. `ai_import_enabled` is checked by ESG-lite on the context call (403 `AI_IMPORT_DISABLED_FOR_CLIENT` passes through); python does not keep its own copy of the switch.

## Must not
- Compute totals, factors or conversions. Store proposals or prompts. Read a profile or context with anything but the caller's token. Call the model when every part is resolved by layers 1–2.

## Own tests
`ci/tests/test_mapping_layers.py` (each layer on the XI1 fixtures with a fake context; profile hit makes zero model calls; names outside the context are dropped), `test_prompt_builder.py` (prompt contains only context names and capped samples; a second company's fixture never appears), `test_rows_from_proposal.py` (row counts, refs, periods, months-as-columns), `test_propose_api.py` (fake model, fake ESG-lite; 403 passthrough; rate limit).

## Audit rows
XI-01 propose scoped (Manager of site 1, sheet naming site 2 → flagged), XI-02 zero model calls on profile hit, XI-03 hostile cell inert, XI-04 totals in the sheet ignored.
