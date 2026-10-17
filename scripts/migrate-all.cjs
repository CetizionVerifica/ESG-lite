#!/usr/bin/env node
// Runs every "migrate:*" script in package.json, in the order they are listed,
// and stops at the first failure. Each migration is idempotent (IF NOT EXISTS),
// so this is safe to run on every start; see docs/release-checklist.md.
//
//   npm run migrate:all        run by hand
//   npm start                  runs this first, then starts the API
//
// When the project is built (dist/ exists) each "ts-node src/scripts/X.ts"
// script runs as "node dist/scripts/X.js", so a deploy needs no ts-node.
// Set SKIP_MIGRATIONS=true to start without migrating (for example when a
// separate release step already ran them).
//
// A new migration only needs its "migrate:<name>" entry in package.json.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { scripts } = require("../package.json");

const ROOT = path.join(__dirname, "..");

if (/^(1|true|yes)$/i.test(process.env.SKIP_MIGRATIONS || "")) {
  console.log("SKIP_MIGRATIONS is set; migrations not run.");
  process.exit(0);
}

const names = Object.keys(scripts).filter((name) => name.startsWith("migrate:") && name !== "migrate:all");

// "ts-node src/scripts/foo.ts" -> "dist/scripts/foo.js" when that file was built.
function compiledPath(command) {
  const match = /^ts-node\s+src\/(\S+)\.ts\s*$/.exec(command.trim());
  if (!match) return null;
  const compiled = path.join(ROOT, "dist", `${match[1]}.js`);
  return fs.existsSync(compiled) ? compiled : null;
}

for (const name of names) {
  console.log(`\n> ${name}`);
  const compiled = compiledPath(scripts[name]);
  const run = compiled
    ? spawnSync(process.execPath, [compiled], { stdio: "inherit", cwd: ROOT })
    : spawnSync("npm", ["run", "--silent", name], { stdio: "inherit", cwd: ROOT, shell: process.platform === "win32" });
  if (run.status !== 0) {
    console.error(`${name} failed (exit ${run.status ?? run.signal}); later migrations were not run.`);
    process.exit(run.status || 1);
  }
}
console.log(`\nAll ${names.length} migrations ran.`);
