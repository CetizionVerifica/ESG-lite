# XI6 · Evals and audit (project files + python_AI_service `ci/evals`)

> Goes to `python_AI_service/ci/evals/CLAUDE.md` and `audit/e2e-workflow-audit.md` §13. Depends on XI0 to write; runs as modules merge. Audit lane.

## Outcome
Mapping quality and tenant safety are measured, not assumed, before any client sees the feature and after every prompt or model change.

## Build
- Eval set `ci/evals/workbooks/`: IM9's 12 workbooks plus manager-scope cases: a sheet naming a site outside the manager's scope; a User with category grants; a second upload of the same layout (expects a profile hit and zero model calls); a client switch off; a 20-sheet workbook; a workbook with totals and factors columns (must be ignored).
- Expected `MappingProposal` and planned-row counts per workbook (`expected/*.json`). Scorer `score.py`: field mapping accuracy, site/category resolution accuracy, activity match accuracy, out-of-scope rows flagged, model calls, hostile cell inert. Thresholds: ≥ 95 % fields, 100 % out-of-scope flagged, 0 cross-tenant writes.
- Runner drives `POST /v1/excel/propose` → `preview` → `import` against the throwaway stack from `audit/harness/start-stack.sh` with Manager, User, Admin and Superadmin tokens from `mcp-fixture.sql`; needs the model key as a cloud-environment secret (same as IM9 option A).
- Audit harness: `xi-probes.cjs` with rows XI-01..XI-08 (from the module specs) added to `audit/e2e-workflow-audit.md` §13; hourly audit run picks them up like `mcp-probes.cjs`.

## Acceptance
Thresholds met on the full set before XM-3; results recorded in `audit/results/`.
