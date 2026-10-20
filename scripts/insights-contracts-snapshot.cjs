#!/usr/bin/env node
// IN-0: writes (or with --check, compares) ci/insights-contracts.json, the list
// of Insights contract names the FE mirror (ESG-lite_FE
// src/lib/insights/contracts.ts) must carry. Reads the compiled contracts:
//
//   npm run build && npm run insights:contracts          # rewrite the file
//   npm run build && node scripts/insights-contracts-snapshot.cjs --check
//   node scripts/insights-contracts-snapshot.cjs --diff ../ESG-lite_FE/src/lib/insights/contracts.snapshot.json
//
// --diff compares with the FE copy and prints every name only one side has.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "ci/insights-contracts.json");
const { contractsSnapshot } = require(path.join(ROOT, "dist/insights/contracts/snapshot.js"));
const text = JSON.stringify(contractsSnapshot(), null, 2) + "\n";

/** Every leaf as "path = value", so two snapshots diff line by line. */
function flatten(value, prefix = "", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => (typeof v === "object" && v ? flatten(v, `${prefix}[${i}]`, out) : out.push(`${prefix} = ${JSON.stringify(v)}`)));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  else out.push(`${prefix} = ${JSON.stringify(value)}`);
  return out;
}

const mode = process.argv[2];
if (mode === "--check") {
  const current = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "";
  if (current !== text) {
    console.error("ci/insights-contracts.json is out of date: run `npm run build && npm run insights:contracts` and update the FE copy.");
    process.exit(1);
  }
  console.log("ci/insights-contracts.json matches the contracts.");
} else if (mode === "--diff") {
  const other = process.argv[3];
  if (!other) throw new Error("usage: --diff <path to the FE contracts.snapshot.json>");
  const a = new Set(flatten(JSON.parse(text)));
  const b = new Set(flatten(JSON.parse(fs.readFileSync(other, "utf8"))));
  const onlyBe = [...a].filter((x) => !b.has(x));
  const onlyFe = [...b].filter((x) => !a.has(x));
  for (const x of onlyBe) console.log(`- backend only: ${x}`);
  for (const x of onlyFe) console.log(`+ FE only:      ${x}`);
  if (onlyBe.length || onlyFe.length) process.exit(1);
  console.log("FE snapshot matches the backend contracts.");
} else {
  fs.writeFileSync(FILE, text);
  console.log(`Wrote ${path.relative(ROOT, FILE)}`);
}
