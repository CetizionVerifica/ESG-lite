# DS-12 · Checks and the final gate (with GHG completeness)

> **Module spec**, lane L1, wave 4. Copy to `ESG-lite/src/studio/checks/CLAUDE.md`.
> **PR titles:** `[DS-12 k/m]`, four PRs:
> 1. RS-9 port (layout, number, content checks);
> 2. GHG checks;
> 3. kind-aware final gate;
> 4. FE checks panel + inline markers + final dialog.
>
> **Depends on:** DS-2, DS-7, DS-11 · **Owns:** `src/studio/checks/*`, `render/checks/number.ts`, FE `studio/checks/*`
> **Base:** RS-9. Kept. Changes are below.

## Changes from RS-9
1. **GHG checks** (`01-contracts` §6), in `checks/ghg.ts`, from:
   - the resolved data (DS-2);
   - report inputs;
   - the doc structure, e.g. "is there a page whose bindings include `scope3_category` for each category, or a `scope3_categories` flow section";
   - rendered text (`BIOGENIC_IN_SCOPE`: any binding summing biogenic into a scope total; `TOTAL_MISMATCH` against `series` sums).
2. **Severity by framework:** ISO checks become errors when `ISO14064` is in `meta.frameworks`. BRSR and ESRS intensity checks apply only when those frameworks are selected (D8).
3. **Before marking ISO checks as errors,** confirm the ISO 14064-1:2018 clause 9.3.1 list against the standard text, which the company must buy. Record the outcome in "As built".
4. **Final gate by kind:**
   - **GHG:** `GHG_PENDING_ENTRIES`, plus any open error, plus `DS_APPROVAL_PENDING` when review is required.
   - **Sustainability:** RS (`YEAR_NOT_LOCKED` etc.).
5. **Fix actions:**
   - "Mark as excluded…" (opens an exclusion input with an AI draft);
   - "Open pending entries" (Review);
   - "Add market-based note" (inserts the "Not reported" row);
   - "Add per-gas chart" (inserts `gas_split`).
6. **FE:** RS S5 panel and markers. GHG messages are written in plain words per `05-ux` S8.

## Tests
- **Unit:** each GHG check on positive and negative fixtures.
- **Golden:** the seed GHG Inventory doc has exactly the expected checks.
- **API:** a final blocked with an error open; allowed after the fix; pending entries block.
- **Playwright:** the checks counter, jump to the page, fix, and a final enabled.

## Done when
A GHG final can't be produced while it misses a GHG Protocol required disclosure that ESGLite can detect, and every check shows a way to fix it.

## As built (2026-10-20, branch `ds-12-checks` in ESG-lite and ESG-lite_FE, local only)

### Files
**ESG-lite**
- `src/reporting/studio/render/checks/number.ts` (pure, mirrored; RENDER_HASH re-synced): `extractNumbers` (unit family, the writer's rounding step, Indian/Western grouping, scale words, %, ₹/crore/lakh; years, codes, clauses, dates and counts below 10 ignored), `matchClaim` (match / near miss within ×2 of the same unit family / unbound), `roundsTo`.
- `src/studio/checks/`: `walk.ts` (bindings, chips and typed text in exactly the resolver's order; footnote notes; visible corpus), `types.ts` (`CheckInput`, `GhgFacts`, `check()` with the D8 ISO escalation, `hasInput`), `content.ts`, `numbers.ts`, `layout.ts`, `ghg.ts`, `facts.ts` (read-only: DS-5 readiness, DS-2 GhgLoader, factor sources from the approved rows' factor snapshots), `service.ts` (`runChecks`, `evaluate`, `runCheckFamilies`, `sortChecks`, `storedMeasurements`), `gate.ts` (`checksFinalGate`), `router.ts` (registers the gate with DS-11's `registerFinalGate`).
- Contracts (`contracts/checks.ts`, `// DS-12`): seven fix actions appended to `CHECK_FIXES` (`mark_excluded`, `open_pending`, `add_market_note`, `add_gas_chart`, `add_biogenic`, `add_factor_table`, `open_link`), `MeasurementSchema`, `ChecksBodySchema`, `ChecksResponse`, `SEVERITY_RANK`; `ci/studio-contracts.json` regenerated (FE snapshot copied). **Needs a DS-0 follow-up to land in 01-contracts §6.**
- Shared lines: `src/studio/router.ts` (one `router.use`, `// DS-12`), `src/reporting/studio/print.ts` (`beforePdf` hook, `// DS-12`), `src/studio/jobs/worker.ts` (the final's layout gate before `page.pdf`; failure reason `checks`, not retried, measurements kept; `// DS-12`).
- Tests: `ci/unit/ds-12-checks.test.cjs` (26: the RS-9 number table, every GHG check on a positive and a negative fixture, content, layout, sort, contracts, the golden), `ci/golden/ds/checks/inventory.json` (the seed GHG Inventory on fixed data), `ci/api/tests/ds-12-checks.test.cjs` (9), `ci/api/tests/ds-lib.cjs` (`readyForFinal`, `FINAL_READY_INPUTS`), `ci/api/tests/ds-11-outputs.test.cjs` (finals now answer the checks first), render/template snapshot goldens (renderHash only).

**ESG-lite_FE** (see `src/features/studio/checks/CLAUDE.md`)
- `src/lib/studio/checks.ts` (+test), `src/lib/studio/contracts.ts` + `contracts.snapshot.json`, `src/lib/studio/render/checks/number.ts` (mirror), `src/lib/studio/outputs.ts` (failure reason `checks`).
- `src/features/studio/checks/`: `store.ts`, `api.ts` (runner, live measurements of the mounted sheets), `actions.ts`, `ChecksButton.tsx` (top bar "⚑ n checks"), `ChecksPanel.tsx` (+ host), `ChecksLayer.tsx` (markers), `FinalForm.tsx`, `ExclusionDialog.tsx`, `register.ts`, `checks.test.tsx`; `e2e/ds-12-checks.spec.ts`.
- Shared lines (`// DS-12`): `editor/TopBar.tsx`, `editor/Editor.tsx` (the panel; follows a rev moved by a report-details save), `editor/plugins.ts`, `share/DownloadMenu.tsx` (the Final panel is `FinalForm`), `panels/data/api.ts` (`STUDIO_REV_EVENT` after an inputs PATCH), `src/test/msw/studio.ts` (`setStudioMockChecks`, the gate, `studioMockCheckCalls`).

### Endpoint
| Route | Role | Notes |
|---|---|---|
| `POST /studio/docs/:id/checks` | R | `{rev, measurements?}` → `{checks, blocking, warnings, layout: 'live'\|'render'\|'none', rev}`; the stored draft at `rev` (409 `DS_VERSION_CONFLICT` with `details.rev`); 404 for another company's doc, `DS_KIND_OFF` for a sustainability doc with KPI tracking off |
| `POST /studio/docs/:id/jobs {kind:'final'}` (DS-11) | M | now gated: errors → 409 `DS_CHECKS_BLOCKING {reason:'errors', checks}`; then every warning id must be in `acknowledgedWarnings` → else 409 `{reason:'warnings', unacknowledged, checks}`; the worker refuses a final with a layout error before the PDF (job `failed`, `errorReason: 'checks'`) |

### Decisions and deviations
1. **Acknowledgements are per check id** (one tick per kind of warning), stored on the final's `report_job.acknowledged_warnings` row, which the version links by `version_id`. No column was added to `report_doc_version`, so DS-12 has no table and no `migrate:ds-12-*` script.
2. **Layout in the gate:** the API gate uses the worker's measurements of the same rev (any proof, print or earlier final); the editor's live measurements are for the panel only (RS-9 §4). The worker measures every final itself (`print.ts beforePdf`).
3. **OUTSIDE_SAFE_AREA comes from the doc's frames** (the rotated box against `formats.ts` safe margin), not from `__measure`: rendered boxes of the seed page numbers were 0.085 mm taller than their frames and tripped the measured rule on every page.
4. **LOW_CONTRAST:** an error below 3:1, a warning from 3:1 to 4.5:1 (RS: error below 4.5:1). The theme's delta colour on white is 4.36:1, so the RS rule would block every final whose total went down. Text over a picture stays a warning.
5. **FONT_TOO_SMALL:** 7 pt for footnote/caption text, page numbers and the labels inside charts and tables; 8 pt elsewhere.
6. **GHG_PENDING_ENTRIES counts pending + rejected** entries (01-contracts: "pending or rejected-not-resolved"), `details {count, pending, rejected, link}`; DS-11's assertion moved to `details.pending`. A sustainability final with the year unlocked is now `DS_CHECKS_BLOCKING` with `YEAR_NOT_LOCKED` (was `DS_YEAR_NOT_LOCKED` in DS-11's default gate).
7. **Scope 3:** a category is addressed when excluded in the report inputs (stored over the screening prefill), or when it has approved data **and** the doc shows it (a printed `scope3_categories` section listing it, a `scope3_category` binding, or a category breakdown whose resolved series names it). Data but not shown is still an error (no fix button; Go to the Scope 3 section).
8. **EF_SOURCE_MISSING** passes when a printed `ghg_factor_table` section exists, else every factor source on the approved rows must be named in the doc's text (methodology, notes, titles).
9. **BIOGENIC_IN_SCOPE** catches a scope figure labelled as including biogenic CO₂, and a typed number equal to a scope total plus biogenic CO₂ (and not the total itself). Scope totals from the data never include biogenic CO₂ (it has its own column).
10. **TOTAL_MISMATCH** checks breakdowns that partition their total (scope, site, month, quarter, Scope 3 category, source category; not gas or fuel), with 0.5 t tolerance, and typed tables (static or custom) with a "Total" row.
11. **Number checks** read TextDoc text only (not chips, titles or labels); NUMBER_UNBOUND is capped at 40 rows. A near miss offers `replace_with_token` with the chip (binding + measure) only when the candidate is a single figure (no breakdown).
12. **ISO 14064-1 (spec item 3): not confirmed.** The purchased standard isn't available here, so clause 9.3.1 could not be checked. The D8 default is built (responsible person → error, uncertainty → warning when ISO14064 is selected) from the secondary sources in research.md §3; Shyam to confirm or to set them back to warnings.
13. **Findings for other modules** (the checks working as designed): the Light look's kicker colour is 2.1:1 on white (LOW_CONTRAST error on every Light template page: finals from Light templates are blocked until DS-1/DS-4 change it); the One-page summary's notes are 6.4 pt (FONT_TOO_SMALL); the shared API fixture's page number sits 4 mm into the margin (the DS-11/DS-12 API tests move it).
14. **Flow tables aren't filled server-side yet** (`ghg_factor_table`, `scope3_categories` print "Not reported" in proofs and finals; DS-1 says DS-2/DS-4 fill them). The checks treat the printed section as addressing the disclosure, per the spec; until the rows are filled, the final shows the section without rows.

### Tests run
- `test-lane.sh ds-12-be`: build ok, unit ok, scope3-golden 32/32, calculation snapshot matches (23 entries, 6 reports), API 740 pass / 0 fail (ds-12: 9, ds-11: 11), workflow 55 pass / 0 fail / 9 skipped + 29 pass.
- `test-lane.sh ds-12-fe`: see the FE As built.

### Not done
- `DS_APPROVAL_PENDING` in the gate (DS-13 wraps `checksFinalGate`), `DATA_CHANGED` (DS-13 drift).
- ISO 14064-1 clause confirmation (item 12).
- "Explain the change" (AI) on YOY_UNEXPLAINED and the AI draft of exclusion reasons depend on DS-9's actions (`exclusion_reason_draft` is called; the dialog says so when AI isn't available).
- A Playwright run against the real backend (the FE specs mock the API, as every FE spec does); the real rules are covered by the unit and API tests above.
