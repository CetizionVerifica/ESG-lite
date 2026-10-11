# Release checklist (backend)

Nothing in the Docker image or `npm start` changes the database schema, and
`TYPEORM_SYNC` stays off in production. Schema changes ship as idempotent
migration scripts (`migrate:*` in `package.json`), so every release runs them
explicitly.

## Every release

1. Back up the production database (snapshot or `pg_dump`).
2. Build the new image.
3. Run the migrations against the production database with the new image,
   before the new version takes traffic:

   ```bash
   docker run --rm --env-file .env <new-image> npm run migrate:all
   ```

   `migrate:all` runs every `migrate:*` script in the order `package.json`
   lists them and stops at the first failure. Each script uses
   `IF NOT EXISTS`, so running it on a database that already has a change is a
   no-op. If it fails, do not switch traffic; fix the cause and run it again.
4. Start the new version and check the API logs for errors.

## Environment

Required settings are listed in `.env.example`. A release that adds a setting
names it in its PR; set it before step 4.

## Adding a migration

Add the script under `src/scripts/`, make it idempotent (`IF NOT EXISTS`,
additive only), and add a `migrate:<name>` entry to `package.json` after the
existing ones. `migrate:all` picks it up from there.
