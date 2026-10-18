// Adds "user".company_id: an Admin belongs to a company, not a site.
//
//   npm run migrate:user-company
//
// npm start runs it (scripts/migrate-all.cjs) before the API starts.
// 1. Adds the column and its foreign key (as TypeORM generates them for User.company).
// 2. Gives each Admin with no company_id the company of their site (or, failing that, of their
//    first user_sites site).
// 3. Takes the site off every Admin that now has a company: an Admin is no longer one of a site's
//    people (site listings, a site's deletion). Their user_sites rows, if any, are left alone.
// Idempotent: a re-run finds nothing to backfill or clear. Managers and Users are not touched.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

export const USER_COMPANY_SCHEMA = [
  `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "company_id" integer`,
];
const FK = "FK_9e70b5f9d7095018e86970c7874";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (m) => {
      for (const sql of USER_COMPANY_SCHEMA) await m.query(sql);
      const [fk] = await m.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [FK]);
      if (!fk) await m.query(`ALTER TABLE "user" ADD CONSTRAINT "${FK}" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      const [filled] = await m.query(`
        WITH made AS (
          UPDATE "user" u SET company_id = COALESCE(
                 (SELECT s.company_id FROM site s WHERE s.site_id = u.site_id),
                 (SELECT s.company_id FROM user_sites us JOIN site s ON s.site_id = us.site_id WHERE us.user_id = u.user_id ORDER BY us.site_id LIMIT 1))
           WHERE u.role = 'Admin' AND u.company_id IS NULL
          RETURNING u.company_id)
        SELECT COUNT(*) FILTER (WHERE company_id IS NOT NULL)::int AS n, COUNT(*) FILTER (WHERE company_id IS NULL)::int AS none FROM made`);
      const [cleared] = await m.query(`
        WITH done AS (UPDATE "user" SET site_id = NULL WHERE role = 'Admin' AND company_id IS NOT NULL AND site_id IS NOT NULL RETURNING user_id)
        SELECT COUNT(*)::int AS n FROM done`);
      console.log(`"user".company_id present; ${filled?.n ?? 0} Admin(s) given their site's company${filled?.none ? `, ${filled.none} with no site to take it from` : ""}; ${cleared?.n ?? 0} Admin site link(s) cleared.`);
    });
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
