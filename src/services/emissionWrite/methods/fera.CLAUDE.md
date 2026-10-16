# S3-7 · Cat 3 split and the WTT double-count guard

> Module spec. Lane L2. Copy it to `ESG-lite/src/services/emissionWrite/methods/fera.CLAUDE.md`. PR titles `[S3-7 k/m] …`.
> Depends on (merged): S3-2 · Owns: `emissionWrite/methods/fera.ts`, `emission.scope3_sub` · Touches: `compute.ts` dispatch, FE drawers and the ledger (the sub-activity label)

## Job to be done
Cat 3 shows its three parts for ESGLite clients: upstream of fuels, upstream of electricity, and T&D losses. When a freight factor already includes WTT, ESGLite warns instead of counting it twice.

## Guidance
- Cat 3 has four sub-activities:
  - 3a: extraction, production and transport of the fuels bought;
  - 3b: the same for the fuels used to make the electricity bought;
  - 3c: generation of the electricity lost in T&D;
  - 3d: energy bought and resold (utilities).
  
  Use upstream factors that exclude combustion (Introduction L1360–1380; Cat 3 L2180–2310, tables 3.1–3.3).
- **T&D losses:** electricity consumed × grid loss rate × the life-cycle grid factor (the average-data method, L2542–2581).

## Today
- One FERA twin per fuel or energy row whose name matches a factor in the category named `fera` (`ESG-lite/src/services/emissionWrite/compute.ts:117-131`; `context.ts:255`).
- The factor lookup is exact, with no fallback (`resolve.ts:83-89`).
- What a FERA factor contains depends on what the admin uploaded.
- Freight factors are "DEFRA freighting + WTT … summed" (`ESG-lite/docs/emission-factor-sources.md:49-51`).

## Build
### Backend (ESG-lite)
1. `migrate:scope3-fera-sub`: `emission.scope3_sub`. Backfill existing FERA twins:
   - parent category scope Scope 1 → `3a_upstream_fuels`;
   - Scope 2 → `3b_upstream_electricity`.
2. `methods/fera.ts` (moved by S3-0):
   - The FERA factor must have `factor_type` `wtt` (3a, 3b) or `td_loss` (3c). Otherwise warn `FACTOR_TYPE_MISMATCH`.
   - For Scope 2 electricity rows, spawn up to two twins: 3b (WTT of generation) and 3c (T&D losses). The 3c twin needs a `td_loss` factor for the site's year: kWh × loss-rate-adjusted factor, uploaded as kgCO₂e per kWh consumed.
   - Each twin gets its `scope3_sub`, links via `fera_linked_id` as today, and approves together with its parent (`src/utils/feraFold.ts`).
   - When no factor is found: no twin, plus the `FERA_FACTOR_MISSING` warning (S3-4 added it on typed entries).
3. **Double-count guard:** when a Cat 4/9 row uses a factor whose snapshot says `factor_type life_cycle` and whose name or dataset notes include WTT (the §2 factor field `includes_wtt`, set by S3-2's backfill for factors whose source text says WTT is summed in), warn `WTT_ALREADY_IN_FACTOR` on the row. Recalculate nothing (D6).
4. **Factor guidance doc:** update `docs/emission-factor-sources.md` to say new freight factors should be uploaded as life_cycle without WTT, plus a separate wtt factor.

### Frontend (ESG-lite_FE)
1. Drawers and ledger: the FERA child row shows its sub-activity: "Category 3 · Upstream of fuels / of electricity / T&D losses".
2. Add data preview: "+ Cat 3 x tCO₂e (upstream of electricity) + y tCO₂e (T&D losses), added on save".
3. Factors page: a factor with `includes_wtt` shows a "WTT included" chip.

### AI service
None. S3-2 already keeps WTT columns separate.

## Golden cases
Run the Cat 3 examples from `cases.json` (3.x: upstream fuels, upstream electricity, T&D losses). `ci/golden` existing FERA totals stay unchanged (same factors, same twins). New 3c twins appear only where `td_loss` factors exist, and none do in the fixture.

## Tests
- API: the 3c twin is created only with a td_loss factor, the twins approve with the parent, and `WTT_ALREADY_IN_FACTOR` is raised on a flagged freight factor.
- Migration backfill run twice.

## Out of scope
- 3d (resold energy): no current client sells energy. If one does, add it as a manual Cat 3 form.
- Recalculating old freight rows (D6).

## Done when
- Every FERA twin has a sub-activity.
- T&D-loss twins work when factors are uploaded.
- Freight rows that double count WTT are flagged.
- The Cat 3 golden cases pass.

## As built (S3-7, 2026-10-15)
- Built on S3-2's branch (factor_type, includes_wtt). S3-0 merged in: `Scope3Sub` comes from `contracts/ghgCategory.ts`, and `FeraTwin` / `feraTwinFor` live in this folder's `fera.ts` (compute.ts re-exports them). The new codes went into `src/imports/errors.ts` (warnings); S3-0's `src/scope3/contracts/errors.ts` already names them.
- `methods/fera.ts`: `feraSubFor(scope)` (Scope 2 → 3b, anything else → 3a, also for categories with no scope), `upstreamFeraFactor` (today's exact name/global + year lookup minus `td_loss` factors), `tdLossTwinFor` (Scope 2 only; a `td_loss` FERA factor whose name or global name is the activity's, same year), `feraFactorTypeWarning` (`FACTOR_TYPE_MISMATCH` when a twin's factor is typed other than wtt/td_loss; untyped factors pass), `wttDoubleCountWarning` (`WTT_ALREADY_IN_FACTOR`: Cat 4/9 row, life_cycle factor, `includes_wtt`). The Cat 4/9 number is `category.ghg_category` once S3-1 adds it, else read from a Scope 3 category's name with S3-2's `ghgNumberFromName`.
- A FERA category holds one factor per name and year, so the T&D factor is named e.g. "Grid electricity T&D losses" with global name "Grid electricity" (see `docs/emission-factor-sources.md`, "Category 3 (FERA) factors").
- Links: the parent's `fera_linked_id` stays on the upstream twin; the 3c twin points at the parent only. Single approve, reject and delete act on the whole family from whichever row they are called on (`emissionWrite/feraFamily.ts`: the forward link plus every row linking to the row or to that link), so acting on one twin never leaves its sibling behind; replace follows every reverse link (`find`, not `findOne`); bulk paths and `feraFold` already did. `recalculateLinkedFera` never picks the 3c twin; `tdLossSync.ts` keeps it in step on user and manager edits (new total and the parent's review state; zeroed and back to Pending with a note when no T&D factor applies any more; created when an edit makes one apply, unless the FERA category is mode-locked for the period, as for new entries).
- `prepareEntry` returns `tdLoss` and `warnings`; plans carry `result.fera.scope3_sub`, `result.td_loss`, and the warnings as row issues; `insertRows` counts the 3c twin in `fera_inserted` and checks it for PLAN_STALE. `POST /user/emissions` adds `td_loss_emission` and `warnings` (only when present). The year export sums both twins in its FERA column.
- `migrate:scope3-fera-sub`: column + backfill (snapshot `td_loss` → 3c; partner in a Scope 2 category → 3b; else 3a), only where still NULL.
- Golden: `ci/golden` unchanged (no fixture has a td_loss factor). The three Cat 3 cases in `ci/golden/scope3/cases.json` run: upstream electricity and T&D losses from Example 3.1 (742,500 kg incl. heating, 404,175 kg), upstream fuels constructed from formula 3.1 (the guidance has no worked example; 7,600 kg). `ci/unit/s3-7-fera.test.cjs` checks the same Example 3.1 figures through the twins.
- Tests: `ci/api/tests/s3-7-fera-split.test.cjs` (twins, imports, approve/reject/delete, edits, WTT flag, migration twice), `ci/unit/s3-7-fera.test.cjs`.
- Not done here: the S3-4 edit path rewrite will replace `recalculateLinkedFera`; when it lands, `syncTdLossTwin` should move onto its `computeRow` path.
- Not done here: Build 2's "no factor: no twin, plus `FERA_FACTOR_MISSING`" comes with S3-4 (#137, which adds the code); whichever of S3-4 and S3-7 merges second adds the warning where `prepareEntry` finds no upstream factor.
- With S3-15: the review checks' duplicate query skips a row's sibling twin (upstream and T&D twins both link to the parent), so a Scope 2 row with a T&D twin is never held as `NO_DUPLICATE`. Bulk and batch approve/reject also carry a picked twin's sibling.
- Edits: `recalculateLinkedFera` (the edit path's upstream twin) skips `td_loss` factors in all four lookups, so an edit never counts T&D on the upstream twin; its hand-built snapshot carries no `factor_type` until S3-4 moves edits onto `computeRow`.
