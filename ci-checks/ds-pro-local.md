Head: ef65394533249d8729375accb361e182c250cbd3

Date: 2026-10-21 (UTC). Reproduced `.github/workflows/ci.yml` locally with Postgres 16, NODE_ENV=test, Node 22.

| Job / step | Result |
|---|---|
| build: npm ci | PASS |
| build: tsc --noEmit | PASS |
| build: npm run build | PASS |
| build: unit tests (test:unit) | PASS |
| build: Scope 3 golden (test:scope3-golden) | PASS |
| data-safety: CI isolation check | PASS |
| data-safety: destructive-changes check | NOT RUN (pull_request only) |
| data-safety: base-branch build / base schema | NOT RUN (pull_request only; schema built from this branch's dist) |
| data-safety: schema-sync | PASS |
| data-safety: migrate:* scripts twice | PASS |
| data-safety: schema-diff | PASS |
| data-safety: migrate-all on seeded DB twice | PASS |
| data-safety: golden snapshot | PASS |
| data-safety: golden snapshot, review v2 | PASS |
| data-safety: API tests (ci/api/run.cjs) | PASS (0 fail, 7 skipped) |

The workflow has no separate lint job.
