# RS-7 · Text and flow editing: TipTap with KPI chips, text styles, flow sections

> **Module spec**, lane L4. Copy to `ESG-lite_FE/src/features/kpi/studio/editor/text/CLAUDE.md`.
> **PR titles:** `[RS-7 k/m]`, three PRs:
> 1. the TipTap editor and KpiChip;
> 2. styles, overflow measure and fit;
> 3. the flow-section inspector and narrative editing.
>
> **Depends on:** RS-2, RS-6 · **Owns:** FE `studio/editor/text/*`, the flow-section inspector · **Touches:** `package.json` (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, MIT core only)

## Job to be done
Writing in the report feels like a normal editor. Every KPI figure is a live, locked chip that can't be mistyped, and text never silently overflows its box.

## Build
1. **Text editing:**
   - Double-click a text element to mount TipTap in place, over the sheet at the same position, font and size as the renderer's output (the same CSS variables). Esc or a click outside commits one history step.
   - Allowed content is limited to the `01-contracts` §2 TextDoc nodes and marks (paste is sanitised to them).
2. **KpiChip node:**
   - An inline `atom` node, rendered with `ReactNodeViewRenderer`, showing the formatted value from `/resolve` (`tokens`).
   - Attributes: kpi, year, measure, unit, format, sites. Hovering shows a card (KPI name, year, sites, approval date, evidence count). Clicking opens a small popover to change the year, measure (value / change % / change / share / progress) and format.
   - `renderText` gives the formatted value for copy. Paste of a chip keeps the node.
   - **Insert:** type `{{` or use "Insert KPI value" to open the shared KPI picker (Mention extension pattern).
3. **Styles:** the TextStyle menu (kicker, title, heading, subheading, body, caption, big number, quote, footnote) from the design's `textStyles.ts`. Colour swatches show the brand first; bold, italic, link and highlight marks.
4. **Overflow:**
   - While editing and after commit, measure the rendered height against the frame (the same logic as `render/measure.ts`).
   - Show the red corner with a "+N lines" tag.
   - Offer "Shrink text to fit" (steps the style size down to the design minimum), "Grow box" (frame height up to the safe area), or "Move rest to a new text box".
   - Never auto-flow between free-form frames.
5. **Flow sections:**
   - Selecting a flow page selects the section and opens its inspector: options per `FlowOptions` (columns, KPIs, years, groupBy, showEvidence, startOnRight).
   - `narrative` opens a full-height TipTap editor in the right panel (or a focus mode) with the same chips, and the Page view refreshes after edits.
6. **AI marker:** elements with `source: 'ai'` and `reviewed !== true` show an amber dot and a "Mark as reviewed" action. Any human edit sets `reviewed: true`.

## Tests
- **Unit:** TextDoc ↔ TipTap JSON round trip; paste sanitising (strips spans, styles, images, scripts); chip `renderText`.
- **Component:** insert a chip via `{{`; change its measure to change %; the value updates from mocks; overflow tag appears and "Shrink to fit" clears it.
- **Playwright:** edit a heading, insert a KPI chip, undo, redo; proof PDF text contains the chip's formatted value.

## Out of scope
AI rewriting (RS-8). Number checking of typed digits (RS-9). Spell-check beyond the browser's.

## Done when
Text everywhere (free-form boxes and narrative flow) is editable with styles and live KPI chips, overflow is always visible with one-click fixes, and the printed PDF matches the editor.
