// Builds the schema described by the compiled entities (dist/) on the
// throwaway CI database. Run with the BASE branch's dist to recreate the
// schema production is expected to have before this branch ships.
//
//   node ci/schema-sync.cjs <path-to-dist>
const path = require("path");
const { assertThrowawayDb } = require("./lib/throwaway-db.cjs");

assertThrowawayDb();
process.env.TYPEORM_SYNC = "true";
const dist = path.resolve(process.argv[2] || "dist");
require(path.join(dist, "../node_modules/reflect-metadata"));
const { AppDataSource } = require(path.join(dist, "config/data-source.js"));

AppDataSource.initialize()
  .then(async () => {
    console.log(`Schema built from ${dist}`);
    await AppDataSource.destroy();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
