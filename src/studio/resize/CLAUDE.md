# DS-10 · Resize and convert

> **Module spec**, lane L3, wave 4. Copy to `ESG-lite/src/studio/resize/CLAUDE.md`.
> **PR titles:** `[DS-10 k/m]`, three PRs:
> 1. mapping engine (pure) + endpoint;
> 2. target layouts for deck, summary and social, per kind;
> 3. FE Resize dialog + linked-source chip.
>
> **Depends on:** DS-1, DS-5, DS-6 (DS-9 optional) · **Owns:** `src/studio/resize/*`, `POST /studio/docs/:id/resize`, FE `studio/resize/*`, `src/lib/studio/resize.ts`, target layouts in `data/studio/templates/*/resize/`

## Job to be done
The Canva Resize / Switch idea for ESG work: turn the 20-page GHG report into a 9-slide board deck, a one-page summary or a social card in one step, with the numbers still linked.

## Build
1. **Mapping (pure, shared with the FE preview):**
   - for each source page, its layout kind maps to a target layout kind per format (`cover → title slide`, `exec_summary → highlights slide`, `scope3 → category slide`, …);
   - bound elements move to matching slots in the target layout by role (`hero_number`, `main_chart`, `table`);
   - unmatched bound elements are dropped from the copy and listed;
   - flow sections become a "See the full report" slide or are dropped.
2. **Text:**
   - with AI on, `summarise_for_deck` and `summarise_for_social` (DS-9) make suggestions that are pre-accepted into the copy but marked `AI_UNREVIEWED`;
   - with AI off, text is cut to the slot length with an ellipsis and `TEXT_TRUNCATED` (info).
3. **Endpoint:** `POST /docs/:id/resize {format, purpose, pageIds?, title}` creates a new doc with `source: {docId, rev, dataHash}`, built and autosaved. It returns the id.
4. **Linked source:** the copy shows "Made from <title>". When the source's data hash differs from `source.dataHash`, it shows "Source data changed", and its bindings resolve live anyway, since they are the same bindings.
5. **FE dialog** (`05-ux` S6): target checkboxes, a preview of the first 3 pages of the selected target (client-side mapping + renderer), chapter picker, "Summarise text with AI", **Create copies**.

## Tests
- **Unit:** the mapping for each template × target; drop lists.
- **Golden:** Inventory → Board brief renders 8–10 slides with the right numbers.
- **Playwright:** resize to a deck and a summary, open the deck, present it.

## Done when
From any GHG or sustainability report, a user creates a linked deck, summary or social card in under 30 seconds.
