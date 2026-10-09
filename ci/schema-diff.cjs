// Compares this branch's entities against the database CI built from the base
// branch (plus this branch's migrate:* scripts) and lists the SQL TypeORM
// would need to run. Production never auto-syncs, so:
//   * any destructive statement (drop, rename, type change) means data loss
//     -> fails unless the PR carries the data-loss-reviewed label;
//   * any other pending statement means this branch changes an entity
//     without shipping a migrate:* script for it -> production would break
//     on deploy, so it fails too.
//
//   node ci/schema-diff.cjs
const path = require("path");
const fs = require("fs");
const { assertThrowawayDb } = require("./lib/throwaway-db.cjs");

assertThrowawayDb();
process.env.TYPEORM_SYNC = "false";
require("reflect-metadata");
const { AppDataSource } = require(path.resolve("dist/config/data-source.js"));

const DESTRUCTIVE = [
  /\bDROP\s+(TABLE|COLUMN|SCHEMA|VIEW)\b/i,
  /\bALTER\s+TABLE\b.*\bDROP\s+COLUMN\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\b.*\bTYPE\b/i,
  /\bTRUNCATE\b/i,
];
// Postgres can't change these in place, so TypeORM drops and re-adds the
// column: the existing values are lost.
const isDestructive = (sql) => DESTRUCTIVE.some((re) => re.test(sql));

(async () => {
  await AppDataSource.initialize();
  const log = await AppDataSource.driver.createSchemaBuilder().log();
  await AppDataSource.destroy();

  const queries = log.upQueries.map((q) => q.query.replace(/\s+/g, " ").trim());
  const destructive = queries.filter(isDestructive);
  const additive = queries.filter((q) => !isDestructive(q));
  const labelOk = process.env.DATA_LOSS_REVIEWED === "true";

  const lines = ["### Entity schema check", ""];
  if (queries.length === 0) {
    lines.push("Entities match the base schema plus this branch's migrate scripts. Nothing to migrate.");
  }
  if (destructive.length) {
    lines.push(`**${destructive.length} destructive change(s)** (existing data would be lost):`, "```sql", ...destructive, "```");
  }
  if (additive.length) {
    lines.push(
      `**${additive.length} schema change(s) with no migrate script.** Production does not auto-sync,`,
      "so add an idempotent `migrate:*` script in package.json that applies them:",
      "```sql", ...additive, "```",
    );
  }
  const summary = lines.join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");

  let failed = false;
  if (destructive.length && !labelOk) {
    console.log("::error::Entity change drops, renames or retypes existing columns. Needs a data-preserving migration and the data-loss-reviewed label.");
    failed = true;
  }
  if (additive.length) {
    console.log("::error::Entity change has no migrate:* script; production would fail on deploy.");
    failed = true;
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
