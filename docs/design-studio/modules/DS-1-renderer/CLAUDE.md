# DS-1 · Renderer v2: formats, bleed, new elements, FE mirror

> **Module spec**, lane L1, wave 1. Copy to `ESG-lite/src/reporting/studio/render/CLAUDE.md`.
> **PR titles:** `[DS-1 k/m]`, five PRs:
> 1. formats + sheet + theme;
> 2. elements (RS set);
> 3. new elements (frame, grid, line, big_number, progress, callout, qr);
> 4. flow sections + pagination;
> 5. print.ts (pdf screen and print, png) + sync script + FE mirror.
>
> **Depends on:** DS-0 · **Owns:** `src/reporting/studio/render/*`, `src/reporting/studio/print.ts`, `fonts/`, `scripts/sync-studio-render.mjs`, FE `src/lib/studio/render/*`
> **Base:** RS-1 (`docs/design-studio/rs-base/modules/RS-1-renderer/CLAUDE.md`). Keep everything there. Changes are below.

## Changes from RS-1
1. **Formats** (`formats.ts`):

   | Format | Size (mm) |
   |---|---|
   | `a4` | 210×297 |
   | `a4_landscape` | 297×210 |
   | `letter` | 215.9×279.4 |
   | `a5` | 148×210 |
   | `slide_16_9` | 338.7×190.5 (1280×720 px at 96 dpi) |
   | `square` | 285.75×285.75 (1080 px) |
   | `social_191` | 317.5×166.1 (1200×628) |

   Each format has a safe margin and a bleed (3 mm for print formats, 0 for screen formats). `@page` size comes from the format.
2. **Modes:** `sheet` (editor), `paged` (Page view), `present` (full-screen slides with notes hidden), `print` (bleed + optional crop marks).
3. **New elements:**
   - `frame`: an image clipped by a mask (rect, rounded, circle, arch, blob), with crop in the frame's coordinates;
   - `grid`: n frames with a gap;
   - `line`: start and end points, arrowheads, dash;
   - `big_number`: a bound value + label + delta;
   - `progress`: a ring or bar from a `progress` measure;
   - `callout`: an icon + text in a tinted box;
   - `qr`: a URL → SVG QR, generated in pure TS.
4. **Unavailable values** render "Not reported" (RS rule 4).
5. **PNG:** `print.ts renderPng(doc, pages, scale)` screenshots each page element at the given device scale.
6. **Charts:** the RS chart kinds. GHG kinds come in DS-8, with an extension point (`charts/registry.ts`).
7. **Flow types:** add `ghgp_index`, `iso_index`, `ghg_factor_table` and `scope3_categories` (a table of all 15 with reported / excluded and the reason).

## Tests
- Snapshot goldens per element, per format, and per mode.
- Pagination goldens for a 300-row table.
- `__measure` reports overflow and safe-area breaches.
- The proof PDF text positions equal the final's.
- The mirror hash check passes in both repos.

## Done when
A ReportDoc v2 fixture renders identically in the FE shadow root, in Page view and in both PDFs for every format; PNG export works; the FE mirror is in sync.
