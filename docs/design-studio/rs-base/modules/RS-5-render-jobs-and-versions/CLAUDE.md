# RS-5 · Preview, Page view, render jobs, PDF proof and final versions

> **Module spec**, lane L1. Copy to `ESG-lite/src/kpi/studio/jobs/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/studio/preview/CLAUDE.md`.
> **PR titles:** `[RS-5 k/m]`, four PRs:
> 1. the preview endpoint;
> 2. the queue, worker and R2;
> 3. finals and versions;
> 4. FE Page view, proof viewer and versions.
>
> **Depends on:** RS-1, RS-4 · **Owns:** `report_job`, `src/kpi/studio/jobs/*`, `src/queues/reportRender*.ts`, FE `studio/preview`, `studio/versions`
> **Touches:** `src/config/rabbitmq.ts` (one queue), `notificationService` (`report_ready`)

## Job to be done
People can see the report exactly as it will print, at any time, and get a frozen, downloadable final that never changes.

## Today
- `print.ts` prints HTML with Playwright Chromium: it waits for `window.__ready`, then `page.pdf`. It runs synchronously in the request, writes files to `generated-reports/` and deletes them after sending.
- RabbitMQ (`amqplib`) is used for email only (`src/queues/emailProducer.ts`, `src/config/rabbitmq.ts`).
- R2 is configured (`src/config/r2.ts`).

## Build
### Backend
1. **Preview:**
   - `GET /docs/:id/preview.html?mode=sheet|paged&pageId=&rev=` resolves the data (RS-2) and renders (RS-1 `html.ts`).
   - Response headers: `Content-Security-Policy: default-src 'none'; img-src 'self' data: <R2 signed host>; font-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'` (Paged.js and the measure script), and `X-Frame-Options: SAMEORIGIN`.
   - Drafts get a `DRAFT` watermark until the year is locked (R3).
2. **Queue:** `report.render` is a durable queue. `reportRenderProducer.enqueue(jobId)` and `reportRenderConsumer` share the email connection.
   - The consumer runs in the API process only when `REPORT_WORKER=1` (default on in production, off in tests unless set).
   - Prefetch 1, one Chromium browser reused, a new context per job.
3. **Jobs:** `POST /docs/:id/jobs {kind, rev}`.
   - **proof:** any R role, renders the current draft at `rev`.
   - **final:** M role, runs RS-9's gate first (until RS-9 lands: `YEAR_NOT_LOCKED` only), refuses with `RS_JOB_RUNNING` if a final is in flight, creates the version on success.
   - `GET /jobs/:id` returns the status.
   - **Worker steps:** load → resolve → html → page.setContent → wait `__ready` (60 s) → `__measure()` (stored on the job for RS-9) → `page.pdf({format: 'A4', preferCSSPageSize: true, printBackground: true, tagged: true, outline: true})` → R2 upload → sha256 and page count → job done → `report_ready` notification.
   - Time limit 120 s, retry once, then `failed` with `error_code` (`timeout`, `font`, `chromium`, `measure`).
4. **Finals:** `report_doc_version(kind='final')` holds the doc, `data_snapshot` (all resolved values and tokens), `data_hash`, `design_version`, `renderer_hash`, `pdf_r2_key`, `pdf_sha256` and `page_count`. The doc status becomes `final`.
   - Later edits continue in the draft. A new final makes n+1 and marks the previous final "superseded" (R10). A note is required when a final already exists.
5. **Downloads:** `GET /docs/:id/versions/:n/pdf` streams the stored PDF after the role check (never a re-render), named `<Company>-Sustainability-Report-<year>-v<n>.pdf`.
   - Proofs are stored under `proofs/` with a 7-day lifecycle.
6. **Layout thumbnails:** a `thumbnail` job kind (internal) renders layout thumbnails for RS-3 (PNG, via `page.screenshot` of a sheet).

### Frontend
1. **Page view:** a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin) of `preview.html?mode=paged`.
   - It reloads 1.5 s after the last change and keeps showing the old pages until the new ones are ready.
   - Clicking inside posts `{pageId, elId}` (from `data-*` via a small listener script in `html.ts`); the editor selects that element and switches back to Edit.
2. **PDF proof:** "Make PDF proof" → job → a pdf.js viewer inside the app, with a download.
3. **Versions** (S6): list, download, restore as draft, superseded marker.
4. **Generate final:** a simple confirm dialog until RS-9 replaces it with the checks dialog, then a toast and notification.

## Golden cases (`ci/golden/rs/pdf/`)
For the fixture doc, the PDF has:
- the expected page count;
- fonts embedded and subset;
- 1 bookmark per page or section name;
- text extract contains the resolved headline values;
- a proof and a final of the same rev give identical extracted text and page count.

## Tests
- **API:** roles (a User gets 403; only M can make a final), tenant isolation on downloads, `RS_JOB_RUNNING`, the final is immutable (PATCH on a version → `RS_FINAL_IMMUTABLE`), a timeout path (forced), the R2 key is never in a response.
- **Playwright:** Page view shows the same headline text as the editor sheet; proof downloads; a final appears in versions.

## Out of scope
Checks content (RS-9). Review and approval (RS-10). Share links and 16:9 (R11).

## Done when
- Preview, proof and final all come from the same renderer.
- Finals are stored with their snapshot, hash and PDF.
- Rendering never blocks an API request.
