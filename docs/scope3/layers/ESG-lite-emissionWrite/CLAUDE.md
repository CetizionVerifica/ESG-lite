# emissionWrite — Scope 3 additions

> Layer spec. Appended by S3-0 to `ESG-lite/src/services/emissionWrite/CLAUDE.md` under a "## Scope 3 methods (S3)" heading. Read it before changing anything in this folder.

## After S3-0
- `compute.ts` only dispatches: `computeRow(ctx, row)` picks `methods/<method>.ts` (`01-contracts.md` §6). Today's behaviour is `methods/activity.ts` plus `methods/spec.ts` plus `methods/fera.ts`, moved without any change. The golden suite must stay byte-identical in the S3-0 PR.
- Each method file exports `compute(ctx, row): ComputedRow | EngineError` and is owned by exactly one module: activity/spec → S3-0, spend → S3-5, supplier/hybrid → S3-6, fera → S3-7, proxy → S3-12. Other modules (S3-8, S3-9, S3-10, S3-11) add units, specs and factor rows, not new method files, unless their spec says so.

## Rules
1. **Same path for every channel.** Typed entries, bulk upload, smart import, Claude/MCP and (after S3-4) the historical import go through `planRows → prepareEntry → insertRows`.
2. **The snapshot is the audit trail.** Every new row stores the full `FactorSnapshot` (§6), `method`, `dq`, `data_type`. A spend row also stores `fx`, and a supplier row stores `supplier_id` and the `supplier_factor` id in the snapshot.
3. **Totals:** `total_emission` stays tCO₂e at 2 dp. `total_kgco2e` is written beside it at 4 dp (D5). Never round before multiplying.
4. **Warnings never block** (`01-contracts.md` §7). Errors block the row only, never the whole batch, except for the existing all-or-nothing import plan rules.
5. **FE mirror:** when a method changes, update `ESG-lite_FE/src/lib/emissions/emissionCalc.ts` in the FE PR of the same module, so the preview matches. The FE never sends a total (`CLIENT_TOTAL_IGNORED` stays).
6. **Edits:** `updateEmission`, `managerUpdateEmission` and the FERA recalculation move onto `computeRow` in S3-4, so edits get methods and DQ too.
