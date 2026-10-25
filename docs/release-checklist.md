# Release checklist (backend)

Schema changes ship as idempotent migration scripts (`migrate:*` in
`package.json`); `TYPEORM_SYNC` stays off in production. `npm start` (the
Docker image's command) runs all of them through `scripts/migrate-all.cjs` and
then starts the API, so a release needs no manual migration step.

## Every release

1. Back up the production database (snapshot or `pg_dump`).
2. Build and deploy the new image from `production`.
3. On start the container runs every `migrate:*` script in the order
   `package.json` lists them and stops at the first failure; the API does not
   start until they all pass. Each script uses `IF NOT EXISTS`, so running it on
   a database that already has a change is a no-op. If the container fails to
   start, read its log: the failing migration is named; fix the cause and
   redeploy.
4. Check the API logs for errors.

To run the migrations separately (for example before switching traffic on a
platform with a release phase), use `npm run migrate:all` with the new image and
set `SKIP_MIGRATIONS=true` on the running service:

```bash
docker run --rm --env-file .env <new-image> npm run migrate:all
```

`npm run start:no-migrate` starts the API without the migration step.

## Environment

Required settings are listed in `.env.example`. A release that adds a setting
names it in its PR; set it before step 4.

## Adding a migration

Add the script under `src/scripts/`, make it idempotent (`IF NOT EXISTS`,
additive only), and add a `migrate:<name>` entry to `package.json` after the
existing ones. `migrate:all` picks it up from there.

## C06 supplier data requests
- Run `npm run migrate:supplier-requests` (part of `migrate:all`) before the build that ships `SupplierRequest`; it is idempotent and also adds the `note` column to an existing table.
- A draft footprint with a received, undecided supplier answer can't be deleted (409) until the answer is accepted or rejected; a decided request goes with its study.
- `SUPPLIER_REQUEST_MAIL` stays unset or `sink` until real supplier emails are approved; `live` sends through Brevo.
- `FRONTEND_URL` must be set: supplier links are `${FRONTEND_URL}/supplier/<token>`.

## #191 bigint ids (`migrate:bigint-ids`)
- Widens `emission.pk_id` and the columns that store it (`emission.fera_linked_id`, `emission_document.emission_id`, `pcf_result.emission_ids_used`, `audit_log.entity_id`, the legacy `invoice.emission_id` where it exists), plus `audit_log.id`, `notification.id`, `mcp_tool_call.id`, `import_plan_row.id`, `import_plan_match.id`, `report_ai_call.id` and `oauth_token.token_id`, and their sequences, from integer to bigint. Lossless; a second run changes nothing.
- Each table is rewritten under an ACCESS EXCLUSIVE lock: seconds to a minute for a table under about 1 GB. Check the sizes before deploying, and plan a longer window for anything much bigger:
  ```sql
  SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS size FROM pg_class
   WHERE relname IN ('emission', 'emission_document', 'pcf_result', 'audit_log', 'invoice', 'notification', 'mcp_tool_call',
                     'import_plan_row', 'import_plan_match', 'report_ai_call', 'oauth_token')
   ORDER BY pg_total_relation_size(oid) DESC;
  ```
- A view or rule built on one of these columns stops the widening of its group. The run logs `<group>: not widened (...)` and the API still starts on the integer columns (set `BIGINT_IDS_STRICT=true` to stop the start instead). This lists any (expect none):
  ```sql
  SELECT DISTINCT v.relname AS view, d.refobjid::regclass AS on_table FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class
   WHERE d.classid = 'pg_rewrite'::regclass AND v.oid <> d.refobjid
     AND d.refobjid::regclass::text IN ('emission', 'emission_document', 'pcf_result', 'audit_log', 'invoice', 'notification',
                                        'mcp_tool_call', 'import_plan_row', 'import_plan_match', 'report_ai_call', 'oauth_token');
  ```
- The legacy `final_emission` and `activity_data` tables have no DDL in any repo. If `\d final_emission` or `\d activity_data` shows a column holding emission ids, add it to the "emission ids" group in `src/scripts/migrateBigintIds.ts` first.
- Deploy order: the build running when the columns widen must already have #199 (the PCF staleness match cast to `bigint[]`). Older code runs `emission_ids_used && $1::int[]`, which fails on the widened column. The hook only logs it, so footprints stop going stale with no visible error. Redeploy with #198 and #199 first (no schema change), then merge this and redeploy again.
- Take the backup, then deploy in a low-traffic window. Each table lock waits at most 10 s, and a group tries 5 times. If the tables stay busy, or a rewrite runs past 120 s, the log says which group was not widened and the API starts anyway; the next start tries again.
- After the deploy every column above is `bigint` (`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE ...`) and its sequence too (`SELECT sequencename, data_type, max_value FROM pg_sequences`). The API log around the deploy has no `pcfDataChanged failed` line.
- Rollback: revert this PR's code only and keep the widened columns. `bigint` holds every old value, and the int8 parser (#198) keeps ids as numbers. Never roll back to a build older than #199 (see Deploy order).
- Monthly check, alert above 50%:
  ```sql
  SELECT sequencename, last_value, max_value, round(100.0 * last_value / max_value, 2) AS pct_used
    FROM pg_sequences WHERE last_value IS NOT NULL ORDER BY pct_used DESC LIMIT 10;
  ```
