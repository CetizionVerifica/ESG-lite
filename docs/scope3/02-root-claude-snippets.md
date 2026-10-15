# 02 · Always-on rules for each repo's root CLAUDE.md

Added to each repo's root `CLAUDE.md` on 2026-10-15 (plan PRs, before S3-0), together with `ESG-lite/docs/scope3/` and the layer files.

## ESG-lite
```md
## Scope 3 (GHG Protocol categories 1–15) — see docs/scope3/
- Category numbers, methods, factor types, DQ scale, error codes and check ids live only in `src/scope3/contracts/`. Change them there first (S3-0 follow-up), then use them.
- Every total still comes from `src/services/emissionWrite`; each Scope 3 method is its own file in `emissionWrite/methods/`. Never compute a total elsewhere; golden totals (`ci/golden`) move only when the module spec says so and the PR lists every change.
- A Scope 3 category has a `ghg_category` (1–15); `category.scope` is validated ('Scope 1' | 'Scope 2' | 'Scope 3' | null).
- Every new emission row stores `method`, `dq`, `data_type` and a factor snapshot with `factor_type` and `gwp_set`. Spend rows store `fx` (rate and date used).
- Company Scope 3 boundary (`company_scope3_category`) is the only source of included/excluded status and reasons for reports.
- New tables and columns ship as idempotent `migrate:scope3-*` scripts in `scripts/migrate-all.cjs`; every new endpoint gets a tenant-isolation test.
```

## ESG-lite_FE
```md
## Scope 3 — see docs/scope3/ (in ESG-lite)
- New Scope 3 pages live in `src/features/scope3/` (Boundary, Suppliers, Screening); changes to existing modules follow the S3 module spec that names them.
- Category names, method labels, DQ labels and review check labels come from `src/lib/scope3/` only; never hard-code "Cat 1" strings in a page.
- The FE never saves a total: previews mirror the engine; method and DQ chips read server fields.
- Copy: "Category 1 · Purchased goods and services" (number then exact GHG Protocol name); plain method labels from contracts §1; status words Draft / Pending / Approved / Rejected / Missing / Locked.
```

## python_AI_service
```md
## Scope 3 — see ESG-lite docs/scope3/
- `app/scope3/` and the factor sheet parser read and map data only: they keep WTT and per-gas columns as separate factor types and may suggest an EEIO sector or a GHG category with a confidence. They never calculate totals or choose the method for a row.
```
