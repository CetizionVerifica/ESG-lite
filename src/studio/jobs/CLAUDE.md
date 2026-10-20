# DS-11 · Preview, download, present, share link, render jobs, versions

> **Module spec**, lane L1, wave 3. Copy to `ESG-lite/src/studio/jobs/CLAUDE.md`.
> **PR titles:** `[DS-11 k/m]`, five PRs:
> 1. jobs + queue + worker + R2 (RS-5 port);
> 2. print PDF + PNG;
> 3. preview.html modes + Page view + Present;
> 4. share links + public viewer;
> 5. FE Download and Share menus.
>
> **Depends on:** DS-1, DS-5 · **Owns:** `report_job`, `report_share`, `src/studio/jobs/*`, `src/studio/share/*`, `src/queues/studioRender*.ts`, `/s/:token`, FE `studio/preview`, `present`, `share`, download menu
> **Base:** RS-5 (jobs, proof, final, versions, notification). Kept. Changes are below.

## Changes from RS-5
1. **Job kinds:**
   - `print`: bleed 3 mm and optional crop marks from `options`;
   - `png`: page range and scale, zipped;
   - `thumbnail`: for DS-4.

   The queue is `studio.render`, and R2 keys are `studio/<companyId>/<docId>/<n>-<kind>.<ext>`.
2. **Present** (`/studio/:id/present`):
   - `preview.html?mode=present` in a full-screen iframe;
   - arrow and space keys; a notes window (`window.open` of the notes view, falling back to a side panel);
   - Esc exits.
3. **Share links:**
   - `POST /docs/:id/shares` (Manager) for a proof or final version;
   - the token is 32 random bytes, stored as `sha256`, and shown once;
   - expiry default 14 days, max 90; revocable; views counted.
   - `GET /s/:token` serves a minimal viewer page (pdf.js) with the company logo. 410 when expired. No app session needed. Rate-limited.
   - Audit log: create, view, revoke.
4. **FE menus** (`05-ux` S7): Download ▾ (PDF screen, PDF print with options, PNG); Share ▾ (people + comments, Request approval from DS-13, Create view link + list).

## Tests
- **API:** share token tenant isolation; expired → 410; revoked → 410; a viewer never gets live data (the response is the stored PDF bytes only); role (Admin can't create a link).
- **Golden:** the print PDF has the bleed box and crop marks; PNG dimensions per format.
- **Playwright:** download the print PDF; present 3 slides; create a link, open it logged out, revoke it, reopen → expired page.

## Done when
Every output in `05-ux` S7 works from one renderer, and share links are safe by default.

## As built (2026-10-20, branch `ds-11-outputs` in ESG-lite and ESG-lite_FE, local only)

### Files
**ESG-lite**
- Tables: `src/entities/StudioReportJob.ts` (`report_job`: RS columns + `company_id`, `rev`, `options`, `doc` (cleared when the job ends), `note`, `acknowledged_warnings`, `attempts`, `file_key`, `content_type`, `bytes`, `sha256`, `page_count`, `measurements`), `src/entities/StudioReportShare.ts` (`report_share`: §3 columns + `company_id`, `job_id`, `revoked_by`, `last_viewed_at`), registered in `src/config/data-source.ts` (`// DS-11`); `src/scripts/migrateDs11Outputs.ts` + `migrate:ds-11-outputs` (TypeORM's SQL with IF NOT EXISTS; schema-diff clean).
- Contracts: `src/studio/contracts/jobs.ts` (preview query, `JobOptions`, `CreateJobBody`, `ReportJob`, version bodies, `ReportVersion`, `CreateShareBody`, `ReportShare`, `PublicShareMeta`), exported from `contracts/index.ts` (`// DS-11`). No new enum or error code (the snapshot is unchanged).
- `src/studio/jobs/`: `service.ts` (job rows, create with the final gate, get, list, file), `worker.ts` (claim → resolve → html → Chromium → store → version → notify; time limit, retry, failure reasons, shared browser, startup recovery), `inputs.ts` (RenderData from DS-2 `resolveDoc`, brand from the DS-3 kit, images inlined as data: URLs), `preview.ts` (preview.html + CSP + postMessage bridge), `versions.ts` (list, snapshot, restore, stored PDF), `gate.ts` (`registerFinalGate`; default: GHG pending entries → `DS_CHECKS_BLOCKING`, sustainability unlocked year → `DS_YEAR_NOT_LOCKED`), `storage.ts` (private outputs: R2 through GetObject, else `local-private/`), `printBoxes.ts` (TrimBox/BleedBox with pdf-lib), `zip.ts` (STORE zip writer), `router.ts`.
- `src/studio/share/`: `service.ts` (create, list, revoke, `openShare`, views, audit), `router.ts` (`/studio` routes), `public.ts` (`/s/:token`, `/meta`, `/file`; rate limit and unknown-token limit), `viewer.ts` (viewer and message pages).
- Queue: `src/queues/studioRenderProducer.ts` (`dispatchJob`: RabbitMQ `studio.render` or the in-process runner), `src/queues/studioRenderConsumer.ts` (own connection and channel, prefetch 1, `STUDIO_WORKER`); `src/config/rabbitmq.ts` asserts `studio.render` (`// DS-11`).
- Shared lines: `src/studio/router.ts` (two `router.use`, `// DS-11`), `src/index.ts` (`app.use("/s", shareViewer)`, the consumer after RabbitMQ connects, `recoverStudioJobs()` 5 s after start; all `// DS-11`), `package.json` (`migrate:ds-11-outputs`, `pdf-lib` 1.17.1 MIT), `.gitignore` (`local-private/`).
- Tests: `ci/api/tests/ds-11-outputs.test.cjs` (11), `ci/unit/ds-11-outputs.test.cjs` (7, incl. the print-box/crop-mark and PNG-size goldens); `ci/golden/ds/lib/routes.cjs` and `ci/api/tests/ds-lib.cjs` list the two extra routes; `audit/harness/ds-probes.cjs` seeds a company-1 job and link (DS-P03) and recognises the DS-11 404 page (DS-P09).

**ESG-lite_FE**
- `src/lib/studio/contracts.ts` (DS-11 block replacing the DS-0 mock shapes), `src/lib/studio/outputs.ts` (+test).
- `src/features/studio/share/`: `api.ts` (calls, `useRenderJob`, `usePreviewHtml`, versions, jobs, shares, file download, public meta), `DownloadMenu.tsx`, `ShareMenu.tsx`, `ViewLinkDialog.tsx`, `PublicViewerPage.tsx`, `SelectFromLink.tsx`, `useCanManage.ts`, `useSafeToast.ts`, `share.test.tsx`.
- `src/features/studio/preview/` (`PreviewFrame.tsx`, `PreviewPage.tsx`, `outputs-pages.test.tsx`), `src/features/studio/present/PresentPage.tsx`.
- Shared lines: `routes.tsx` (`studio-preview`, `studio-present`, `// DS-11`), `editor/TopBar.tsx` (Share ▾ / Download ▾ / `SelectFromLink`, `// DS-11`), `src/routes/newUiRoutes.tsx` (`/s/:token` outside the shell, like `/supplier/:token`, `// DS-11`).
- MSW `src/test/msw/studio.ts` (DS-11 block rewritten; `setStudioMockJobPolls`, `setStudioMockFinalBlocked`, `setStudioMockJobFailed`, `studioMockShares`) and `studio.test.ts` (final semantics); `e2e/ds-11-outputs.spec.ts`.

### Endpoints (behind `requireDesignStudio` unless noted)
| Route | Role | Notes |
|---|---|---|
| `GET /studio/docs/:id/preview.html?mode=sheet\|paged\|present\|print&pageId=&rev=&cropMarks=1` | R | current draft; fonts and images inlined; CSP header + meta; `X-Doc-Rev`; `pageId` renders one page |
| `POST /studio/docs/:id/jobs` | R; `final` M | `{kind, rev, options?, note?, acknowledgedWarnings?}` → 202 `ReportJob`; `DS_VERSION_CONFLICT`, `DS_JOB_RUNNING`, final gate, note required once a final exists |
| `GET /studio/docs/:id/jobs?kind=` | R | newest 20 (added: the Share dialog picks a proof) |
| `GET /studio/jobs/:id` · `GET /studio/jobs/:id/file[?inline=1]` | R | the file only when done and not expired (7 days except finals) (file route added) |
| `GET /studio/docs/:id/versions?kind=` · `POST …/versions {note}` · `POST …/versions/:n/restore {rev}` · `GET …/versions/:n/pdf` | R | finals flagged `superseded`; restore makes rev + 1 and an autosave "Restored from version n" |
| `POST /studio/docs/:id/shares` · `GET …/shares` · `DELETE /studio/shares/:id` | M | role checked before any lookup |
| `GET /s/:token` · `/s/:token/meta` · `/s/:token/file[?download=1]` | public | 404 unknown, 410 `DS_SHARE_EXPIRED` revoked/expired/deleted/studio off; rate-limited |

### Decisions and deviations
1. **Finals don't freeze the draft.** A final is an immutable `report_doc_version(kind='final')` with doc, data snapshot (`values`, `tokens`, `unavailable`, `dataHash`), `data_hash`, `renderer_hash` (`RENDER_HASH`), PDF key, sha256 and pages; `report_doc.status` is left alone so editing continues (RS-5 §4 "later edits continue in the draft"). DS-5's PATCH/DELETE refusals for `status = 'final'` stay for DS-13 to use. The DS-0 MSW "final freezes the doc" case was changed to this.
2. **Version numbers count every version** (autosaves too), so the first final of a built design is "Final v2", etc. `finalVersion` in the DS-5 list is the same `n`.
3. **Final gate until DS-12**: `registerFinalGate` in `jobs/gate.ts`; the default refuses a GHG final with pending entries in the period (`DS_CHECKS_BLOCKING` + `details.checks[{id: 'GHG_PENDING_ENTRIES', count, message, link}]`) and a sustainability final while the year isn't locked (`DS_YEAR_NOT_LOCKED`). `acknowledgedWarnings` is stored on the job for DS-12.
4. **Queue fallback**: `dispatchJob` uses RabbitMQ when connected; under `NODE_ENV=test`, without RabbitMQ, or with `STUDIO_RENDER_INPROCESS=1` the job runs in-process after the response (one at a time). The consumer opens its own connection (its prefetch 1 would otherwise throttle the email consumer on the shared channel). `STUDIO_WORKER=0` turns the consumer off on API-only instances. Jobs left `running` by a stopped process are re-queued (or failed after 2 attempts) at start-up.
5. **Storage keys**: `studio/<companyId>/<docId>/<n>-<kind>-<32 hex>.<ext>` (`n` = version number for finals, `j<jobId>` otherwise). The random part is added because the R2 bucket is public (brand logos); reads go through `GetObject`, never a public URL. Without R2 the files go to `local-private/` (not the served `local-uploads/`). No key is ever in a response; files stream through the API after the role and tenant checks.
6. **Proof expiry** is enforced by the API (`proof_expires_at`, 7 days; the file is deleted when an expired one is asked for); an R2 lifecycle rule for `studio/` non-final keys is an ops task (not done here).
7. **Print PDF**: DS-1 renders the 3 mm bleed MediaBox and the crop marks; DS-11 adds `TrimBox` (inset by the bleed) and `BleedBox` with pdf-lib, keeping tags, bookmarks and fonts. Screen formats get no boxes.
8. **PNG**: 144 dpi is the "2×" device scale (CSS px × 2), 300 dpi is ×3.125; pages are the paginated pages (as the PDF); zipped with a dependency-free STORE writer (`page-01.png` …).
9. **Thumbnail** jobs render one page (`options.pageId` or the first visible page) at 0.5× PNG and are downloadable like other jobs. Template thumbnails for DS-4 (`report_template.thumbnail_key`) are not rendered yet (see Not done).
10. **Preview**: the FE fetches preview.html with the session and shows it in `sandbox="allow-scripts"` srcdoc, so the CSP is also a `<meta>`; fonts and images are inlined (no session or network inside). `rev` is only a cache key. The bridge posts `ready`, `select`, `slide`, `key`; the host sends `go`. No DRAFT watermark on previews or proofs (a proof and a final of one rev must have the same text; R3's watermark is left to DS-12).
11. **View links**: `{versionId}` (a version with a stored PDF: finals) or `{jobId}` (a finished proof or print job; the link's expiry is capped at the proof's). The URL base is `SHARE_BASE_URL`, else `FRONTEND_URL` (the app's `/s/:token` page, which reads `/s/:token/meta` and frames `/s/:token/file`), else the API origin (the API's own viewer page). A link stops (410) when its design is deleted, the studio is switched off, or a sustainability design loses KPI tracking. Views count on the viewer page and on `/meta`, not on the file. Audit rows: `entity_type 'report_share'`, actions `create`, `view` (anonymous), `revoke`.
12. **Viewer**: the browser's built-in PDF viewer in an iframe instead of pdf.js (no extra bundle, strict CSP, the same on the API page and the app page). Rate limit per IP: `SHARE_RATE_LIMIT_MAX` (120/min) and `SHARE_MISS_LIMIT` unknown tokens (20/min) → 429.
13. **Roles on links**: M routes check the role before loading anything (an Admin gets `DS_ROLE` even for an unknown id, as DS-P04 expects); another company's Manager still gets 404.
14. **FE**: `Download ▾` saves files from blobs fetched with the session; `useRenderJob` takes the saved rev from `GET /docs/:id` (retries once on a rev conflict), so it renders what autosave stored. Page view clicks navigate to `/studio/:id?page=&el=`; `SelectFromLink` (in the top bar) selects it. Present keys work from both the app and the frame; notes go to a second window written as text, or a side panel when pop-ups are blocked. "People and comments" and "Request approval" in Share ▾ are disabled until DS-13.

### Tests run
- `test-lane.sh ds-11-be`: build ok, unit ok, scope3-golden 32/32, calculation snapshot matches, API 724 pass / 0 fail (ds-11: 11), workflow 55 pass / 0 fail / 9 skipped + 29 pass (DS-W10 probes 0 findings).
- `test-lane.sh ds-11-fe`: typecheck ok, lint:new ok, vitest 1859 pass (194 files).
- Playwright (port 4173, CI=1): `ds-11-outputs` 4/4, `ds-0-switch` 5/5, `ds-5-reports` 2/2, `ds-6-editor` 3/3.

### Not done
- Template and layout thumbnails for DS-4 (`report_template.thumbnail_key` / `report_layout.thumbnail_key`) and `thumbnailUrl` on the DS-5 design list: the `thumbnail` job kind exists for designs; a script that renders system templates with the default brand and stores the keys is still to write.
- An R2 lifecycle rule for expired proof files (the API refuses and deletes them on request; nothing sweeps them).
- DS-12's checks dialog for finals (`acknowledgedWarnings` is stored but unused; the default gate covers pending entries / year lock only), DS-13's approval rule (`DS_APPROVAL_PENDING`) and the version history UI (`/studio/:id/versions` stays a placeholder; the endpoints are here).
- Page view doesn't auto-reload 1.5 s after an edit (it is a separate page with a Refresh button; the editor's sheets are live).
- A Playwright run against the real backend (the specs mock the API, as every FE spec does); the real renderer output is covered by the backend goldens and the API tests.
