# DS-7 · Text and flow

> **Module spec**, lane L4, wave 3. Copy to `ESG-lite_FE/src/features/studio/editor/text/CLAUDE.md`.
> **PR titles:** `[DS-7 k/m]`, four PRs:
> 1. TipTap + DataChip (both sources);
> 2. text presets and the Text drawer;
> 3. flow-section settings + footnotes;
> 4. overflow measuring.
>
> **Depends on:** DS-2, DS-6 · **Owns:** FE `studio/editor/text/*`, `panels/TextPanel`, flow-section settings drawer
> **Base:** RS-7, kept in full. Changes are below.

## Changes from RS-7
1. **`KpiChip` becomes `DataChip`:**
   - it renders a `DataToken` of either source;
   - the `{{` picker searches GHG metrics and KPIs (by kind);
   - the hover card shows source, period, sites and approval date;
   - for GHG it also shows "Approved entries: n".
2. **Text drawer:**
   - Add heading / subheading / body;
   - **text presets**: kicker + title, big number + caption, quote + attribution, and section opener, styled from the theme;
   - "Insert data value".
3. **Footnotes:** a `footnote` mark numbered per page in free-form pages and per section in flow sections, rendered at the page foot. Used for factor sources and methodology notes.
4. **Flow sections** for the GHG kind (`scope3_categories`, `ghg_factor_table`, `ghgp_index`, `iso_index`): settings in the drawer (columns, which categories, show DQ, show method).
5. **Toolbar AI ▾** (shorter, longer, formal, plain, brand voice) comes from DS-9 through the toolbar registry.

## Tests
- **Unit:** DataChip serialisation round trip for both sources.
- **Component:** the picker filters by kind; a footnote renumbers after a move.
- **Playwright:** type `{{scope`, pick Scope 1 → a chip with the value; delete the chip; undo.

## Done when
Text anywhere can carry live data values of either kind, and long GHG tables flow across pages with repeated headers.
