// DS-14 draft: the verification scaffolding itself.
//  - ci/golden/ds/lib/routes.cjs (used by the DS probes and the workflow's DS steps) and
//    ci/api/tests/ds-lib.cjs (DS-0's API tests) list the same 01-contracts §4 endpoints;
//  - the compiled router's routes are all in the contract list;
//  - cases.json is well formed: every case has a known group, a run case has a handler,
//    a skipped case names the module it waits on, ids are unique;
//  - the offline DS goldens (groups that need no database) match: `DS_GOLDEN_OFFLINE=1`.
// Runs against the build: npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const R = require(path.join(ROOT, "ci/golden/ds/lib/routes.cjs"));
const { STUDIO_CONTRACT_ROUTES } = require(path.join(ROOT, "ci/api/tests/ds-lib.cjs"));

const strip = (url) => url.replace(/\?.*$/, "");

test("routes.cjs and ds-lib.cjs list the same contract endpoints", () => {
  const mine = R.CONTRACT_ROUTES.filter((r) => r.path !== "/status").map((r) => `${r.method} ${strip(R.concrete(r.path))}`).sort();
  // ds-lib.cjs names the font route by a concrete file; routes.cjs by its pattern.
  const theirs = STUDIO_CONTRACT_ROUTES.map((r) => `${r.method} /studio${strip(r.path).replace(/^\/fonts\/.+$/, "/fonts/1")}`).sort();
  assert.deepEqual(mine, theirs);
});

test("every contract route names its module; concrete() fills ids and the query a route needs", () => {
  for (const r of R.CONTRACT_ROUTES) assert.match(r.module, /^DS-\d+$/, `${r.method} ${r.path}`);
  assert.equal(R.concrete("/docs/:id/versions/:n/pdf"), "/studio/docs/1/versions/1/pdf");
  assert.equal(R.concrete("/docs/:id", { id: 42 }), "/studio/docs/42");
  assert.equal(R.concrete("/readiness"), "/studio/readiness?kind=ghg&year=2025");
  assert.equal(R.shape({ method: "GET", path: "/docs/:docId" }), R.shape({ method: "GET", path: "/docs/:id" }));
});

test("the compiled /studio router has no route outside the contract list", () => {
  const contract = new Set(R.CONTRACT_ROUTES.map(R.shape));
  const extra = R.builtRoutes(ROOT).filter((r) => !contract.has(R.shape(r))).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(extra, [], "add these to ci/golden/ds/lib/routes.cjs CONTRACT_ROUTES (and ds-lib.cjs)");
  const gated = R.gatedRoutes(ROOT);
  assert.ok(!gated.some((r) => r.method === "GET" && r.path === "/status"));
  assert.equal(gated.length, R.CONTRACT_ROUTES.length - 1, "built routes fold into their contract rows");
});

test("cases.json: known groups, unique ids, a handler for every run case, a module for every skipped one", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "ci/golden/ds/cases.json"), "utf8"));
  const ids = new Set();
  for (const k of m.cases) {
    assert.ok(m.groups[k.group], `${k.id}: group ${k.group}`);
    assert.ok(k.id.startsWith(`${k.group}/`), `${k.id} lives in its group folder`);
    assert.ok(!ids.has(k.id), `duplicate ${k.id}`);
    ids.add(k.id);
    if (k.run) assert.ok(fs.existsSync(path.join(ROOT, `ci/golden/ds/groups/${k.group}.cjs`)), `${k.id}: no handler`);
    else assert.match(k.waits || "", /DS-\d+/, `${k.id}: a skipped case names the module it waits on`);
  }
  for (const [name, g] of Object.entries(m.groups)) assert.ok(["build", "api"].includes(g.needs), `${name}.needs`);
  // The groups the DS-14 spec names are all there.
  for (const g of ["seed", "render", "parity", "checks", "pdf", "ai"]) assert.ok(m.groups[g], g);
});

test("the offline DS goldens match (contracts group)", () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "ci/golden/ds/run.cjs")], { cwd: ROOT, env: { ...process.env, DS_GOLDEN_OFFLINE: "1", UPDATE_SNAPSHOT: "" }, encoding: "utf8" });
  const last = r.stdout.trim().split("\n").pop();
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`.slice(-3000));
  assert.match(last, /^DS golden: (\d+) run, \1 matched, 0 failed, \d+ skipped/);
  assert.ok(Number(/(\d+) run/.exec(last)[1]) >= 3, last);
});
