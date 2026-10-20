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
