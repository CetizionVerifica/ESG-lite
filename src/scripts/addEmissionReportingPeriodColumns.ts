// Adds emission.reporting_period and emission.year_type (yearly CY/FY
// reporting, commit 02e5c58). The entity has mapped both since then, but no
// migration created them, so a database restored from an older dump fails on
// every emission query ("column reporting_period does not exist").
//
//   npm run migrate:emission-reporting-period
//
// Existing rows become 'monthly' with no year type, which is what they were
// before yearly periods existed. Matches the entity: varchar(10) NOT NULL
// DEFAULT 'monthly', and varchar(2) NULL.
//
// Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(
      `ALTER TABLE emission ADD COLUMN IF NOT EXISTS reporting_period character varying(10) NOT NULL DEFAULT 'monthly'`,
    );
    await AppDataSource.query(`ALTER TABLE emission ADD COLUMN IF NOT EXISTS year_type character varying(2) NULL`);
    console.log("emission.reporting_period and emission.year_type present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
