# Design Studio: research

Research only, written 2026-10-20. Read `00-plan.md` for what we build. The earlier report-design research (best reports, chart rules, editor SDKs, paged preview, number accuracy) is in `plans/kpi-report/research.md` and still holds.

**How the Canva facts were gathered:**
- canva.com returns HTTP 403 to automated fetches, so its help, newsroom and policy pages were read through search extracts.
- canva.dev (the Connect docs and changelog) was read in full.
- Items marked **[unverified]** rest on secondary sources.

## 1. Canva in October 2026: what changed
- **Canva Create 2026 (April) launched "Canva AI 2.0":** conversational design with targeted edits, "brand intelligence" and memory, connectors, Sheets AI and Canva Code 2.0. https://canva.com/newsroom/news/canva-create-2026-ai
- **"Docs to Decks" has been removed.** The workaround is presentation pages inside a Doc. https://www.canva.com/en_in/help/docs-to-decks/
- **The Canva Button (embedded editor) is sunset outside China after 2025-12-30.** https://www.canva.com/help/canva-button/
- **Autofill API widened:**
  - Pro and Teams plans can now use it, not only Enterprise (2026-09-21);
  - chart fields went GA (2026-09-23);
  - sheet fields were added (2026-09-17). https://www.canva.dev/docs/connect/changelog/

## 2. Canva features mapped to ESGLite: Adopt / Adapt / Skip

### 2.1 Editor anatomy
| Canva | What it does | ESGLite | Where |
|---|---|---|---|
| Left side panel with tabs (Elements, Apps; full tab list **[unverified]**) | Insert content from drawers | **Adopt:** a rail with Templates, Elements, Text, Brand, Uploads, Data, Charts, AI, Pages | DS-6, `05-ux` |
| Canva AI button, top left | Opens the assistant | **Adapt:** an AI rail tab; suggestions only | DS-9 |
| Floating/contextual toolbar | Options for the selection | **Adopt** | DS-6 |
| Position → Arrange and Layers; align to page or selection; Tidy up | Layout control | **Adopt** | DS-6 |
| Lock elements and pages (locked page → can't unlock elements) | Protect content | **Adopt** + template locks (RS-10) | DS-6, DS-13 |
| Scroll / thumbnail strip / grid views (Alt+Ctrl+1/2/3), page titles, notes, zoom | Page navigation | **Adopt** | DS-6 |
| Rulers, guides; **fixed** margins and bleed | Precision | **Adapt:** margins and bleed are set by the template format, and guides are per page | DS-1, DS-6 |
| Real-time co-editing with cursors | Live collaboration | **Skip** (presence only, RS R15) | D3 |

Sources: https://www.canva.com/help/elements/ · https://www.canva.com/en_gb/help/layer-group-align/ · https://www.canva.com/en_gb/help/lock-and-unlock-elements/ · https://www.canva.com/en_gb/help/manage-pages/ · https://www.canva.com/en_gb/help/margins-bleed-crop-marks/ · https://www.canva.com/en_au/help/adding-and-removing-guides/

### 2.2 Templates, Styles and brand
| Canva | ESGLite | Where |
|---|---|---|
| About 6,459 report templates, annual and ESG covers, many A4 | **Adapt:** a few deep, data-bound templates per kind (D9) instead of thousands of static ones | DS-4 |
| Apply a template per page or to the whole design **[unverified]** | **Adopt:** layouts add one page; a template applies to all pages | DS-4, DS-6 |
| Styles: palette + font set across pages, Shuffle; Colour themes from the Brand Kit | **Adopt** | DS-3 |
| Brand Kit: logos, colours, fonts, brand voice (≤ 500 words, used by Magic Write) | **Adopt:** our brand + palettes + fonts + voice | DS-3 |
| Brand Controls: restrict to brand colours and fonts, require approval | **Adapt:** `company.brand_controls` and `report_require_review` | DS-13 |
| Brand Templates with locked elements and data fields | **Adopt:** template locks; data fields are our bindings | DS-4, DS-13 |

Sources: https://www.canva.com/reports/templates/ · https://www.canva.com/en_gb/help/color-and-font-combinations/ · https://www.canva.com/en_gb/help/color-themes/ · https://www.canva.com/help/brand-kit/ · https://www.canva.com/en_in/help/brand-control/ · https://www.canva.com/design-school/resources/how-to-design-unbreakable-brand-templates

### 2.3 Data
| Canva | ESGLite | Where |
|---|---|---|
| Chart → Edit opens a data table; CSV/XLSX import ≤ 1,000 × 100 | **Adapt:** charts bind to approved data. A "custom data" chart is the Canva-style typed table, badged Unlinked. | DS-8 |
| Canva Sheets + Magic Charts (stay in sync until disconnected); data connectors need Business/Enterprise | **Adapt:** our "sheet" is the approved data; the sync is permanent | DS-2 |
| Tables: borders, colours, merge cells; **no documented auto-flow across pages** | **Adopt + extend:** flow tables paginate with repeated headers | DS-1, DS-7 |
| Data autofill / Bulk Create (fields → many designs) | **Adapt:** templates are filled from data on build; per-site editions are a later option | DS-5 |
| Connect Autofill API (dataset → autofill job → edit URL) | **Skip** (D2) | — |

Sources: https://www.canva.com/en_in/help/set-up-chart-data/ · https://www.canva.com/en_in/help/import-to-charts/ · https://www.canva.com/en_in/help/magic-charts/ · https://www.canva.com/en_gb/help/formatting-tables/ · https://www.canva.com/en_in/help/data-autofill/ · https://www.canva.dev/docs/connect/autofill-guide/

### 2.4 AI
| Canva | ESGLite | Where |
|---|---|---|
| Canva AI 2.0 chat with targeted edits | **Adapt:** chat returns suggestion cards; nothing is applied without Accept | DS-9 |
| Magic Write + brand voice | **Adopt** (named "Write with AI") | DS-9, DS-3 |
| Magic Design (design from a prompt) | **Adopt:** "Design from a brief" picks a template and outline | DS-9 |
| Magic Resize / Magic Switch (formats, translate) | **Adopt** resize to deck, summary and social; translation skipped (D3) | DS-10 |
| Magic Media, Edit, Expand, Grab, Layers | **Partial:** cover art only (`imagery.ts`); the rest skipped | DS-4 |
| Admin toggle for AI features | **Adopt:** per-company AI budget and an off switch | DS-9 |

Sources: https://www.canva.com/ai-assistant/ · https://www.canva.com/en_in/help/use-magic-write/ · https://www.canva.com/newsroom/news/magic-studio/ · https://www.canva.com/en_in/help/magic-features-admin-controls/

### 2.5 Collaboration and output
| Canva | ESGLite | Where |
|---|---|---|
| Share links: edit / comment / view; public view links | **Adapt:** view-only links to stored PDFs, expiring (D15) | DS-11 |
| Comments, @mentions, assign tasks | **Adopt** | DS-13 |
| Request approval: reviewer, due date, Approve / Request changes | **Adopt** | DS-13 |
| Version history (≤ 1,000 versions); **no frozen final** | **Adopt + extend:** history plus immutable finals | DS-13, DS-11 |
| PDF Standard (96 dpi) / PDF Print (300 dpi, bleed, crop marks, CMYK); PNG, PPTX, DOCX | **Adapt:** PDF screen + print (RGB), PNG; no CMYK, PPTX or DOCX (D3, D12) | DS-11 |
| Present mode, publish as website | Present **adopted**; website skipped | DS-11 |

Sources: https://www.canva.com/en_gb/help/collaborate-with-anyone/ · https://www.canva.com/en_in/help/mention-collaborators/ · https://www.canva.com/en_gb/help/get-approval/ · https://www.canva.com/en_gb/help/version-history/ · https://www.canva.com/en_gb/help/download-file-types/

### 2.6 Why we don't integrate Canva itself (D2)
- **No embedded editor:** the Canva Button is gone. Connect only deep-links users out to canva.com, and each end user needs a Canva account and plan. https://www.canva.dev/docs/connect/ · https://www.canva.com/help/canva-button/
- **Data is copied, not linked:** Autofill is a one-shot or update job, so a figure has no lineage and no audit trail, and nothing stops a person from typing over a number.
- **No ESG document structure:**
  - long tables don't paginate;
  - no auto contents page with real page numbers;
  - no framework indexes;
  - no frozen final;
  - no unit or precision rules.
- **Licensing:** Canva content can't be reused outside Canva, and the most restrictive licence in a design applies to the whole design. https://www.canva.com/policies/content-license-agreement/
- **Embeddable alternatives** (RS research §4): Polotno (Team $199/mo, Business $399/mo, https://polotno.com/sdk/pricing-update) and IMG.LY CE.SDK (quote only). We still prefer our own renderer, so that charts and tiles stay data-bound components and preview equals PDF.
- **A later "Send to Canva"** (Design Import of our PDF) is possible as a one-way export for clients who want it.

### 2.7 The 15 Canva features that matter most for a 20–60 page report (ranked) and their DS module
1. Multi-page canvas with scroll, strip and grid views (DS-6)
2. Brand Kit + Styles + colour themes (DS-3)
3. Brand Templates with locks (DS-4, DS-13)
4. Data fields / Autofill → bindings (DS-2)
5. Editable charts with a data table (DS-8)
6. Charts in sync with data (DS-2, DS-8)
7. Tables (DS-1, DS-7, DS-8)
8. Print PDF with bleed and crop marks (DS-11)
9. Comments, mentions, tasks (DS-13)
10. Approval workflow (DS-13)
11. Version history (DS-13)
12. Position / Layers / Tidy up / group / lock (DS-6)
13. Rulers, guides, margins (DS-6)
14. AI writing with brand voice (DS-9)
15. Resize to other formats (DS-10)

## 3. What a GHG inventory report must contain

**Sources:**
- GHG Protocol Corporate Standard, ch. 9: https://ghgprotocol.org/sites/default/files/standards/ghg-protocol-revised.pdf
- Scope 2 Guidance, ch. 7: https://ghgprotocol.org/scope-2-guidance
- Scope 3 Standard, ch. 11: https://ghgprotocol.org/corporate-value-chain-scope-3-standard
- ISO 14064-1:2018: https://www.iso.org/standard/66453.html (paywalled; the clause 9.3 item list is **[unverified]**)
- SEBI BRSR Core: https://www.sebi.gov.in/sebi_data/commondocs/jul-2023/Annexure_I-Format-of-BRSR-Core_p.pdf
- ESRS E1: https://www.koda.ee/sites/default/files/content-type/content/2023-01/ESRS%20E1.pdf
- Revised ESRS (adopted 3 Jul 2026): https://dart.deloitte.com/USDART/home/news/all-news/2026/jul/ec-delegated-acts-revised-esrss-voluntary-sustainability-reporting-standard

**Required content:**
- **GHG Protocol (required):**
  - organisational boundary and consolidation approach;
  - operational boundary;
  - the reporting period;
  - Scope 1 and Scope 2 totals;
  - per-gas breakdown (CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃);
  - base year, the reason for it, and the recalculation policy;
  - biogenic CO₂ reported separately;
  - methods and factors;
  - exclusions.
- **GHG Protocol (optional):** Scope 3, breakdowns, intensity, targets, offsets (separately), uncertainty.
- **Scope 2 Guidance:** dual reporting (location-based and market-based), the instruments used, residual mix.
- **Scope 3 Standard:**
  - every one of the 15 categories reported or excluded with a reason;
  - per category: data sources, methods, the % from supplier data, and data quality.
- **ISO 14064-1 [unverified list]:**
  - the responsible person;
  - categories 1–6;
  - the GWP source;
  - uncertainty;
  - a conformance statement;
  - a verification statement.
- **BRSR P6:** Scope 1 and 2, intensity per rupee of turnover, PPP-adjusted intensity, physical-output intensity; Scope 3 in the leadership indicators.
- **ESRS E1-6:**
  - gross Scope 1, 2 (both bases) and 3, and the total on both bases;
  - the % of Scope 1 under an ETS;
  - intensity per net revenue;
  - biogenic CO₂ separately.

**Section order for the Inventory template (D9):**
1. Cover + statement of compliance + contents
2. Executive summary (totals, change vs base year, intensity)
3. About the organisation and responsible person
4. Organisational boundary
5. Operational boundary and exclusions
6. Period, base year, recalculation
7. Methodology (activity data, factors and versions, GWP set)
8. Results:
   - Scope 1 by source and gas;
   - Scope 2 (both bases);
   - Scope 3 by category;
   - by site.
9. Biogenic CO₂, removals and offsets, shown separately
10. Intensity
11. Trend, base year and targets
12. Data quality and uncertainty
13. Reduction initiatives
14. Assurance statement
15. Annexes: factor table, framework cross-walks, glossary

These map to the checks in `01-contracts` §6.

## 4. What ESGLite has today (origin/production `2cf9290` / FE `586b205`)
- **GHG PDF pipeline:**
  - `src/reporting/ghg.ts:58 generateGhgReport(filters, companyId)` builds a typed `Report = Block[]` (`types.ts:32-185`): cover, section, kpiTiles, narrative, chart, table, callout, image, statBoard, kpiRow, hbar, shareBar, stackedBars, groupBars, figures, bullets, notes, paragraph;
  - `render.ts:381` turns it into HTML with ECharts and paged.js;
  - `print.ts` prints it with Playwright.
  - The PDF is written to `generated-reports/`, streamed, then deleted; nothing is stored.
  - Routes: `GET /reports/ghg[/:companyId]` (`src/routes/report.routes.ts`).
  - Filters: `siteIds`, `categoryIds`, `yearType` CY/FY (FY starts in April), `year`, `compareYear`, `frequency`, `month`, `quarter`.
- **Data:**
  - `ghg-data.ts:162 computeGhgTables`: approved `Emission` rows only, per scope, compare year, by location;
  - `computeGhgByFuelType` (`:579`);
  - `ghg-scope3.ts:293 computeScope3`: categories 1–15, method, DQ, data type, factor dataset and version, GWP set, biogenic;
  - the base year from `src/scope3/baseYear` (Scope 3 only);
  - `company.consolidation_approach`;
  - per-gas kg (CO₂, CH₄, N₂O) and `biogenic_kg` on `Emission` (S3-4).
- **Gaps for the GHG report:**
  - market-based Scope 2 is not recorded (`src/kpi/auto/ghg.ts:88`);
  - intensity lives only in the EDE controller (`emission.controller.ts:2230`);
  - targets and SBTi aren't in the report;
  - methodology is a static notes block (`ghg.ts:473`);
  - no responsible person, uncertainty or verification fields.
- **AI:** `ai-narrative.ts` (OpenRouter, `OPENROUTER_MODEL` default `google/gemini-3-flash-preview`) returns summary, notes and recommendations, with a fallback text. `imagery.ts` makes cover art (not used by `ghg.ts`).
- **Brand:**
  - `Brand` entity: `primary`, `accent`, `cover_from`/`cover_to`, logos (light and dark), guideline file, `default_look` classic/light/night, `scope3_colour`;
  - `brands.ts:88 getBrandTheme`;
  - FE `brand-themes` uses an editor-plus-preview pattern.
- **FE:**
  - `features/ghg-report/Page.tsx`: filters, tabs (summary, location, scope1–3, methodology, findings), Download PDF (blob), xlsx export. No preview iframe.
  - No rich-text or drag/transform library yet (no tiptap, dnd-kit or react-moveable).
  - React 19, Tailwind 4, ECharts 6.
- **Switch pattern:**
  - `Company.kpi_tracking_enabled` + `src/kpi/guard.ts requireKpiTracking` (403 `KPI_TRACKING_OFF`);
  - toggles on `clients/DetailPage.tsx:180-181`;
  - FE `requires: "kpi"` in `routeMap.ts`.
- **Studio code:** none in either repo; no branch.
