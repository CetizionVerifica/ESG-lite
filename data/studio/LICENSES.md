# Design Studio library: licences

Every element, icon, template and font the Design Studio ships is listed here (D17, `00-plan` risk
"Element and icon licensing"). Only our own drawings, MIT, ISC or OFL material is allowed. Each
element in `data/studio/elements/*.json` names one licence id below; `npm run test:unit`
(`ci/unit/ds-4-library.test.cjs`) and the seed loader fail when an element names an id that isn't
listed here. No Canva SDK, API, template, font or graphic is used.

## Our own drawings

Licence id: `own`

- Templates and layouts in `data/studio/templates/**` (GHG Inventory, ISO 14064-1, Board brief,
  One-page summary, and the Editorial, Night and Minimal sustainability designs): drawn by ESGLite
  from our own element set. Text is our own wording; framework names and codes only, never copied
  standard text (KPI D7).
- Shapes, lines and arrows, frame masks, photo grids, data elements and the ESG graphics (Scope 1, 2
  and 3 value chain, scope circles, Environment-Social-Governance pillars, upstream-to-downstream
  strip, Scope 3 categories wheel): drawn by ESGLite as editable groups of our own elements.
- The renderer's own icon set (`src/reporting/studio/render/icons.ts`: leaf, bolt, factory, truck,
  drop, recycle, users, globe, check, alert, info, flame, building, chart, target, sun, wind,
  shield, quote, arrow_right, dot).

Copyright ESGLite. For use inside ESGLite reports by its clients.

## Lucide icons

Licence id: `lucide-isc`

- About 300 icons from Lucide (https://lucide.dev), taken from the `lucide-static` npm package,
  version 0.563.0 (the version the FE's `lucide-react` uses), listed by theme in
  `src/studio/library/seeds/lucide.ts` and generated into
  `src/reporting/studio/render/iconsLucide.ts` and `data/studio/elements/icons.json`.
- Licence: ISC. "Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as part of
  Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2026."

> Permission to use, copy, modify, and/or distribute this software for any purpose with or without
> fee is hereby granted, provided that the above copyright notice and this permission notice
> appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
> SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
> AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
> NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
> OF THIS SOFTWARE.

The MIT portions (Feather, Cole Bemis) carry the MIT notice: permission is granted, free of
charge, to deal in the software without restriction, provided the copyright notice and the
permission notice are included in all copies.

## SDG badges

Licence id: `sdg-colours`

- The 17 SDG elements are drawn by our renderer (`render/elements/misc.ts`): a square in the goal's
  published colour with the goal number and our own short label. The official UN SDG icons and
  the SDG wheel are **not** used or copied.
- UN guidelines for the use of the SDG logo, colour wheel and 17 icons
  (https://www.un.org/sustainabledevelopment/news/communications-material/): the goal colours and
  numbers may be used for information about the goals; the UN emblem must never be used, and the
  material must not suggest UN endorsement of the company or its report. Our badges are
  informational only, carry no UN emblem, and a report that uses them makes no claim of UN
  endorsement.

## Fonts

Licence id: `ofl`

- The bundled report fonts (`src/reporting/studio/fonts/`, DS-1, RS R12): Source Serif 4, Source
  Sans 3, DM Serif Display, IBM Plex Sans, IBM Plex Serif, Archivo, Fraunces, Noto Sans, each under
  the SIL Open Font License 1.1 (https://openfontlicense.org). No custom font upload (D3).
