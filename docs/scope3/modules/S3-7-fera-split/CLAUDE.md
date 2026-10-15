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
