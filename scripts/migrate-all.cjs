#!/usr/bin/env node
// Runs every "migrate:*" script in package.json, in the order they are listed,
// and stops at the first failure. Each migration is idempotent (IF NOT EXISTS),
// so this is safe to run on every release; see docs/release-checklist.md.
//
//   npm run migrate:all
//
// A new migration only needs its "migrate:<name>" entry in package.json.
const { spawnSync } = require("child_process");
const { scripts } = require("../package.json");

const names = Object.keys(scripts).filter((name) => name.startsWith("migrate:") && name !== "migrate:all");

for (const name of names) {
  console.log(`\n> ${name}`);
  const run = spawnSync("npm", ["run", "--silent", name], { stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) {
    console.error(`${name} failed (exit ${run.status ?? run.signal}); later migrations were not run.`);
    process.exit(run.status || 1);
  }
}
console.log(`\nAll ${names.length} migrations ran.`);
