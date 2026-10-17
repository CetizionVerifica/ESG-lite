# KPI-11 · Framework reports and exports (GRI index, BRSR tables, ESRS datapoints)

> Module spec. Lane L1. Copy to `ESG-lite/src/kpi/reports/CLAUDE.md` and `ESG-lite_FE/src/features/kpi/reports/CLAUDE.md`. PR titles `[KPI-11 k/m]` (1/3 data + XLSX, 2/3 GRI PDF, 3/3 FE).
> Depends on: KPI-2, KPI-4, KPI-5, KPI-6 · Owns: `src/kpi/reports/*` (`gri.ts`, `brsr.ts`, `esrs.ts`, `xlsx.ts`, templates), FE `kpi/reports` · Touches: the report printer (new HTML templates only; `print.ts` unchanged)

## Job to be done
At year end, a Manager downloads each framework's view of the same approved values, ready to drop into the client's report or filing. Every number traces back to its evidence.

## Today
- **GHG report:** HTML is rendered (`src/reporting/render.ts`, `blocks.ts`, `brands.ts`) and printed to PDF with Playwright (`print.ts`). Routes use `authenticateReport` (token header or `?token=`), `guardCompanyParam` and `guardQuerySites`.
- **XLSX:** `xlsx` 0.18.5 is available in both repos.
- **Branding:** client brand packs exist (`brands.ts`).

## Build
### Backend
1. A shared model in `reports/model.ts` for a framework version, a year and sites. It holds the rows, each `{disclosure, kpi(s), value(s) in the framework's display_unit, previous year, fit + note, sites, evidence count, value ids}`, plus the omissions, each with its reason:
   - not material, with the ESRS reason;
   - excluded, with the KPI-3 reason;
   - missing.

   Approved values only (D14). Units are converted from canonical with KPI-4's `units.ts`.
2. **GRI (`gri.ts`):**
   - A content index: disclosure, title (our words), the value or "see page" for narrative items, unit, notes, omission and reason. Grouped by GRI 2 and the topic standards.
   - XLSX and PDF. The PDF is a new HTML template rendered with the client's brand through the existing printer.
3. **BRSR (`brsr.ts`):** XLSX with one sheet per principle covered (P3, P5, P6), laid out like SEBI's format tables.
   - Each table carries current and previous financial year columns, a BRSR Core marker, and an assurance-evidence column (evidence count).
   - Indicators the client doesn't track are listed as "Not tracked in ESGLite".
4. **ESRS (`esrs.ts`):** XLSX datapoint list by topic (E1…G1).
   - The columns are datapoint code, our title, value, unit, `if_material` status and note.
   - Not-material topics are listed with their reason.
5. `GET /kpi/reports/:framework?year=&sites=&format=json|xlsx|pdf` (Manager+, Admin; same report auth as GHG). The XLSX has an "Audit trail" sheet listing value ids, approver, approval date and evidence file names.

### Frontend (05-ux S6)
1. Reports → **Framework reports**, with a tab per enabled framework:
   - a table preview of the JSON model with omissions in their own section;
   - a banner listing pending values;
   - Download XLSX and Download PDF (GRI).
2. Each value links to its record drawer (KPI-8 drawer, read-only).

## Golden cases (`ci/golden/kpi/reports/`)
For a fixture company and year, the expected JSON model for GRI, BRSR and ESRS, worked by hand. It covers:
- unit conversion (energy GJ for BRSR, MWh for ESRS);
- omissions with reasons;
- previous-year columns;
- exclusion of draft and pending values.

## Tests
- **Unit:** the builders against the goldens; XLSX sheet names and headers; PDF render smoke (HTML snapshot).
- **API:** roles, report auth, tenant isolation, switch off.
- **Playwright:** each tab renders; the downloads return files; a pending banner links to review.

## Out of scope
BRSR XBRL and ESRS XBRL/iXBRL filing formats (D12; a later module). Narrative report writing (the existing `ai-narrative.ts` could later draft text).

## Done when
GRI (XLSX and PDF), BRSR (XLSX) and ESRS (XLSX) downloads contain the year's approved values in each framework's shape and units. Each one shows omissions with reasons and traces every value to its evidence.
