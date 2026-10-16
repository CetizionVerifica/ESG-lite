# S3-5 · Spend-based method done properly

> Module spec. Lane L2. Copy it to `ESG-lite/src/scope3/spend/CLAUDE.md`. PR titles `[S3-5 k/m] …`.
> Depends on (merged): S3-2, S3-3 · Owns: `src/services/fxRate.ts`, `src/scope3/spend/*`, `fx_rate`, `price_deflator`, `emission.fx`, `emissionWrite/methods/spend.ts` · Touches: FE add-data and bulk-upload spend fields

## Job to be done
A spend row is calculated with the exchange rate on the purchase date, adjusted to the price year of the EEIO factor. The rate used is saved on the row, so the figure can be reproduced in any later year.

## Guidance
- Spend-based method: Σ (value of goods purchased × emission factor per unit of economic value). Formula [1.5], guidance L2074.
- Use it when supplier-specific, hybrid and average data aren't feasible (L2054-2060).
- Transport spend (formula [4.7], L3411) and travel spend (L4323) work the same way.
- Adjust spend for inflation to the factor's base year, and use the factor's currency. EEIO is useful mainly for screening (L1420–1460).

## Today
- FX rates are live, cached for 12 h, applied on the day of calculation and not stored (`ESG-lite/src/services/fxRate.ts:3-12,35-59`; `emissionWrite/units.ts:52-64`).
- Only INR, USD and EUR convert (`units.ts:36-38`).
- `spent_value` and `currency` are extra fields outside the calculation (`src/utils/defaultExtraFields.ts:17-26`, `ColumnConfig.ts:64-66`).
- There is no EEIO model and no deflator.

## Build
### Backend (ESG-lite)
1. `migrate:scope3-spend`: `fx_rate`, `price_deflator`, `emission.fx`.
   - A daily job (`src/scope3/spend/fxJob.ts`, on the existing scheduler) stores one rate per currency per day from the current providers (open.er-api.com, then frankfurter.app).
   - The backfill loads 2019-01-01 → today from frankfurter (ECB) history for EUR-based pairs. For INR, BHD, SAR, AED and GBP use the ECB cross rates. BHD, SAR and AED are USD pegs: store the peg with source `peg`.
2. `methods/spend.ts`:
   - Activity = amount in `currency`, on `date_of_reporting`, or on `extra_data.invoice_date` when given.
   - Rate = `fx_rate` on that date, or the nearest earlier date within 7 days. Otherwise use the latest rate and warn `FX_RATE_FALLBACK`.
   - Deflate to the factor's `price_base_year` with `price_deflator` (country of the factor's currency). When no deflator is found, warn `NO_DEFLATOR` and apply none.
   - total_kg = spend × rate_to_factor_currency × (deflator[base] / deflator[spend year]) × factor_value.
   - Store `fx = {currency, rate, as_of, source}` and the deflator used in the snapshot.
   - An unsupported currency → `CURRENCY_NOT_SUPPORTED`.
3. `price_deflator` seed: US CPI-U annual (BLS, public) for USEEIO. Admins can upload other series via a small `POST /scope3/deflators` (Superadmin).
4. **USEEIO v2 factors (D3):** a seed script loads the published sector factor table (kgCO₂e per USD, with its base price year) as `factor_type = eeio_spend`, `dataset = USEEIO`, in a company-less library.
   - Each company copies the sectors it needs to its sites through the existing factor copy path.
   - **S3-0 follow-up:** company-less library rows aren't read by the engine today (`resolve.ts:49-54`), so the copy is the route. Note it in the PR.
5. **Spend forms:** when a form's method is `spend_based`, `spent_value` plus `currency` become calculation fields. A form-config migration flips the `extra_fields` entries for Cat 1/2 forms that already have both.

### Frontend (ESG-lite_FE)
1. Add data and bulk upload: the "From the amount spent" method shows Amount, Currency (only the supported list, from `GET /fx-rates/currencies`) and an optional Invoice date. The preview line reads "₹ 12,40,000 ≈ USD 13,950 (rate on 3 Sep 2026) × 0.42 kgCO₂e/USD (2022 USD, deflated)".
2. Drawers: show the stored rate and date.

### AI service
None. The EEIO sector suggestion is S3-12.

## Golden cases
Run `1.5` (spend, Cat 1) and `4.4` (spend, transport) from `cases.json`, plus a local case:
- INR 1,000,000 on 2026-09-03 at the stored rate, deflated 2026 → 2022.
- The expected value is computed in the test from the seeded rate and index, never from a live API.

## Tests
- API: rates stored daily (job test with a mocked provider), fallback warnings, unsupported currency, tenant isolation unaffected.
- Recalculating an old row uses its stored `fx`, not today's rate.

## Out of scope
PPP adjustment, and basic vs purchaser price. Note these as a future option in the methodology text.

## Done when
- Every new spend row stores the rate and date used.
- Re-running last month's calculation gives the same total.
- All currencies in the dropdown convert.
- The golden cases 1.5 and 4.4 pass.

## As built notes (review run 23)
- A current-year row (or any year without an index in `price_deflator`) is stored not deflated with `NO_DEFLATOR`, as the spec says. US CPI-U is seeded 2015–2024 only; 2025 and later are added with `POST /scope3/deflators` (Superadmin) or a later seed, after which new and edited rows use them. Rows already saved keep their stored snapshot until edited.
- Edits go through S3-4's `recalculateEntry` → `prepareEntry` with the row's `extra_data` and stored `fx` (reused while currency and purchase date are unchanged); `applyComputed` stores `fx` and the deflator snapshot.
- The USEEIO library rows (site-less, `eeio_spend`) are hidden from `GET /admin/emission-factors` unless `?library=1`; `GET /scope3/spend/library` lists them.
- `spent_value` is skipped as a quantity only on rows with `@method = spend_based`; `invoice_date` is never a quantity.
