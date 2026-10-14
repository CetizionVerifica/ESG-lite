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
- `SUPPLIER_REQUEST_MAIL` stays unset or `sink` until real supplier emails are approved; `live` sends through Mailgun.
- `FRONTEND_URL` must be set: supplier links are `${FRONTEND_URL}/supplier/<token>`.
