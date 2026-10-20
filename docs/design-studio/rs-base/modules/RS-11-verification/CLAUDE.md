# RS-11 · Golden cases, workflow test, probes

> **Module spec**, lane L5, continuous. Copy to `ESG-lite/ci/golden/rs/CLAUDE.md`.
> **PR titles:** `[RS-11 k/m]`:
> - the first PR is a draft, landing with wave 1;
> - one PR per milestone switches its cases from `skip` to `run`;
> - the last PR is the RS-M4 full run.
>
> **Depends on:** RS-0 (draft), all (final) · **Owns:** `ci/golden/rs/*`, `ci/workflow` RS steps, `audit/harness/rs-probes.cjs`, FE `e2e/rs-workflow.spec.ts`

## Job to be done
Prove, on every PR, that reports are correct, safe and identical between the editor and the PDF, without anyone opening a PDF by hand.

## Build
1. **Fixture company (`ci/golden/rs/fixture/`):**
   - **Data:** 3 years of approved KPI values across E/S/G, two sites, targets, material topics with scores, a pending value (must never appear), and one reopened-then-reapproved value (drift).
   - **Brands:** the default brand and one real client brand (Midal theme).
2. **Golden folders** (each module adds its cases as `skip` in the draft and switches them to `run` when it lands):
   - `render/` (RS-1);
   - `bindings/` (RS-2);
   - `layouts/` (RS-3);
   - `build/` (RS-4);
   - `pdf/` (RS-5);
   - `ai/` (RS-8, recorded provider);
   - `checks/` (RS-9);
   - `review/` (RS-10).
3. **Parity test:** for the fixture doc, compare the editor sheet HTML (FE mirror, jsdom) with the server sheet HTML (string-equal), and the proof PDF with the final PDF (page count and extracted text per page equal; text positions within 0.5 mm).
4. **Workflow test (`ci/workflow`):** Superadmin switches the studio on → a Manager checks readiness → builds with AI (recorded) → moves a chart and edits a heading (API PATCH) → runs checks (1 mismatch planted) → fixes it → generates final → downloads → verifies the SHA and that the version is immutable → switches off → every endpoint answers `RS_STUDIO_OFF`.
5. **Probes (`audit/harness/rs-probes.cjs`):**
   - cross-tenant access to docs, versions, assets and PDFs;
   - signed-URL expiry;
   - SVG upload XSS attempts;
   - preview CSP headers;
   - AI prompt-injection text in a KPI comment (it must not change the output format);
   - an oversized doc;
   - rev races.
6. **Regression guard:** the existing GHG report goldens and KPI-11 export goldens run unchanged in every RS PR.

## Done when
All golden folders run green, the workflow test passes end to end, the probes find nothing, and the GHG and KPI-11 goldens are byte-identical. This is the RS-M4 success test (`00-plan` §1).
