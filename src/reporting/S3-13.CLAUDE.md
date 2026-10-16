# S3-13 · Scope 3 reporting (GHG report, PDF, XLSX, findings)

> Module spec. Lane L1. Copy to `ESG-lite/src/reporting/S3-13.CLAUDE.md` and `ESG-lite_FE/src/features/ghg-report/S3-13.CLAUDE.md` as the first commit. PR titles `[S3-13 k/m] …` (1/2 ESG-lite, 2/2 ESG-lite_FE).
> Depends on (merged): S3-1, S3-2, S3-3 · Owns: `src/reporting/ghg-scope3.ts`, PDF Scope 3 pages, FE `ghg-report` Scope 3 tab and Methodology section · Touches: `src/reporting/ghg.ts`, `ghg-data.ts`, FE `ghg-report/logic.ts`

## Job to be done
An auditor or customer reading the GHG report (screen, PDF or XLSX) sees Scope 3 for each of the 15 categories with its status, method, data sources, factor types, GWP set, data quality and supplier-data share, and the exclusions with their reasons: everything the Scope 3 Standard ch. 11 asks for.

## Guidance (what the GHG Protocol expects)
- Report a description of the methods per category (L1120-1121), the types and sources of activity data and factors (L1209-1210, L1382-1383), the GWP source (L1276-1277) and the data quality of Scope 3 data (L1410-1411); all point to Scope 3 Standard ch. 11.
- Cat 11 and 12 need the methods and assumptions (lifetime, end-of-life) described (L5246-5248, L5632-5633). Avoided emissions are reported separately and never deducted (L3908-3912, L5254-5255).
- Investment EEIO boundary (Scope 1+2 or all upstream) must be disclosed (L6321). Air radiative-forcing multipliers must be disclosed (L4218).
- Significant data-quality changes require base-year recalculation (L1420-1422): S3-14 fills that section.

## Today (evidence)
- PDF: one Scope 3 KPI tile and a chart by free-text category name (`ESG-lite/src/reporting/ghg.ts:258-266, 326-362`); boundary hard-coded "Operational control" (`ghg.ts:230, 446`); exclusions cover only sites without data and renewables, methodology is one sentence (`ghg.ts:446-448`). The PDF dominant-scope finding uses all three scopes (`ghg.ts:401`).
- Data: sums on the exact string 'Scope 3' (`src/reporting/ghg-data.ts:196-198`); report route `GET /reports/ghg` (`src/routes/report.routes.ts:12-13`).
- FE: Scope 3 tab is the generic scope table by category name (`ESG-lite_FE/src/features/ghg-report/components/ScopeTab.tsx:19-32`); no methodology section; XLSX sheets from `exportSheets` (`ghg-report/logic.ts:481`, written in `api.ts:122-131`).
- FE Findings names only S1 or S2 as dominant (`ghg-report/logic.ts:423`). S3-4 owns that fix.
- SBTi page knows only "Scope 3 ≥ 40 % needs a target" (`src/features/targets-sbti/logic.ts:17-18`); "Net emissions" means gross minus renewables (`src/ui/glossary.ts:72-75`, `src/features/overview/Page.tsx:143-144`).

## Build
### Backend (ESG-lite)
1. `src/reporting/ghg-scope3.ts`: `computeScope3(filters, companyId)` over approved rows. One row per category 1-15 plus "Unmapped" (`taxonomy.categoryNumberFor`, S3-1): `{n, name, direction, status, reason, method_note, tco2e, share_pct, methods: {key: pct}, primary_pct, value_chain_pct, proxy_pct, dq: {overall, good_pct, fair_pct, poor_pct}, datasets: [{dataset, version, factor_type}], gwp_sets, biogenic_tco2e | null, mapped_categories}`.
   - Sum `total_kgco2e`, then round to tCO₂e (D5). `value_chain_pct` = kg share whose method is supplier_specific, hybrid, site_specific, asset_, lessor_, lessee_, franchise_ or investment_specific. Datasets and GWP from `emission_factor_snapshot` (S3-2 fields); DQ emission-weighted (S3-3); proxy from `emission.proxy` when present (S3-12).
   - S3-0 follow-up: put this row shape in `contracts/schemas.ts` and FE `contracts.ts`; biogenic CO₂ and per-gas totals need the engine to write them per row (proposed `emission.gas_kg jsonb`, `emission.biogenic_kg`); until then those cells read "Not tracked".
2. `GET /reports/ghg/scope3` with the `/reports/ghg` filters and guards (`report.routes.ts`, one line; not in §4 Touches, list it), plus `consolidation_approach` and the GWP sets in use.
3. `ghg.ts`: boundary text from `company.consolidation_approach` (lines 230, 446); new Scope 3 pages built in `ghg-scope3.ts` after "03 · Detailed analysis by scope": "Scope 3 by category" (15 rows + Unmapped, gross, excluding biogenic CO₂ and not reduced by offsets), "Excluded and not relevant categories" (reasons as written), "Methodology by category", "Data quality" (matrix of DQ × tCO₂e, % value-chain data) and a "Base year" block that S3-14 fills (shows "No Scope 3 base year set" until then). Section 05 text names the GWP set(s).
4. Golden: `ci/golden` GHG report cases change only by kg-then-round (D5). List every old → new figure in the PR.

### Frontend (ESG-lite_FE)
1. `ghg-report/components/Scope3Tab.tsx` replaces `ScopeTab` for Scope 3: `DataTable` with `Scope3CategoryChip`, `StatusPill`, tCO₂e, share, method mix (labels from `src/lib/scope3`), % value-chain data, `DataQualityBadge`; excluded categories with reasons below; Unmapped row in the warning tone linking to `/settings/scope3`.
2. `ghg-report/components/MethodologySection.tsx` (new "Methodology" tab, `?tab=methodology`): boundary approach, GWP set(s), per-category paragraph (method mix, data types, datasets and versions, assumptions from `method_note`, proxy basis, RF choice), base-year slot for S3-14.
3. `logic.ts` `exportSheets`: add "Scope 3 by category" and "Scope 3 methodology" sheets; unit test the rows.
4. Findings: if S3-4's fix to `logic.ts:423` is not on `production` when this PR opens, make the same change (largest of S1, S2, S3; label "Scope 3 (value chain)") and say "includes the S3-4 Findings fix" in the PR; S3-4 then drops it.
5. SBTi hint in the Scope 3 tab, shown when Scope 3 ≥ 40 % of the total: "SBTi near-term targets must cover at least 67 % of Scope 3. Categories 1, 4 and 11 cover 71 %." Pure `scope3CoverageSet(rows, 67)` in `src/lib/scope3/sbti.ts` so S3-14 can reuse it on the targets page.

### AI service
None.

## Checklist
Scope 3 Standard ch. 11 (§11.1 required, §11.2 optional), transcribed from the Standard, which is not in the reference text: S3-0 to confirm the wording against the PDF. R = required.
| # | Item | PDF | FE | XLSX | Data from |
|---|---|---|---|---|---|
| R1 | Scope 1 and Scope 2 totals, separately | KPI row (exists) | Summary tab | Summary | today |
| R2 | Scope 3 total per category (1-15) | Scope 3 by category | Scope 3 tab | Scope 3 by category | S3-1, this module |
| R3 | Per category in tCO₂e, excluding biogenic CO₂, independent of offsets or trades | table footnote | tab footnote | sheet note | this module |
| R4 | Categories and activities included | status + mapped categories columns | same | same | S3-1 |
| R5 | Excluded categories or activities with justification (incl. Cat 10-12 for intermediate products of unknown use) | Excluded and not relevant | list under table | Scope 3 by category | S3-1 reasons |
| R6 | Base year: year, rationale, recalculation policy, base-year Scope 3 by category, context for recalculations | Base year block | Methodology tab | Scope 3 methodology | S3-14 |
| R7 | Biogenic CO₂ per category, separately | Biogenic column ("Not tracked" until follow-up) | same | same | S3-0 follow-up |
| R8 | Types and sources of data, factors, GWP values; data-quality description, per category | Methodology + Data quality | Methodology tab, DQ badge | Scope 3 methodology | S3-2, S3-3 |
| R9 | Methods, allocation and assumptions per category | Methodology by category | Methodology tab | Scope 3 methodology | S3-3, S3-1 `method_note`, S3-10/S3-11 |
| R10 | % of emissions from supplier or value-chain partner data, per category | value-chain column | same | same | S3-3, S3-6 |
| O1 | Per-gas breakdown (CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃) | "Not tracked" until follow-up | — | — | S3-0 follow-up |
| O2 | Breakdown by site or activity | existing site sections | Location tab | Locations | today |
| O3 | Avoided emissions and offsets separate, not netted | renewables callout (exists, `ghg.ts:447`) | — | — | S3-0 follow-up: "Net emissions" copy on Overview |
| O4 | Product performance and lifetime (Cat 11) | Cat 11 paragraph | Methodology tab | methodology | S3-10 |
| O5 | Organisational boundary approach | cover meta + section 05 | Methodology tab | methodology | S3-1 |
| O6 | Quantitative uncertainty | out of scope | — | — | — |

## Golden cases
No new guidance cases. Add `ci/golden/scope3/report.json` (S3-0 follow-up): the S3-8 to S3-11 example rows posted, approved, and read back through `GET /reports/ghg/scope3`; each category total equals the sum of its cases in kgCO₂e / 1000.

## Tests
- API (`ci/api/tests/s3-13-reporting.test.cjs`): company 2 token with company 1 site ids → 403/404 as `/reports/ghg`; Unmapped row present when a Scope 3 category has no number; excluded rows carry their reason; kg-then-round totals.
- FE unit: `scope3CoverageSet`, `exportSheets` new sheets, Findings with S3 largest.
- Playwright (`e2e/ghg-report.spec.ts`): Scope 3 tab shows 15 rows and an exclusion reason; Methodology tab reachable by keyboard; XLSX has both new sheets.

## Out of scope
Uncertainty (Appendix B). Base-year maths (S3-14). Fixing the Overview "Net emissions" wording (no owner yet). Per-gas maths in the engine.

## Done when
- PDF, screen and XLSX show every R1-R10 item, or "Not tracked" with the follow-up named.
- Boundary text comes from the company setting.
- The Findings rule can name Scope 3, and the SBTi 67 % hint shows when it applies.
- Changed golden report figures are listed in the PR and match D5.
