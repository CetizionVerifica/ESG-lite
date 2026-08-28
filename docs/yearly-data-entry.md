# Yearly Data Entry — Backend

Branch: `feature/yearly-data-entry` · Pairs with the frontend branch of the same name.

## What this adds

Until now every emission record belonged to one **month**. For spend-based data
(purchase registers, capital goods) the source arrives **once per year**, so users
were forced to dump a whole year under a single month — e.g. Noida's 263k
Purchased Goods rows all stamped on one December date, which breaks the monthly
trend chart and Submission Status.

This branch adds **yearly reporting periods**:

- A record now carries `reporting_period` — `'monthly'` (default) or `'yearly'`.
- Yearly records also carry `year_type` — `'CY'` (calendar year, Jan–Dec) or
  `'FY'` (Indian financial year, Apr–Mar) — and are dated on their **period end**
  (CY → Dec 31, FY → Mar 31 of the following year).
- Yearly entry is available for **every category and scope** (widened
  Aug 2026 from the original spend-based-only rollout, by product decision).
  Note for entry discipline: metered data (electricity, fuel) is usually best
  kept monthly — filing it yearly is allowed but discards real monthly
  precision, and the mode lock then blocks monthly entry for that year.

## ⚠️ Deployment requirement

The entity now maps two new columns. **Run this on the production database
before or together with deploying this code**, otherwise every emissions query
fails:

```sql
ALTER TABLE emission
  ADD COLUMN IF NOT EXISTS reporting_period varchar(10) NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS year_type varchar(2);
-- optional but recommended:
ALTER TABLE emission ADD CONSTRAINT chk_reporting_period CHECK (reporting_period IN ('monthly','yearly'));
ALTER TABLE emission ADD CONSTRAINT chk_year_type CHECK (year_type IS NULL OR year_type IN ('CY','FY'));
```

All existing rows default to `monthly` — nothing changes for current data or
workflows until someone deliberately files a yearly batch.

Note: `data-source.ts` now gates `synchronize` behind `TYPEORM_SYNC` (see
"Dev tooling" below), so TypeORM will **not** auto-create these columns.

## The mode lock (double-counting protection)

A yearly batch already *contains* its months, so mixing monthly and yearly data
in one site + category + year would count the overlap twice. `createEmission`
rejects (HTTP 409, `mode_lock: true`, plain-language message naming the locked
date range):

| Attempted save | Blocked when |
|---|---|
| Monthly | a yearly batch's window covers the date |
| Yearly | monthly rows exist inside the yearly window |
| Yearly (CY) | an FY yearly batch overlaps it — CY and FY share up to 9 months |
| Yearly (FY) | a CY yearly batch overlaps it |

Allowed: many yearly rows in the same batch (they share the period-end date —
the old duplicate check is skipped for yearly rows for exactly this reason),
adjacent years, and different sites/categories.

Validation errors (HTTP 400): missing/invalid `year_type`, wrong period-end
date for the chosen calendar.

FERA twins: the auto-created FERA record inherits the parent's
`reporting_period`/`year_type`. If the FERA category already holds the other
mode for that window, the twin is skipped with a console warning (non-fatal,
mirroring the missing-factor behavior) instead of creating mixed-mode data.

## Key files

- `src/entities/Emission.ts` — the two new columns
- `src/services/reportingPeriod.ts` — period windows and the mode-lock check
- `src/controllers/emission.controller.ts` — validation + lock wiring in
  `createEmission`; duplicate check scoped to monthly; approve/reject no longer
  500 on an empty request body

## Unit dropdown fix (rides along on this branch)

The data-entry Unit dropdown used to show only the admin-configured unit list,
which drifts out of sync with the factor library (e.g. Chieron Stationary
Combustion configured Kg/tonne while its factors price Diesel per litre and
Natural Gas per Cubic meter — the expected unit was simply not offered).

`GET /user/units/site/:siteId/category/:categoryId` now resolves to a new
handler, `getUnitsForDataEntry`, which merges the DISTINCT `denominator_unit`
values of that site+category's emission factors into the response
(case-insensitively deduped, synthetic negative ids, description marks the
origin). Derived from the factors themselves, the list stays correct for every
site — including future ones — with no manual upkeep.

The admin management route (`/admin/units/...`) still uses the original pure
handler on purpose: the Superadmin Units page must list only real rows it can
edit or delete.

## Dev tooling (second commit — no production effect while env vars are unset)

- `LOCAL_FILE_STORAGE=true` swaps Cloudinary for a local-disk adapter
  (`src/config/localStorage.ts`, files under `backend/local-uploads/`, served
  from `/local-uploads`). Purpose: developing against a restored production
  dump — its rows reference **live** Cloudinary files, so a local delete test
  with real credentials would permanently destroy media the deployed product
  still serves. The adapter never makes a network call.
- `TYPEORM_SYNC` (default false) replaces the hardcoded `synchronize: true` in
  the dev branch of `data-source.ts`. Left on, TypeORM rewrites restored-dump
  tables that have no matching entity (activity_data, final_emission, invoice…).

## Testing

- 40 automated API/DB checks: every validation rule, both lock directions,
  boundary dates, approval flow, regression against all 263,769 existing rows.
  Two real bugs were found this way and fixed before merge: the CY/FY overlap
  hole, and the empty-body 500 on approve.
- 10 manual UI tests (screenshots on file with @samidaire).

## Known follow-ups (not in this branch)

- `/manager/submission-status` is not yearly-aware yet — months covered by a
  yearly batch still count as "missing".
- Bulk Upload (AI-service import) always files as monthly; it does not set the
  new fields yet.
- Migration of Noida's 263,186 December-stamped rows to `yearly` is prepared
  but **on hold** until the business confirms which reporting year that
  March-2026 import belongs to.

## Pre-existing issues noticed while testing (not caused or fixed here)

- Emission API responses embed the full `created_by` user relation including
  the bcrypt password hash and password-reset token — sensitive fields should
  be stripped from serialized users. Affects production today.
- `GET /user/emissions` appears to ignore its site filter and can return very
  large responses (~190 MB observed).
- An ordinary User can DELETE an approved emission (no status guard).
- Glochem (site 23) has category mappings for Capital Goods but **zero
  emission factors** uploaded for it — no one can enter Capital Goods data for
  Glochem until factors are uploaded.
- The category-mapping editor accepts free-text global names without checking
  they exist in the factor library, which silently breaks factor resolution.
