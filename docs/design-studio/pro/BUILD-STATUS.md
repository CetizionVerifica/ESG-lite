# Pro editing build status (AT-1, AT-2, PE-1, PE-2) · backend

Written 2026-10-21. Branch `ds-pro/local` in ESG-lite. Built in a cloud session after the move from the owner's Mac. PE-3 and later are not approved and were not built. No pull request was opened and `production` was not touched.

## What was built

| Module | Branch | Commits added in this session | Module doc |
|---|---|---|---|
| **AT-1** `POST /studio/templates/suggest` | `at-1-template-suggest` | `44cff98` 3/4 prompt hygiene, `b8b196c` 4/4 docs | `AT-1.md` |
| **AT-2** `suggest_layouts` + template swap preview/apply | `at-2-layouts-swap` | `46c3b66` 4/4 tests, route plumbing, docs; `2a3d372` 5/5 apply in one UPDATE | `AT-2.md` |
| **PE-1** remove background, image jobs, photo props | `pe-1-photo-edit` | `2e336f1` 2/5 lazy engine, `3085c4f` 3/5 tests, `ac886de` 4/5 docs | `PE-1.md` |
| **PE-2** text effects, brand fonts, find and replace | `pe-2-text-fonts-find` | `81f6d3a` 4/4 docs + test fix | `PE-2.md` |

- **AT-1:** the code (rule shortlist, readiness from counts, guarded AI re-order, one retry, then rule order) was already complete before the "WIP" tip. This session added a scrubber (`scrubPromptText`) so that emails, phone numbers, the company and brand names and figures in the free-text note and in company template names never reach the model. The note stays fenced as `<untrusted name="brief_note">`.
- **AT-2:**
  - `suggest_layouts` returns 3 options, built by the server from candidate layout slugs, and runs through the DS-9 literal-number guard.
  - Swap preview saves nothing.
  - Swap apply saves one new rev. A stale rev or hash answers 409 `DS_VERSION_CONFLICT {rev}`, and a final answers `DS_FINAL_IMMUTABLE`.
  - Follow-up 5/5: apply sets `report_doc.template_id` in the same `UPDATE` as the draft and rev. Before, it was a second statement, and a failure between the two left the new draft on the old template. A new API test makes the database refuse the change and checks that nothing moves; it failed on the old code and passes now.
- **PE-1:**
  - **Engine:** `onnxruntime-node` is loaded lazily with `require` inside a try/catch, and the model path comes from `STUDIO_BG_MODEL_PATH`. If the package or the model is missing, the endpoint answers 503 `DS_BG_UNAVAILABLE`. Under `NODE_ENV=test` the stub engine runs.
  - **Result:** a new derived asset with `derivedFrom`. The original asset is kept, and `originalAssetId` on the element points back to it.
  - **Photo props:** adjust, filter, duotone and opacity are rendered in the shared renderer.
  - **Migration:** `migrate:ds-pro-pe-1-photo`.
- **PE-2:**
  - **Text:** shadow, lift, outline, highlight and curve effects, plus a per-box font.
  - **Brand fonts:** upload, list, delete and serve the file. Writes are Manager and Superadmin only, and every upload needs the licence tick (`DS_FONT_LICENCE`). Magic bytes, size and duplicates are checked.
  - **PDF:** the fonts a doc uses are embedded from stored bytes. A deleted font falls back to the style's font.
  - **Migration:** `migrate:ds-pro-pe-2-fonts`.
  - **Find and replace:** it is a front-end-only doc operation per PRO-0 and needs no backend. Its result is saved through the existing doc `PATCH`, which already enforces template locks, finals and revisions.

## Integration into `ds-pro/local`

1. `origin/production` merged first: already up to date (nothing new).
2. AT-1 → AT-2 → PE-1 merged without conflicts.
3. PE-2 conflicted with PE-1 on shared files. Both sides were kept in each:
   - `ds-probes.cjs` (both seeds and both `ID_SOURCES` entries)
   - `cases.json` (golden groups `photo` and `pe2-text`)
   - `package.json` (both migrations)
   - `data-source.ts` (both entities)

   `RENDER_HASH` was recomputed over the combined `render/` with `npm run sync:studio-render`. It is now `bc13a108…f980`, and that value is set in the render and template snapshots. Every DS golden matched otherwise: the PE-1 and PE-2 renderer changes don't overlap.

## Test results

Environment: local Postgres 16, `NODE_ENV=test`, throwaway `ci_*` databases.

| Point | Unit (pass/fail/skip) | API (pass/fail/skip) |
|---|---|---|
| Baseline `ds-pro/local` | 625 / 0 / 12 | 775 / 0 / 7 |
| + AT-1 | 635 / 0 / 12 | 784 / 0 / 7 |
| + AT-2 | 643 / 0 / 12 | 793 / 0 / 7 |
| + PE-1 | 651 / 0 / 14 | 800 / 0 / 7 |
| + PE-2 | 658 / 0 / 14 | 806 / 0 / 7 |
| + AT-2 5/5 (final) | **658 / 0 / 14** | **807 / 0 / 7** |

Other checks on the final `ds-pro/local`:
- **DS golden:** 455 run, 455 matched, 0 failed, 2 skipped.
- **Workflow test (`ci/workflow/local.sh`):** 89 passed, 4 skipped. The DS probes inside it gave 364 pass / 0 fail / 3 n/a, and the KPI probes 145 pass / 0 fail.
- **Migrations:** `migrate:ds-pro-pe-1-photo` and `migrate:ds-pro-pe-2-fonts` both ran twice without error.

**Did not run:**
- The Chromium pixel and PDF checks: 2 DS golden cases and PE-2's PDF-embedding check (skipped in the API suite). Playwright wants `chromium_headless_shell-1228`, and only build 1194 is installed.
- The 2 extra unit skips that PE-1 added. One is the real-`onnxruntime-node` run, skipped because the package isn't installed here (nothing was downloaded, on purpose).
- Every front-end test: the ESG-lite_FE repo isn't in this session.

## Open issues

1. **FE renderer sync:** `RENDER_HASH` changed (PE-1 + PE-2). Run `npm run sync:studio-render` with ESG-lite_FE checked out next to ESG-lite, and run the FE contract and render checks there.
2. **FE UI:** the front-end work for all four modules was not done here; the FE repo is not in this session. That covers the Help me choose panel, ghost previews and the side-by-side swap, the photo panel, the effects panel, Brand fonts and the font picker, and the Find and replace dialog.
3. **Background remover:**
   - No real segmentation model has been run. That needs `npm ci` to install `onnxruntime-node` and a model file at `STUDIO_BG_MODEL_PATH` on the server.
   - `.npmrc` sets `onnxruntime-node-install=skip`. Nobody checked that key against the package.
   - Jobs run in a one-at-a-time runner inside the API process, not in the DS-11 queue.
   - No test covers the limit of 3 jobs at once per company (409), because the stub finishes too fast.
4. **AT-1:**
   - `pagesToDrop`/`pagesToAdd` are shown on the cards but not applied to the build.
   - There is no recorded-answer golden for `suggest_templates`, because the action is not in `AI_ACTIONS`.
5. **PE-2:**
   - The whole font file is embedded and Chromium subsets it in the PDF; there is no server-side subsetting.
   - A comment in `render/textEffects.ts` names the golden folder `pro-text/`, but it is `pe2-text/`. It was left alone so `RENDER_HASH` doesn't move again.
6. **Stale comment in `ci/golden/ds/lib/routes.cjs`:** it still says the PRO routes answer 501 until each module lands. Comment only.

Deviations from the plan are listed per module in `AT-1.md`, `AT-2.md`, `PE-1.md` and `PE-2.md`.
