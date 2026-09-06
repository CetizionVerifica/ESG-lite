# Upstream / Downstream transportation — fixes (Sep 2026)

Branch `feature/transport-fixes` (stacked on `feature/use-of-sold-products`,
which it needs for the calculation-spec engine). Scope: **only** category 13
"Upstream transportation and distribution" and 18 "Downstream transportation
and distribution". Nothing else was changed; a DB backup was taken first
(`db-snapshots/pre-transport-fixes-2026-09-03.dump`).

## What was wrong (from the read-only audit)

Only 2 real transport rows existed in production data, so the problems were
traps in the setup and code, not corrupted history:

- The form multiplied weight × distance in the browser and saved **only the
  product** — inputs lost, edit showed blank boxes, the server could not
  re-check the maths, and in edit mode the preview picked up the row's *date*
  (2026) as the activity value.
- Switching the unit after typing silently reinterpreted the number.
- A second shipment on the same route in a month was a "duplicate" (and
  Replace hard-deletes the first).
- Bulk upload never multiplied separate Weight and Distance columns.
- Per-site configuration drift: three sites assigned but empty; Glochem and
  Noida could only enter tonne.km (no [km] options); Rail unreachable at every
  site; Chieron downstream had two distance columns; three different column
  vocabularies; stray `kg` / `g.km` / `kg.km` units; 260 legacy duplicate
  factor rows; a mistyped LPG-van 2024 factor.
- Smaller: the any-year factor fallback picked the OLDEST factor; a manager
  unit-only edit relabelled without recalculating and never refreshed the
  factor snapshot; the [km]/[tonne.km] "Unit mismatch" message gave no hint;
  the distance tool's button could get stuck after switching to Air, a failed
  sea lookup hid its straight-line fallback, and a bad address failed silently;
  Excel export wrote numbers as text.

## The fix — weight and distance become real fields

`column_config.calculation` gained a second mode, **`per_unit`**: the row's
`activity_data_unit` decides which fields multiply.

```json
{
  "mode": "per_unit",
  "identity_columns": ["Shipment Ref"],
  "legacy_field": "Distance travelled",
  "methods": {
    "tonne.km": { "multiply": ["Weight (tonne)", "Distance travelled"], "activity_unit": "tonne.km" },
    "km":       { "multiply": ["Distance travelled"],                   "activity_unit": "km" }
  }
}
```

- Unit keys are normalised (`Tonne KM`, `tonne-km`, `tkm` → `tonne.km`); the
  canonical spelling is what gets stored.
- **Legacy rows** (saved before the spec, holding only the product under
  "Distance travelled" and *no* Weight key at all) are recognised by the
  missing key and use that value as-is. A new form row always sends every
  key, so an empty weight on a new row is still refused.
- The computed product is also written to `activity_data.activity_value`, so
  reports/exports that read that key (GHG details consumption, etc.) show the
  right activity.
- `Shipment Ref` (text) joins the duplicate identity: same route + month +
  same ref = duplicate; different refs are two shipments.

Code:

- backend `src/services/calculationSpec.ts` — per_unit resolution, unit
  normalisation, legacy handling, canonical unit key; `src/entities/ColumnConfig.ts`
  types; `src/controllers/emission.controller.ts` — all three recalculation
  paths pass the unit, store `activity_value` and the canonical unit; manager
  edits now refresh the factor snapshot and recalculate on a unit-only change;
  export cells are numbers. `src/utils/findEmissionFactor.ts` — any-year
  fallbacks prefer the newest year.
- frontend `useEmissionCalculation.ts` — per_unit preview (mirrors backend),
  legacy rows, bookkeeping keys (date, ids, totals) never treated as values,
  "[km]/[tonne.km]" mismatch hint; `index.tsx` — numeric fields show per unit
  (Weight hidden for km), the synthetic tonne×km helper widget is off for spec
  configs (real columns instead), Map button on the Distance column,
  `min=0` on number inputs, mismatch hint in validation;
  `DistanceCalculatorModal.tsx` / `LocationSearchInput.tsx` — stuck-button,
  sea-fallback, zero-distance and silent-geocode fixes.
- ai-service `app/services/excel_parser.py` — per_unit spec in preview +
  import (Weight × Distance from separate columns), legacy handling, unit
  normalisation, freight unit conversions (tonne.km/kg.km/g.km),
  `activity_value` stored, uncomputable rows skipped with a reason.

## The setup — one standard per site

`npx ts-node src/scripts/repairTransportConfigs.ts [site_id ...] [--lpg2024=<value>]`
(idempotent) installs, for every site with a transport category assigned:

- columns **Travel Mode / Vehicle Type / Fuel Type/Class** (selects),
  **Shipment Ref** (text), **Weight (tonne)** and **Distance travelled** (numbers);
- Travel Mode `Road / Rail / Air / Sea`; both `[tonne.km]` and `[km]` twins for
  road; `Rail → Freight train → Rail freight [tonne.km]` mapped to the existing
  `Road - Rail` factor; `Flight` capitalised (the factor name keeps "flight" —
  lookups are case-insensitive);
- units `km` + `tonne.km` only (removes `kg`, `g.km`, `kg.km` for these categories);
- the standard DEFRA factor set copied from the template site (24) where a
  site had none; legacy two-part duplicate names deleted when unreferenced;
- the per_unit calculation spec above.

Ran locally on all 14 site/category pairs (sites 20, 21, 22, 23, 24, 27, 29).

**Still needs a human:** the mistyped `Road - Van - LPG [km]` 2024 factor
(0.7166; neighbours ≈ 0.29). The script only corrects it when given the
official DEFRA 2024 value: `--lpg2024=<value>`. Also the plug-in-hybrid van
factors exist only for 2024–2025; 2021–2023 values must come from DEFRA.

## Rail distance in the map tool (estimate)

The Calculate Distance popup has a **Rail** button. There is no public
rail-routing service (Google routes roads, not railways), so Rail *estimates*:
it uses the road route between the two points — freight rail follows the same
corridors, typically within 10–15% — and falls back to straight-line × 1.2 when
no road route exists. The card is labelled "estimated from the road corridor";
the GHG Protocol accepts estimated activity data when the method is stated.
A real rail router (self-hosted OSRM/GraphHopper on OpenStreetMap rail data)
is the upgrade path if a client's rail volumes justify it.

## Deployment guide (for the lead)

Branch `feature/transport-fixes` in all three repos (ESG-lite, ESG-lite_FE,
python_AI_service). It is stacked on `feature/use-of-sold-products`, which
must be merged first (it carries the calculation-spec engine and the DB column).

1. **Database** — one additive column, already required by the Cat-11 branch:
   `ALTER TABLE column_config ADD COLUMN IF NOT EXISTS calculation jsonb NULL;`
   Nothing else. No data migration; existing rows and configs are untouched.
2. **Backend** (ESG-lite) → 3. **Frontend** (ESG-lite_FE) → 4. **AI service**
   (python_AI_service). Each step is backwards-compatible with the previous one
   still running.
5. **Per-site configuration is Superadmin work, done through the UI**, not
   scripts: `transport-configuration-guide.md` (Smart Config route, ~10 minutes
   per category; existing sites only need two columns and the Calculation tab).
   Factor spreadsheet: `factor-files/UPLOAD-transport-factors.xlsx`.
   `src/scripts/repairTransportConfigs.ts` is kept as optional automation of
   the same steps; it is idempotent but not required.
6. Rollback: revert the three deployments; the `calculation` column can stay
   (NULL everywhere = old behaviour).

Until a config has a calculation rule, nothing changes for that site: spec-less
configs take the pre-existing code paths (regression-tested on Stationary
Combustion incl. FERA twinning).

## What we implemented

**Fixes**
1. Weight × distance was multiplied in the browser and only the product saved; edit showed blank boxes. Both are stored; the server recomputes.
2. Editing an old row picked up its date as the activity value. Bookkeeping keys are never treated as numbers.
3. Switching the unit silently reinterpreted the number. Fields change with the unit; a mismatch is refused with a hint.
4. A second shipment on the same route in a month was a "duplicate" and Replace hard-deleted the first. Shipment Ref joins the identity.
5. Bulk upload never multiplied separate Weight and Distance and saved uncomputable rows as zero. It multiplies; rows it cannot compute are skipped with a reason.
6. Any-year factor fallback picked the oldest year → newest.
7. Manager unit-only edits relabelled without recalculating and kept a stale factor snapshot → recalculated, snapshot refreshed.
8. Distance tool: stuck button after switching to Air, hidden sea fallback, silent geocode failure, zero distance accepted.
9. Excel export wrote numbers as text.
10. Entry form showed a wrong "expected unit" before the dependent dropdown was chosen (empty-name factor lookup).
11. Deleting a global column in use looked dead; the page now names the configs that use it.
12. Auto-Generate could create a config with zero mappings; it now warns and blocks.
13. AI service kept dead pooled DB connections after Postgres dropped sessions; they are probed and replaced.

**Changes**
- `per_unit` calculation mode; canonical unit spelling stored; computed product stored as `activity_value`; legacy rows recognised by the missing Weight key.
- Standard transport vocabulary (Travel Mode / Vehicle Type / Fuel Type/Class / Shipment Ref / Weight (tonne) / Distance travelled; units km + tonne.km).
- Site configuration is done in the Superadmin UI from the guides (scripts optional).

**Improvements**
- **Calculation tab** in Edit Column Config (per method / per unit, percent fields, preselected unit, identity columns, old-entries field).
- **Rail** in the distance tool: estimate from the road corridor, straight-line × 1.2 fallback, labelled as an estimate.
- Rail freight reachable as Rail → Freight train; Downstream identical to Upstream.
- Clear "[km] / [tonne.km]" mismatch message; expected unit shown as soon as a method is chosen.

**Open with the product owner**: official DEFRA 2024 value for `Road - Van - LPG [km]` (0.7166 looks mistyped); plug-in hybrid van factors 2021–2023. See `emission-factor-sources.md`.

## Deploy (short form)

Order: DB (the `calculation` column from the Cat-11 branch must already exist)
→ backend → frontend → ai-service → run the repair script per site (or once
for all assigned sites) → optionally `--lpg2024` once the value is confirmed.
Existing transport rows keep working unchanged (legacy handling); new entries
store weight and distance.

## Verified

API suite (19 checks): weight×distance stored and computed (0.48), second
shipment with another ref allowed, same ref 409, missing weight 400, km-only
rows, `Tonne.KM` spelling, Rail 1.04, Glochem km entry, legacy row edit keeps
0.48, manager unit-only change refused instead of relabelled, newest-year
factor fallback. Bulk preview: 5 × 1200 → 1.44, "tonne km" → 0.24, missing
weight → skipped with reason, km row 0.32. Category-11 and legacy-category
behaviour untouched (spec-less configs take the pre-existing code paths).
