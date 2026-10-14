# XI3 · Mapping memory (ESG-lite)

> Goes to `ESG-lite/src/imports/profiles/CLAUDE.md`. Depends on XI0. Blocks XI2 layer 1 (API shape only). Lane L2.

## Outcome
A client's confirmed mappings are remembered per company, so the next upload of the same layout maps itself; nothing learned from one client is ever served to another.

## Build
- Entity `ImportMappingProfile` + table per 01-contracts §3 (`migrate:ai-import` from XI0 creates it; this module adds indexes if needed).
- `src/imports/profiles/` router, controller, service: `GET /imports/mapping-profiles?fingerprint=` (and `company_id` for Superadmin), `DELETE /imports/mapping-profiles/:id`. Scope through `buildWriterContext`: a profile is returned only if `company_id` matches and (`site_id` is null or in `allowed_site_ids`). Anything else is 404, as plans are.
- Learning: `POST /imports/plans` stores `body.mapping` (a `MappingProposal` validated by XI0) on `import_plan.mapping` for `channel = "bulk_upload"`. On `onBatchCommitted`, a listener upserts one profile per sheet of that plan's mapping (key company + fingerprint + site + category), with `confirmed_by = event.user_id`, `uses + 1`. Activities confirmed in the proposal are stored in the profile; P23 writes stay with IM2's `save_mapping` rule (extended to Managers for their own sites if decision 5 is yes: `scope.ts` allows `save_mapping` when the match's site is in `allowed_site_ids` and the role is Manager).
- Audit log row per profile write (`entity_type: "import_mapping_profile"`).

## Must not
- Return or match a profile across companies, even on an identical fingerprint. Store cell values beyond the distinct texts of activity, site and category columns already in the proposal.

## Own tests
`ci/api/tests/xi3-profiles.test.cjs`: learn on commit; no learn on cancel or failed commit; fingerprint hit for the same company; company 2 Manager with the same fingerprint gets nothing; Manager of site 1 does not get a site-2 profile; delete rights; Superadmin needs `company_id`; `save_mapping` by a Manager on own site (if decision 5) and refused on another site.

## Audit rows
XI-05 memory tenant isolation, XI-06 learn-on-commit only.
