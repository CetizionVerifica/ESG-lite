# KPI-4 · KPI value store: periods, levels, units, evidence, statuses, audit

> Module spec. Lane L2. Copy to `ESG-lite/src/kpi/values/CLAUDE.md`. PR titles `[KPI-4 k/m]` (backend only; FE pieces land with KPI-7 and KPI-8).
> Depends on: KPI-0 · Owns: `kpi_value`, `kpi_value_evidence`, `kpi_period_lock`, `migrate:kpi-values`, `src/kpi/values/*` (`period.ts`, `units.ts`, `aggregate.ts`, `service.ts`, `evidence.ts`), FE `src/lib/kpi/units.ts` · Touches: `audit_log` entity types

## Job to be done
Every KPI value is stored once, with the following, so that every screen and export reads the same, trustworthy numbers:
- its site or company, its period and the unit it was entered in;
- its canonical value, an optional breakdown and evidence;
- its status and full history.

## Today
- **Emission rows:** they carry status, `reporting_period`/`year_type` and evidence (`EmissionDocument`).
- **Locks:** `period_lock`, with `guardPeriodOpen`, a lease and `PERIOD_LOCKED`.
- **Units:** `src/services/emissionWrite/units.ts` (energy, mass, volume, distance).
- **Periods:** `src/services/reportingPeriod.ts` and `src/reporting/ghg-data.ts` (FY starts in April).
- **Storage:** documents go to Cloudinary through the existing document service.

## Build (backend)
1. Tables per 01-contracts §2 (values part) and `migrate:kpi-values`. Indexes are:
   - `(company_id, kpi_definition_id, period_start)`;
   - `(site_id, status)`;
   - the unique key.
2. **`period.ts`** (pure): `periodsFor(frequency, yearType, year)` gives the period starts, ends and labels; `periodOf(date, …)`; `dueDate(period, due_day)`. FY follows the company's `company_kpi_settings.year_type`.
3. **`units.ts`:**
   - `toCanonical(value, unit, kpi)` uses `getConversionFactor` from emissionWrite plus KPI dimensions it lacks: water (m³, L, kL, ML), count, %, currency (no conversion; same currency only), and time (hours).
   - Unknown or other-dimension units → `KPI_UNIT_NOT_ALLOWED`.
   - FE mirror: `src/lib/kpi/units.ts`, with a parity unit test against the same fixture.
4. **`aggregate.ts`** (pure): site → company and months → year, per `KpiAggregation`.
   - `sum` and `average` work as usual.
   - `weighted_average` needs a weight KPI (e.g. LTIFR weighted by hours worked).
   - `latest` takes the last period, and `none` means company level only.
   - Missing periods are reported as missing, never treated as 0.
5. **`service.ts`:**
   - `upsertDrafts(caller, items)`: the scope and assignment check (layer rule 2), `KPI_NOT_SELECTED`, `KPI_AUTO_READ_ONLY`, `KPI_PERIOD_LOCKED`, type/range/breakdown validation (`KPI_VALUE_INVALID`), canonical conversion and audit.
   - `submit(ids)`: Draft → Pending, refusing with `KPI_NOT_DRAFT`, `KPI_EVIDENCE_REQUIRED` (BRSR Core, D15) or `KPI_PERIOD_LOCKED`.
   - `edit of rejected`: makes the value a Draft again.
   - Lock rows follow the `period_lock` pattern, including the write lease from S3-15 part 2.
6. **`evidence.ts`:** add and remove on a value (the owner, or a reviewer before approval). Approved values keep their evidence; a removal after approval is logged.
7. **Reads:** `GET /kpi/values` (filters per 01-contracts §3), where drafts are visible to their author and to Admins only.

## Tests
- **Unit:** periods (CY/FY, monthly, quarterly, annual, due dates); units (each dimension, refusal across dimensions); aggregation (each rule, missing ≠ 0, weighted).
- **API:**
  - each error code;
  - drafts hidden from others;
  - a rejected value edited back to Draft;
  - evidence on and off;
  - locks refusing writes;
  - tenant isolation, roles, switch off;
  - migration twice.

## Out of scope
The entry UI (KPI-7). Review checks (KPI-8). Auto and formula values (KPI-5, KPI-6) use this store through a system writer.

## Done when
Any KPI value can be stored, converted, aggregated, evidenced, submitted and locked through one service, with every change audited.
