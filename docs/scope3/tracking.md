# How the "Scope 3 lanes" board updates itself

Board: https://claude.ai/artifact/48P5pGPghjwrFuAJoCGXsm. An hourly scheduled task reads GitHub and writes the board. Nobody needs to edit it, except to mark a module Blocked or add a note.

## What the team does (the only rule)
- A branch named `s3-<n>-<short-name>` (or any branch) with a PR into `production` titled `[S3-<n> k/m] …`.
- The module's last PR body has the line `Completes: S3-<n>`.
- Open the first PR as a draft right away (claim before build). That draft is the claim.

## How status is worked out per module (all three repos)
| GitHub state | Board status | Owner |
|---|---|---|
| No PR or branch | unchanged (Not started, or what a person set) | unchanged |
| Branch `s3-<n>-*` pushed, no PR | Claimed | pusher, if known |
| A draft PR open | In progress | PR author |
| A non-draft PR open, no review yet | PR open | PR author |
| A non-draft PR with a review or in the merge ledger | In review | PR author |
| A PR whose body says `Completes: S3-<n>` is merged | Merged | PR author |

- PRs: every `[S3-<n> …]` PR, as `repo#number` links, newest first.
- A module a person marked Blocked stays Blocked until a new PR event (new PR, merge) for it.
- Notes are never overwritten. The task appends one dated line only when the status changes ("10:05 PR open: ESG-lite#140 by samidaire").
- Owners are GitHub logins mapped to names: shyamsharma23 → Shyam, samidaire → Sami, PavithraCJ → Pavithra. Claude PRs keep the login of whoever started the session.
- `updatedByName` = "Auto (GitHub)", `updatedAt` = now (ISO).
