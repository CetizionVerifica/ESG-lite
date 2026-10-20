// DS-14 · Design Studio golden cases (ci/golden/ds/CLAUDE.md).
//
//   npm run build && node ci/golden/ds/run.cjs          compare every "run" case (needs a ci_* throwaway DB)
//   UPDATE_SNAPSHOT=1 node ci/golden/ds/run.cjs          rewrite the expected files after an INTENDED change
//   DS_GOLDEN_ONLY=contracts,status node ci/golden/ds/run.cjs   only these groups
//   DS_GOLDEN_OFFLINE=1 node ci/golden/ds/run.cjs        only groups that need no database ("needs": "build")
//
// cases.json lists every golden the plan names; a case is either run (compared with
// ci/golden/ds/<id>.json) or skipped with the module it waits on. Groups that need the API
// get a throwaway stack (lib/stack.cjs): schema from dist/, the API fixture, every
// migrate:ds-* script, the compiled server on DS_GOLDEN_PORT (default 3993).
// Output ends with one line: "DS golden: N run, M matched, K skipped (waits on ...)".
// Exit 1 on any mismatch, missing expected file, or a "run" case without a group handler.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");
const SECRET = "ds-golden-only-not-a-real-secret";
const VOLATILE = new Set(["created_at", "updated_at", "generatedAt", "generated_at", "at"]);

const normalize = (v) => {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (!VOLATILE.has(k)) out[k] = normalize(v[k]);
    return out;
  }
  return v;
};

/** A matrix case → one case per combination; list names ("ELEMENT_TYPES") come from the compiled contracts. */
function expand(kase) {
  if (!kase.matrix) return [kase];
  let contracts = null;
  const values = (spec) => {
    if (Array.isArray(spec)) return spec;
    contracts = contracts || require(path.join(ROOT, "dist/studio/contracts/index.js"));
    if (!Array.isArray(contracts[spec])) throw new Error(`${kase.id}: contracts export no list ${spec}`);
    return [...contracts[spec]];
  };
  let combos = [{}];
  for (const [dim, spec] of Object.entries(kase.matrix)) combos = combos.flatMap((c) => values(spec).map((v) => ({ ...c, [dim]: v })));
  return combos.map((params) => ({ ...kase, matrix: undefined, params, id: `${kase.id}/${Object.values(params).join("-")}` }));
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
  const only = (process.env.DS_GOLDEN_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  const offline = process.env.DS_GOLDEN_OFFLINE === "1";
  const update = process.env.UPDATE_SNAPSHOT === "1";
  if (!fs.existsSync(path.join(ROOT, "dist/studio/contracts/index.js"))) {
    console.error("dist/ is missing: run `npm run build` first.");
    process.exit(1);
  }

  const cases = manifest.cases.flatMap(expand).filter((k) => !only.length || only.includes(k.group));
  for (const k of cases) if (!manifest.groups[k.group]) throw new Error(`${k.id}: unknown group ${k.group}`);
  let toRun = cases.filter((k) => k.run && !(offline && manifest.groups[k.group].needs !== "build"));
  const skipped = cases.filter((k) => !k.run);
  // DS-14F: groups marked "chromium" (PDF renders) skip, named, where Playwright's Chromium can't start.
  if (toRun.some((k) => manifest.groups[k.group].chromium)) {
    let why = null;
    try {
      const { chromium } = require(require.resolve("playwright", { paths: [ROOT] }));
      await (await chromium.launch()).close();
    } catch (err) {
      why = `Chromium (not installed: ${String(err && err.message).split("\n")[0].slice(0, 80)})`;
    }
    if (why) {
      for (const k of toRun.filter((x) => manifest.groups[x.group].chromium)) skipped.push({ ...k, waits: why });
      toRun = toRun.filter((x) => !manifest.groups[x.group].chromium);
    }
  }
  const failures = [];
  let matched = 0;
  let written = 0;

  const ctx = { root: ROOT };
  let stack = null;
  try {
    if (toRun.some((k) => manifest.groups[k.group].needs === "api")) {
      const { prepare, boot, q, caller } = require("./lib/stack.cjs");
      await prepare(ROOT);
      stack = await boot(ROOT, Number(process.env.DS_GOLDEN_PORT || 3993), SECRET);
      Object.assign(ctx, { q: (sql, params) => q(sql, params, ROOT), call: caller(ROOT, stack.base, SECRET) });
    }
    for (const k of toRun) {
      const handlerPath = path.join(__dirname, "groups", `${k.group}.cjs`);
      if (!fs.existsSync(handlerPath)) {
        failures.push(`${k.id}: "run" but there is no handler ci/golden/ds/groups/${k.group}.cjs`);
        continue;
      }
      let actual;
      try {
        actual = JSON.stringify(normalize(await require(handlerPath)(ctx, k)), null, 2) + "\n";
      } catch (err) {
        failures.push(`${k.id}: the handler threw: ${err && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : err}`);
        continue;
      }
      const file = path.join(__dirname, `${k.id}.json`);
      if (update) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, actual);
        written++;
        continue;
      }
      if (!fs.existsSync(file)) {
        failures.push(`${k.id}: no expected file ci/golden/ds/${k.id}.json (run with UPDATE_SNAPSHOT=1 and commit it)`);
        continue;
      }
      const expected = fs.readFileSync(file, "utf8");
      if (expected === actual) {
        matched++;
        continue;
      }
      const exp = expected.split("\n");
      const act = actual.split("\n");
      const diff = [];
      for (let i = 0; i < Math.max(exp.length, act.length) && diff.length < 12; i++) if (exp[i] !== act[i]) diff.push(`  line ${i + 1}\n    expected: ${exp[i]}\n    actual:   ${act[i]}`);
      fs.mkdirSync(path.join(ROOT, ".golden-actual/ds", path.dirname(k.id)), { recursive: true });
      fs.writeFileSync(path.join(ROOT, ".golden-actual/ds", `${k.id}.json`), actual);
      failures.push(`${k.id}: differs from ci/golden/ds/${k.id}.json (actual in .golden-actual/ds/)\n${diff.join("\n")}`);
    }
  } catch (err) {
    failures.push(`runner: ${err && err.message ? err.message : String(err)}`);
    if (stack) console.error("--- server log (tail) ---\n" + stack.logs.join("").slice(-4000));
  } finally {
    if (stack) stack.server.kill("SIGTERM");
  }

  const waits = {};
  for (const k of skipped) waits[k.waits || manifest.groups[k.group].module] = (waits[k.waits || manifest.groups[k.group].module] || 0) + 1;
  for (const f of failures) console.log(`FAIL ${f}`);
  if (update) console.log(`DS golden: ${written} expected files written.`);
  const waitText = Object.entries(waits).map(([m, n]) => `${n} on ${m}`).join(", ");
  console.log(`DS golden: ${toRun.length} run, ${matched} matched, ${failures.length} failed, ${skipped.length} skipped${waitText ? ` (waits ${waitText})` : ""}.`);
  if (failures.length) console.log("::error::A Design Studio golden changed. If the change is intended, run `UPDATE_SNAPSHOT=1 node ci/golden/ds/run.cjs` on a throwaway database and explain every moved value in the PR.");
  process.exit(failures.length ? 1 : 0);
})();
