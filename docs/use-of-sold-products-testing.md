# Use of Sold Products — how this was tested

Companion to `use-of-sold-products.md`. Everything below ran against a local
environment restored from the production dump (263,769 baseline emission rows);
every test row created was deleted afterwards and the row count verified back
to baseline.

## Reference validation (the acceptance test)

The feature must reproduce the Luqom reference workbook (sheet "Scope 3.11")
exactly. It does, to the cent, via API and via the UI:

| Company | Formula | Expected | Got |
|---|---|---|---|
| Lampenwelt | 6,663,974 × 0.01 × 15,000 × 0.349 | 348,859.04 t | 348,859.04 t |
| Brumberg | 643,395 × 0.01 × 15,000 × 0.349 | 33,681.73 t | 33,681.73 t |
| Lampemesteren | 158,245 × 0.01 × 15,000 × 0.057 | 1,352.99 t | 1,352.99 t |
| QLF | 5,105,349 × 0.01 × 15,000 × 0.28 | 214,424.66 t | 214,424.66 t |
| **Category total** | | **598,318.42 t** | **598,318.42 t** |

Fuel method (10,000 litre petrol × 2.31 = 23.10 t) and gas method
(1,000 units × 0.5 kg × 80% × 1,430 = 572.00 t) verified the same way.

## Automated adversarial fleet (API level)

Six independent test lenses ran against the live local API, ~50 assertions:

1. **Duplicates** — exact repeat 409s; same country+month but different
   Product Name saves (new identity rule); Product match is trim/case-insensitive;
   `?replace=true` deletes only the targeted row.
2. **Mode lock** — CY/FY overlap blocked both directions, monthly-in-yearly-window
   blocked, lock releases on delete, messages name the exact window.
3. **Edit paths** — user PUT recomputes the product (not one-field math);
   manager-edit recomputes on approved rows and keeps status; user PUT on
   approved rows 403s; approval never recalculates.
4. **Edge cases** — MWh→kWh conversion exact; litre on the energy method 400s;
   % > 100, % = 0, negatives, and text in numeric fields all 400 with
   plain-language messages naming the field; huge values keep precision.
5. **Regression** — a legacy category (Stationary Combustion, Glochem Diesel)
   calculates bit-for-bit as before, including live FERA twin creation;
   spec categories never spawn FERA twins.
6. **Bulk upload** — mixed six-row sheet imports with totals identical to
   manual entry (4 inserted, 2 skipped with per-row reasons); a legacy
   category's bulk preview is unchanged.

All passed. The one real finding was the pre-existing (pre-branch) exposure of
`created_by` internals in emission API responses — already known to the team.

## Manual UI test script (12 tests, all passed)

Run click-by-click by a human on 2026-09-01: superadmin site assignment
activates the category and grants users · form shows/hides fields per method
and preselects units · all three methods compute the expected totals ·
missing-field and >100% errors block saving · duplicate popup fires only for
the same Product Name · yearly/monthly mode lock blocks with a plain message ·
manager approval keeps the total · no FERA twins · bulk upload auto-maps all
fields, imports 3, skips the broken row · Delete Batch cleans up exactly the
imported rows.

## Re-running

- Seed a site: `npx ts-node src/scripts/seedUseOfSoldProducts.ts <site_id>`
  (idempotent; factors for 2024+2025, so entries dated 2025/2026 resolve).
- Factor-year rule: an entry dated year N needs factors uploaded for year N−1.
- After any test session on real data, verify the emission row count against
  the baseline before calling it done.
