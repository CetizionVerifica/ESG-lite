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
