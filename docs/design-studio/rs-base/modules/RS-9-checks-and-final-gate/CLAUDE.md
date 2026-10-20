# RS-9 · Checks and the final gate: numbers, layout, content, readiness

> **Module spec**, lane L1. Copy to `ESG-lite/src/kpi/studio/checks/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/studio/checks/CLAUDE.md`.
> **PR titles:** `[RS-9 k/m]`, three PRs:
> 1. the number check (shared) and content checks;
> 2. layout checks (live + worker) and the gate;
> 3. the FE checks panel, markers and final dialog.
>
> **Depends on:** RS-2, RS-5, RS-7 · **Owns:** `src/kpi/studio/checks/*`, `src/reporting/studio/render/checks/number.ts` (mirrored), FE `studio/checks/*`

## Job to be done
Nobody can publish a report with a wrong number, clipped text, unreadable colours or empty placeholders, and fixing each problem is one click away.

## Build
1. **Number check (`render/checks/number.ts`, pure, shared):**
   - Extract numeric claims from TextDoc text nodes (not chips): the number, its unit (t, tCO₂e, GJ, MWh, kL, m³, %, pts, ₹, crore, lakh, hours, people), and nearby year words.
   - Normalise the Indian and Western grouping, "1.28 million", "12.4%".
   - Match against the doc's resolved values and RS-2 derived figures, with a tolerance equal to the displayed rounding.
   - **Results:**
     - a match is fine;
     - a near miss (wrong value for the same KPI and unit) gives `NUMBER_MISMATCH`, with the fix `replace_with_token`;
     - no candidate gives `NUMBER_UNBOUND` (info).
   - Years, framework codes and SDG numbers are ignored.
2. **Content checks (`content.ts`):** `EMPTY_PLACEHOLDER`, `MISSING_ALT`, `AI_UNREVIEWED`, `LEADERSHIP_UNCONFIRMED`, `VALUES_MISSING`, `YEAR_NOT_LOCKED`, and `DATA_CHANGED` (from RS-10, once it lands).
3. **Layout checks (`layout.ts`):**
   - **Live (FE):** measured in the browser with the same `measure.ts` logic, for edited pages.
   - **Authoritative (worker):** the RS-5 worker's `__measure()` results for proofs and finals.
   - **Rules:** `TEXT_OVERFLOW`, `OUTSIDE_SAFE_AREA` (bleed-allowed types excepted), `OVERLAPS_LOCKED`, `FONT_TOO_SMALL` (8 pt, 7 pt footnotes), `LOW_CONTRAST` (WCAG; text over an image sampled at 9 points gives a warning).
4. **Endpoint:** `POST /docs/:id/checks {rev, measurements?}` returns `{checks, blocking}`. Server checks are always recomputed; client measurements are used for the live view only.
5. **The gate:**
   - The final job (RS-5) runs content and number checks, then renders, measures in the worker, and evaluates layout checks *before* `page.pdf`.
   - Any `error` aborts with `RS_CHECKS_BLOCKING` (`details.checks`).
   - Warnings must be listed in `acknowledgedWarnings` on the job request, else the same error.
   - The acknowledgements are stored on the version.

### Frontend (05-ux S5)
- **Panel and counter:** the top-bar counter, and the panel grouped Must fix / Review / For info, with Go to and fix buttons.
- **Fixes:**
  - "Replace with linked value" → a chip;
  - "Shrink text to fit" (RS-7);
  - "Move inside margin" (moves the frame to the nearest valid position);
  - "Open missing values" → KPI review filtered.
- **Inline markers:** a wavy underline, an overflow corner, an amber AI dot.
- **Final dialog:** warnings with checkboxes, the version note, the version number, and a disabled state with the reason.

## Golden cases (`ci/golden/rs/checks/`)
**Number extraction table** (input → expected):
- "48,620 tCO₂e" → match;
- "48,600 t" → match (a typed number matches when it equals the value rounded to the precision the writer typed, here hundreds);
- "48,000 t" → mismatch;
- "3,400 t" vs 3,100 → mismatch;
- "22 MW" → unbound;
- "1.28 million m³" vs 1,280,000 → match;
- "12.4%" vs change_pct 12.41 → match;
- "₹ 1.5 crore" → match.

**Layout fixtures:** one overflow, one outside safe area, one 6 pt text, one grey-on-grey.

## Tests
- **Unit:** extraction and matching; WCAG contrast maths.
- **API:** blocking final, warnings acknowledgement, roles, tenant isolation.
- **Playwright:** a typed wrong number shows a marker; fixing it with one click turns it into a chip; the final unblocks.

## Out of scope
Grammar and spell checks. Fact-checking of free text without numbers (the AI honesty check in RS-8 is advisory).

## Done when
A final can't be generated with a wrong typed number, overflow, out-of-margin content, tiny or low-contrast text, empty placeholders or an unlocked year, and every check has a visible location and, where possible, a one-click fix.
