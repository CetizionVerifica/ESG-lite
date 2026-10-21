// IN-10 · the Insights golden cases (ci/golden/in/cases.json) on the fixture
// company ci/fixtures/in-company (companies 901, 902). Each `run` suite has a
// group below; a `skip` suite is reported as skipped with the module it waits
// on. A module that builds a golden switches its suite to `run` and adds its
// group here. Expected figures are worked by hand (the fixture's table), never
// read back from the engine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { withDb } = require("../helpers.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const CASES = require(path.join(ROOT, "ci/golden/in/cases.json"));
// seed.sql, then each module's own seed-<module>.sql (IN-2, IN-4, …) in name order; cleanup the
// same way, modules first. Each module keeps its fixture rows in its own file so parallel lanes
// never edit the same SQL.
const FIXTURE_DIR = path.join(ROOT, "ci/fixtures/in-company");
const sqlFiles = (prefix) => fs.readdirSync(FIXTURE_DIR).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".sql")).sort();
const read = (f) => fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8");
const SEED = [read("seed.sql"), ...sqlFiles("seed").map(read)].join("\n");
const CLEANUP = [...sqlFiles("cleanup").map(read), read("cleanup.sql")].join("\n");

/** Fixture people (ci/fixtures/in-company/seed.sql). */
const PEOPLE = {
  admin: { userId: 901, role: "Admin" },
  manager: { userId: 902, role: "Manager" }, // sites 901, 902
  user: { userId: 903, role: "User" },
  otherManager: { userId: 904, role: "Manager" }, // company 902
  superadmin: { userId: 5, role: "Superadmin" },
};

async function get(who, url, headers = {}) {
  const sep = url.includes("?") ? "&" : "?";
  const full = who === "superadmin" && !url.includes("company_id=") ? `${url}${sep}company_id=901` : url;
  const res = await fetch(`${process.env.API_BASE}${full}`, { headers: { Authorization: `Bearer ${jwt.sign(PEOPLE[who], process.env.JWT_SECRET)}`, ...headers } });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, json: type.includes("application/json") ? await res.json() : null };
}
async function post(who, url, body) {
  const res = await fetch(`${process.env.API_BASE}${url}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt.sign(PEOPLE[who], process.env.JWT_SECRET)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** Deep compare: numbers within 1e-9 relative, everything else equal; only keys in `expected` are checked. */
function matches(actual, expected, where) {
  if (expected === null || typeof expected !== "object") {
    if (typeof expected === "number" && typeof actual === "number") {
      assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${where}: ${actual} vs ${expected}`);
    } else assert.deepEqual(actual, expected, where);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: not an array`);
    assert.equal(actual.length, expected.length, `${where}: length`);
    expected.forEach((e, i) => matches(actual[i], e, `${where}[${i}]`));
    return;
  }
  assert.ok(actual && typeof actual === "object", `${where}: missing`);
  for (const [k, v] of Object.entries(expected)) matches(actual[k], v, `${where}.${k}`);
}

const load = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

/** Group handlers by suite id. */
const GROUPS = {
  async summary(suite) {
    for (const c of load(suite.file).cases) {
      const r = await get(c.who, `/insights/summary?${c.query}`);
      assert.equal(r.status, 200, `${c.name}: ${JSON.stringify(r.json)}`);
      const { pending_not_in, ...data } = c.expected;
      matches(r.json.data, data, c.name);
      if (pending_not_in) matches(r.json.pending_not_in, pending_not_in, `${c.name} pending_not_in`);
    }
  },
  async parity() {
    // /insights/summary = /manager/overview for the Manager's sites, CY and FY, all and one.
    for (const [qs, period, sites] of [["year=2025", "2025", ""], ["year=2024&sites=901", "2024", "901"], ["year=2026&yearType=FY", "FY2025-26", ""]]) {
      const ov = (await get("manager", `/manager/overview?period=${period}${sites ? `&siteIds=${sites}` : ""}`)).json;
      const s = (await get("manager", `/insights/summary?${qs}`)).json;
      assert.equal(s.data.net.value, ov.kpis.net, `${qs} net`);
      assert.equal(s.data.net.change_pct, ov.kpis.net_vs_last_year_pct, `${qs} change`);
      assert.equal(s.pending_not_in.emissions, ov.kpis.pending_review_count, `${qs} pending`);
    }
    // The pathway behind the summary = POST /user/targets/tables for the same base year and rate.
    const t = (await post("manager", "/user/targets/tables", { siteIds: [901, 902], baseYear: 2021, targetYear: 2030, annualRate: 0.042 })).json;
    const row = t.tables.table3.find((r) => r.year === 2025);
    const s = (await get("manager", "/insights/summary?year=2025")).json;
    matches(s.data.pathway.gap_pct, ((row.actualTotal - row.targetTotal) / row.targetTotal) * 100, "pathway gap");
    // IN-4: /insights/pathway = /user/targets/tables (pathway and actual per year) for the same base year and rate.
    const p = (await get("manager", "/insights/pathway?year=2025")).json.data;
    t.tables.table1.forEach((r, i) => {
      assert.equal(p.years[i], r.year);
      assert.equal(p.pathway[i], r.targetEmission, `pathway ${r.year}`);
    });
    for (const r of t.tables.table3.filter((x) => x.status !== "No Data")) {
      const i = p.years.indexOf(r.year);
      assert.equal(p.actual.s1[i], r.actualScope1, `s1 ${r.year}`);
      assert.equal(p.actual.s2[i], r.actualScope2, `s2 ${r.year}`);
    }
    // Later parts (IN-2 ring) append their checks here.
  },
  // IN-4
  async pathway(suite) {
    for (const c of load(suite.file).cases) {
      const r = await get(c.who, `/insights/pathway?${c.query}`);
      assert.equal(r.status, 200, `${c.name}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.availability, "ok", c.name);
      matches(r.json.data, c.expected, c.name);
    }
  },
  // IN-4
  async completeness(suite) {
    for (const c of load(suite.file).cases) {
      const r = await get(c.who, `/insights/completeness?${c.query}`);
      assert.equal(r.status, 200, `${c.name}: ${JSON.stringify(r.json)}`);
      matches(r.json.data, c.expected, c.name);
    }
  },
};

test.before(async () => {
  await withDb((db) => db.query(CLEANUP));
  await withDb((db) => db.query(SEED));
});
test.after(async () => {
  await withDb((db) => db.query(CLEANUP));
});

test("the golden index: every suite has an owner, a file or a waits_on, and a group when it runs", () => {
  assert.ok(CASES.suites.length >= 10);
  for (const s of CASES.suites) {
    assert.ok(["run", "skip"].includes(s.status), s.id);
    if (s.status === "run") {
      assert.ok(fs.existsSync(path.join(ROOT, s.file)), `${s.id}: ${s.file}`);
      assert.ok(GROUPS[s.id], `${s.id} runs but has no group in in-10-golden.test.cjs`);
    } else assert.ok(s.waits_on, `${s.id} is skipped without waits_on`);
  }
});

for (const suite of CASES.suites) {
  if (suite.status === "run") test(`golden ${suite.id} (${suite.owner}): ${suite.what}`, () => GROUPS[suite.id](suite));
  else test(`golden ${suite.id} (${suite.owner})`, { skip: `waits on ${suite.waits_on}` }, () => {});
}

test("the fixture's tenant: company 902's Manager reads only its own 777 t", async () => {
  const r = await get("otherManager", "/insights/summary?year=2025");
  assert.equal(r.status, 200);
  assert.equal(r.json.data.net.value, 777);
  assert.equal((await get("otherManager", "/insights/summary?year=2025&sites=901")).status, 404);
  assert.equal((await get("user", "/insights/summary?year=2025")).json.code, "IN_FORBIDDEN");
});
