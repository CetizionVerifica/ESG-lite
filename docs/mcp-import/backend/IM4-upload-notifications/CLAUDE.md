# IM4 · Upload-pending notifications (ESG-lite + small FE)

> Blueprint spec. Section appended to `ESG-lite/src/imports/CLAUDE.md` ("Notifications") when built.
> Depends on: IM0. Lane L6. Works for MCP commits and (with IM11 or a small AI-side call) the P27 page.

## Outcome
When a batch is committed, each manager of each affected site gets one notification: "Asha uploaded 312 entries for Plant 2 (Mar–Jun 2026). 41.2 tCO₂e waiting for review", linking to `/data/approvals?view=batches&batch=<id>`.

## Build
- `src/services/uploadNotify.ts`: listener on `onBatchCommitted`. Recipients = managers whose sites include any `site_ids` of the batch, plus company Admins if a site has no manager. Not the uploader. One notification per recipient per batch.
- Type `UPLOAD_PENDING`; `meta` `{ upload_batch_id, rows, tco2e, site_ids, months, channel }`. Add `UPLOAD_PENDING` to a new `NOTIFICATION_GROUPS.uploads` group (P13 filter).
- Email: through the existing email service and notification preferences; subject "Entries waiting for your review"; no row data in the email beyond counts.
- AI service path (until IM11): `POST /internal/imports/batch-committed` protected by the existing `X-Service-Key`, called by python_AI_service after its import commits. Optional; can wait for IM11.
- FE: `src/ui/notificationKind.ts` icon and label for `UPLOAD_PENDING`; the link opens the batch.

## Own tests
`ci/api/tests/im4-upload-notify.test.cjs`: managers of both sites get exactly one each; uploader gets none; another company's managers get none; listener failure doesn't fail the commit; preferences off → no email. FE unit test for the kind label.

## Audit rows
MCP-16.

## Acceptance
Committing a fixture plan creates the right notifications, and P13 shows them under the new filter.

## As built (2026-10-12)
See the "Notifications" section of `src/imports/CLAUDE.md`. Differences from the blueprint: the email preference is checked before queueing (so a test can see it without RabbitMQ) and again in the consumer; the internal hook is included (not deferred to IM11) and is off when `AI_SERVICE_KEY` is unset; the P13 filter group is `uploads`. The FE label, icon and "Uploads" tab ship in ESG-lite_FE (`[IM4 2/2]`).

Follow-up (review nits, 2026-10-12): partial unique index `notification_upload_batch_user_uq` on `((meta->>'upload_batch_id'), user_id) WHERE type = 'UPLOAD_PENDING'` via `migrate:upload-notification-index` (deploy: `npm run migrate:all`), so concurrent emits can't double-notify; the notifier swallows the loser's unique violation.
