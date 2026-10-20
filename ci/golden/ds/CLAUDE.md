# DS-14 · Golden cases, workflow test, probes

> **Module spec**, lane L5, continuous (draft in wave 1, final in wave 5). Copy to `ESG-lite/ci/golden/ds/CLAUDE.md`.
> **Depends on:** DS-0 (draft), all (final) · **Owns:** `ci/golden/ds/*`, `ci/workflow` DS steps, `audit/harness/ds-probes.cjs`, `e2e/ds-*.spec.ts` main path
> **Base:** RS-11. Kept. Changes are below.

## Build
1. **Seed docs:**
   - for the 3 seed companies: a GHG Inventory (Classic), a GHG Board brief (resized from it) and a One-page summary;
   - for the KPI seed company: a sustainability Editorial report.
2. **Goldens:**
   - **Renderer snapshots:** per element, per format, per mode.
   - **Data parity:** DS-2 GHG totals = `/user/ghg/tables`, CY and FY; EDE unchanged after the intensity extraction.
   - **Checks lists:** per seed doc.
   - **PDF:** proof vs final text positions; print bleed box.
   - **AI:** recorded responses validate.
3. **Workflow test** (`ci/workflow`):
   - switch on;
   - GHG page → Design this report → build;
   - edit (move a chart, add a chip);
   - resize to a deck;
   - checks;
   - approve;
   - final;
   - share link;
   - switch off → everything hidden and `/studio/*` answers 403.
4. **Probes** (`audit/harness/ds-probes.cjs`): a cross-tenant id on every endpoint; a share token brute-force rate limit; a 2 MB doc cap; a script tag in text, alt text or a brand voice is rendered inert.

## Done when
The workflow test passes on a clean DB, and every golden is green on `production` after DS-13.
