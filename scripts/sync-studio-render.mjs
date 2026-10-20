#!/usr/bin/env node
/* eslint-env node */
// DS-1 · the renderer mirror. The same file lives in ESG-lite and ESG-lite_FE.
//
// ESG-lite (src/reporting/studio/render/ is the source):
//   npm run sync:studio-render    hash render/**.ts into render/hash.ts (RENDER_HASH) and, when the FE
//                                 checkout is found, copy the files to ESG-lite_FE/src/lib/studio/render/
//   npm run check:studio-render   fail when render/ changed without a sync (hash.ts is stale)
// ESG-lite_FE (src/lib/studio/render/ is a generated copy; never edit it):
//   npm run sync:studio-render    copy render/ from the ESG-lite checkout, then check
//   npm run check:studio-render   fail when the copy doesn't hash to its RENDER_HASH (hand-edited)
//
// Checkouts: --fe=<dir> / STUDIO_FE_DIR (default ../ESG-lite_FE), --be=<dir> / STUDIO_BE_DIR
// (default ../ESG-lite). The hash covers every .ts file under render/ except hash.ts, by
// relative path and content, so both repos compute the same value for the same files.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BE_RENDER = "src/reporting/studio/render";
const FE_RENDER = "src/lib/studio/render";
const ROOT = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith("--") ? a.slice(2).split("=") : [a, true])));
const command = process.argv[2] === "check" || args.check ? "check" : "sync";
const isBE = existsSync(path.join(ROOT, BE_RENDER));

function files(dir, rel = "") {
  const out = [];
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) out.push(...files(dir, r));
    else if (name.endsWith(".ts") && r !== "hash.ts") out.push(r);
  }
  return out;
}

export function hashDir(dir) {
  const h = createHash("sha256");
  for (const r of files(dir)) h.update(`${r}\n`).update(readFileSync(path.join(dir, r))).update("\n");
  return h.digest("hex");
}

const hashFile = (value) => `/**
 * RENDER_HASH: sha256 of every file under render/ except this one, written by
 * \`npm run sync:studio-render\` (scripts/sync-studio-render.mjs). The FE mirror
 * carries the same value; \`npm run check:studio-render\` fails when they differ.
 */
export const RENDER_HASH = "${value}";
`;

const readHash = (dir) => {
  const p = path.join(dir, "hash.ts");
  if (!existsSync(p)) return null;
  return /RENDER_HASH = "([^"]*)"/.exec(readFileSync(p, "utf8"))?.[1] ?? null;
};

function mirror(from, to) {
  mkdirSync(to, { recursive: true });
  const want = new Set([...files(from), "hash.ts"]);
  for (const r of existsSync(to) ? files(to) : []) if (!want.has(r)) rmSync(path.join(to, r));
  for (const r of want) {
    mkdirSync(path.dirname(path.join(to, r)), { recursive: true });
    writeFileSync(path.join(to, r), readFileSync(path.join(from, r)));
  }
  writeFileSync(
    path.join(to, "GENERATED.md"),
    "# Generated: do not edit\n\nThis folder is a byte-for-byte copy of ESG-lite `src/reporting/studio/render/` (DS-1).\nChange the renderer there, run `npm run sync:studio-render` in ESG-lite, then here.\n`npm run check:studio-render` fails when a file here differs from its RENDER_HASH.\n",
  );
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const dirArg = (name, env, dflt) => path.resolve(ROOT, String(args[name] ?? process.env[env] ?? dflt));

if (isBE) {
  const src = path.join(ROOT, BE_RENDER);
  const h = hashDir(src);
  if (command === "check") {
    const stored = readHash(src);
    if (stored !== h) fail(`render/ hashes to ${h} but hash.ts says ${stored}. Run npm run sync:studio-render.`);
    console.log(`✓ RENDER_HASH ${h}`);
  } else {
    writeFileSync(path.join(src, "hash.ts"), hashFile(h));
    console.log(`RENDER_HASH ${h}`);
    const fe = dirArg("fe", "STUDIO_FE_DIR", "../ESG-lite_FE");
    if (existsSync(path.join(fe, "src/lib/studio"))) {
      mirror(src, path.join(fe, FE_RENDER));
      // The renderer goldens travel with it: the FE test must reproduce them byte for byte.
      const gold = path.join(fe, "src/test/fixtures/studio-render");
      mkdirSync(gold, { recursive: true });
      for (const f of ["snapshots.json", "fixture-a4.json"]) {
        const from = path.join(ROOT, "ci/golden/ds/render", f);
        if (existsSync(from)) writeFileSync(path.join(gold, f), readFileSync(from));
      }
      console.log(`copied to ${path.join(fe, FE_RENDER)} (+ goldens)`);
    } else {
      console.log(`FE checkout not found at ${fe}: run npm run sync:studio-render in ESG-lite_FE (or pass --fe=<dir>).`);
    }
  }
} else {
  const dst = path.join(ROOT, FE_RENDER);
  if (command === "sync") {
    const be = dirArg("be", "STUDIO_BE_DIR", "../ESG-lite");
    const src = path.join(be, BE_RENDER);
    if (!existsSync(src)) fail(`ESG-lite renderer not found at ${src} (pass --be=<dir>).`);
    if (readHash(src) !== hashDir(src)) fail(`ESG-lite render/ isn't synced: run npm run sync:studio-render there first.`);
    mirror(src, dst);
    console.log(`copied from ${src}`);
  }
  if (!existsSync(dst)) fail(`${FE_RENDER} is missing: run npm run sync:studio-render.`);
  const h = hashDir(dst);
  const stored = readHash(dst);
  if (stored !== h) fail(`${FE_RENDER} hashes to ${h} but its hash.ts says ${stored}: the mirror was edited by hand. Re-sync from ESG-lite.`);
  console.log(`✓ RENDER_HASH ${h}`);
}
