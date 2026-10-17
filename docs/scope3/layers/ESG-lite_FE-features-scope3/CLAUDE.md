# src/features/scope3 (ESG-lite_FE) — Scope 3 frontend layer

> Layer spec. Goes to `ESG-lite_FE/src/features/scope3/CLAUDE.md`. Read it after the root CLAUDE.md, `docs/redesign/01-plan.md`, F1–F3 and the S3 plan files, before your module spec.

## Shape
```
src/features/scope3/
  CLAUDE.md  routes.tsx (S3-0)
  boundary/     Page.tsx  components/  hooks/  api.ts       S3-1  route /settings/scope3
  suppliers/    …                                          S3-6  route /suppliers
  screening/    …                                          S3-12 route /settings/scope3/screening
  baseYear/     (a section inside boundary/)               S3-14
src/lib/scope3/
  contracts.ts  labels.ts (category, method, DQ, check labels)  dq.ts  checks.ts   S3-0 / S3-3 / S3-15
```
Changes to existing modules (add-data, my-month, approvals-ledger, ghg-report, emission-factors, reference-data, bulk-upload, capture-setup, targets-sbti) are made in their own folders, as the S3 module spec says. Shared pieces move to `src/ui`, never imported across features.

## Rules
1. **Server state through TanStack Query hooks** in each folder's `hooks/`. No ad-hoc `useEffect` fetching. Filters go in the URL (`?site=&period=&category=`).
2. **Labels only from `src/lib/scope3/labels.ts`**, e.g. "Category 1 · Purchased goods and services", "Supplier's own figure", DQ "Good / Fair / Poor".
3. **Category chip:** use the shared `src/ui/Scope3CategoryChip` (S3-1). It shows the number, the short name, and Unmapped when no number is set.
4. **DQ display:** the shared `src/ui/DataQualityBadge` (S3-3) shows overall Good / Fair / Poor with the five indicators in a tooltip. Never colour alone: always include the word.
5. **Methods in forms:** a radio-card group, most specific first, with a one-line plain explanation for each (canvas screen 3). The default is the form's `method_options[0]`.
6. **Tokens only, four themes, four widths, all states, keyboard, focus trap in dialogs, Playwright smoke test** (root definition of done).
7. **Copy:** sentence case, "tCO₂e", status words Draft / Pending / Approved / Rejected / Missing / Locked. Exclusion reasons are the client's own words, shown as written.
