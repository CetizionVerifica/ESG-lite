# S3-1 · Category taxonomy and Scope 3 boundary

> Module spec. Lane L1. Copy to `ESG-lite/src/scope3/boundary/CLAUDE.md` and `ESG-lite_FE/src/features/scope3/boundary/CLAUDE.md`. PR titles `[S3-1 k/m] …`.
> Depends on (merged): S3-0 · Owns: `src/scope3/taxonomy/*`, `src/scope3/boundary/*`, `category.ghg_category`, `company.consolidation_approach`, `company_scope3_category`, `category_ghg_map_proposal`, FE `features/scope3/boundary/*`, `src/ui/Scope3CategoryChip` · Touches: FE `reference-data` Categories tab, `migrate-all.cjs`

## Job to be done
Every Scope 3 category the client uses carries its GHG Protocol number. Each client has a page that lists all 15 categories as Included, Excluded or Not relevant, with the reason, and records the consolidation approach.

## Guidance
- Companies account for all 15 categories and must disclose and justify exclusions (Scope 3 Standard ch. 6 and 11; guidance Introduction, L1050–1100).
- The boundary approach (equity share, financial control, operational control) decides what goes in Cat 8, 13, 14 and 15 (guidance L4587+, L5718+).
- Report emissions per category (ch. 11).

## Today
- `category` has only `category_name` and a free-text `scope` (`ESG-lite/src/entities/Category.ts:18-22`). It is global and has no company link.
- Reports match the exact `'Scope 3'` string (`src/reporting/ghg-data.ts:196-198`).
- The boundary is the hard-coded "Operational control" (`src/reporting/ghg.ts:230,446`).
- A legacy id → name map exists (`src/utils/defaultExtraFields.ts:130-146`).

## Build
### Backend (ESG-lite)
1. `migrate:scope3-taxonomy`:
   - `category.ghg_category smallint null` with a check of 1–15.
   - `company.consolidation_approach varchar default 'operational_control'`.
   - Tables `company_scope3_category` and `category_ghg_map_proposal` (`01-contracts.md` §4).
2. **Backfill proposals** (D1): for each company × each category with scope 'Scope 3', propose a number:
   - from the legacy map names first,
   - then a keyword match against `ghgCategory.ts` names (for example "freight" → 4, "travel" → 6, "fera" → 3),
   - and write the confidence.
   It never writes `category.ghg_category` directly unless the confidence is 100 and the name equals a GHG name exactly.
   Seed `company_scope3_category` with 15 rows per company: `included` for numbers already in use, `screening` for the rest.
3. **Endpoints** `GET /scope3/categories`, `PUT /scope3/categories/:n`, `GET/POST /scope3/category-map`, `PUT /company/:id/consolidation-approach`, with roles per D12. `PUT` with status `excluded` or `not_relevant` and no reason → `EXCLUSION_REASON_REQUIRED`.
4. **Category create/update** (`category.controller.ts`): accept `ghg_category`. Reject it when scope ≠ 'Scope 3' (`GHG_CATEGORY_INVALID`). Once a company's map is confirmed, a new Scope 3 category without a number → `GHG_CATEGORY_REQUIRED`.
5. **Read model** `taxonomy.categoryNumberFor(category_id)`. S3-13 uses it for reporting, and it returns null for Unmapped.

### Frontend (ESG-lite_FE)
1. **Boundary page** `/settings/scope3` (Admin and Superadmin; Managers read-only):
   - Header with the consolidation approach select.
   - A table of 15 rows: number, name, direction, status select, reason, method note, the client's mapped categories (chips), and "Last changed by".
   - Excluded or Not relevant rows need a reason before Save.
   - A summary line: "11 included · 2 excluded · 2 not relevant".
2. **Unmapped panel** on the same page: proposals with confidence, with "Confirm", "Change number" and "Confirm all ≥ 90 %".
3. **Reference data Categories tab** (`src/features/reference-data/components/CategoriesTab.tsx`): the drawer gets a "GHG Protocol category" select, shown only for Scope 3. The list shows `Scope3CategoryChip`.
4. `src/ui/Scope3CategoryChip`: number plus short name, or "Unmapped" in the warning tone, with the full name in a tooltip.

### AI service
Optional: return a `ghg_category` hint in `category_matcher.py` (layer rule 4). If it isn't done here, S3-12 does it.

## Golden cases
None (no calculation).

## Tests
- API: tenant isolation on all 4 endpoints, the D12 role matrix, every new error code, the migration run twice, and the backfill re-run without creating duplicates.
- Playwright: an Admin excludes Cat 14 with a reason, and it shows on reload.

## Out of scope
Report changes (S3-13), screening estimates (S3-12), and the lease and investment fields (S3-11).

## Done when
- Every staging company has 15 boundary rows, and the categories in use have confirmed numbers or show Unmapped.
- Exclusions can't be saved without a reason.
- The consolidation approach is stored per company and readable by S3-13.
