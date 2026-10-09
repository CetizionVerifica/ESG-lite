# CI safety checks

`.github/workflows/ci.yml` runs on every pull request into `redesign/integration`
or `main`, and on pushes to them. Its job is to keep production data safe while
the redesign is built. CI never connects to production: the workflow holds no
secrets, and every database script refuses anything but the throwaway Postgres
container (`ci/lib/throwaway-db.cjs`).

| Check | What fails it |
|---|---|
| Typecheck and build | `tsc` errors, or a unit test in `ci/unit/` fails (PCF engine stages and the PCF-0 golden pilot, every value within ±0.5%) |
| CI has no production access | a workflow references a secret or a production DB variable |
| No destructive schema or data changes | an added line drops, truncates, renames or retypes schema, deletes every row, turns on `synchronize`/`TYPEORM_SYNC`, or a one-off script in `scripts/`/`seeds/` deletes or bulk-updates rows |
| Run migrate scripts twice | a `migrate:*` script fails, or fails on a second run (not idempotent) |
| Entities match the migrated schema | an entity change would drop/rename/retype a column, or an entity change ships without a `migrate:*` script (production never auto-syncs) |
| Calculation results match the snapshot | any stored `total_emission` or GHG report figure differs from `ci/golden/snapshot.json` |
| API tests | a test in `ci/api/tests/` fails (endpoint shapes, role checks, numbers for the redesign endpoints B1–B8) |

## When a check blocks you on purpose

**Destructive change you really need.** Ship it as expand-then-contract: add
the new column/table and copy data in one release, switch code over, and drop
the old one in a later release after a backup. Then put
`// data-loss-reviewed: <why this is safe>` on or above each flagged line and
ask a reviewer to add the `data-loss-reviewed` label to the PR. Both are
required.

**Calculation change that is deliberate** (new factor logic, a rounding fix):

```bash
# against a local throwaway database whose name starts with ci_
createdb ci_golden
export CI_THROWAWAY_DB=true DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres DB_NAME=ci_golden TZ=UTC
npm run build && node ci/schema-sync.cjs dist
UPDATE_SNAPSHOT=1 node ci/golden/run.cjs
```

Commit `ci/golden/snapshot.json` and list every figure that moved in the PR
description. To cover a new calculation path, add a case to
`ci/golden/cases.json` (and fixture rows to `ci/golden/fixture.sql`).

**New schema change.** Add an idempotent script (`IF NOT EXISTS`, additive
only) under `src/scripts/` and register it as `migrate:<name>` in
`package.json`. CI runs it against a copy of the base branch's schema.

## API tests

`ci/api/run.cjs` builds the schema from `dist/`, loads `ci/api/fixture.sql`,
boots the server and runs `ci/api/tests/*.test.cjs` with `node:test`. Run it
locally against a throwaway database:

```bash
createdb ci_api
export CI_THROWAWAY_DB=true DB_HOST=localhost DB_PORT=5432 DB_USERNAME=postgres DB_PASSWORD=postgres DB_NAME=ci_api TZ=UTC
npm run build && npm run test:api
```
