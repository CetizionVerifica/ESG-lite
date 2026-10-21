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
const { ensureKpiLibrary, kpiIds, kpiValue } = require("./in-lib.cjs"); // IN-2, IN-6
const { setupCompany } = require("./kpi-lib.cjs"); // IN-2

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
  // IN-2: decoupling (hand series), the target wall without KPI (SBTi items; expected_pct and status
  // from the I6 line at today), the ESG ring with KPI tracking on for company 901 (then off again).
  async story(suite) {
    const g = load(suite.file);
    for (const c of g.decoupling) {
      const r = await get(c.who, `/insights${c.path}`);
      assert.equal(r.status, 200, `${c.name}: ${JSON.stringify(r.json)}`);
      matches(r.json, c.expected, c.name);
    }
    const w = (await get(g.wall.who, `/insights${g.wall.path}`)).json;
    matches(w.data, g.wall.expected, g.wall.name);
    const yearEnd = (y) => Date.UTC(y, 11, 31, 23, 59, 59);
    const now = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    for (const it of w.data.items) {
      const exp = Math.min(100, Math.max(0, ((now - yearEnd(it.baseline.year)) / (yearEnd(it.target.year) - yearEnd(it.baseline.year))) * 100));
      matches(it.expected_pct, exp, `${it.id} expected`);
      const status = it.progress_pct >= 100 ? "reached" : it.progress_pct >= exp ? "on_track" : exp - it.progress_pct <= 10 ? "at_risk" : "off_track";
      assert.equal(it.status, status, `${it.id} status`);
    }
    // ESG ring (KPI on for the case only).
    ensureKpiLibrary();
    const ring = g.ring;
    await withDb((db) => db.query(`UPDATE company SET kpi_tracking_enabled = true WHERE company_id = 901`));
    try {
      await setupCompany(901, { frameworks: ["GRI"], kpis: ring.kpis, frequencies: Object.fromEntries(ring.kpis.map((k) => [k, "annual"])), topicOwners: false });
      const ids = await kpiIds(ring.kpis);
      for (const [code, site, v, status, source] of ring.values) await kpiValue(901, ids[code], site, 2025, v, status, source);
      const r = (await get("admin", "/insights/esg-ring?year=2025")).json;
      assert.equal(r.availability, "ok", JSON.stringify(r));
      matches(r.data.pct, ring.expected.pct, "ring pct");
      for (const [pillar, ep] of Object.entries(ring.expected.pillars)) {
        const p = r.data.pillars.find((x) => x.pillar === pillar);
        const { topics, ...rest } = ep;
        matches(p, rest, `ring ${pillar}`);
        for (const [topic, et] of Object.entries(topics ?? {})) matches(p.topics.find((t) => t.topic === topic), et, `ring ${topic}`);
      }
      // parity: each topic's coverage rounds to /kpi/esg's.
      const e = (await get("admin", "/kpi/esg?year=2025")).json;
      for (const p of e.pillars) for (const t of p.topics) {
        const rt = r.data.pillars.find((x) => x.pillar === p.pillar).topics.find((x) => x.topic === t.topic);
        assert.equal(Math.round(rt.coverage_pct), t.coverage_pct ?? 0, `parity ${t.topic}`);
        assert.equal(rt.kpis, t.kpis);
        assert.equal(rt.approved, t.approved);
      }
    } finally {
      await withDb((db) => db.query(read("cleanup-in2.sql")));
      await withDb((db) => db.query(`UPDATE company SET kpi_tracking_enabled = false WHERE company_id = 901`));
    }
  },
  // IN-5 · bridge: hand-worked LMDI steps on the fixture; Σ steps = to − from exactly; no_data.
  async bridge(suite) {
    const g = load(suite.file);
    for (const c of g.cases) {
      const r = await get(c.who, `/insights/bridge?${c.query}`);
      assert.equal(r.status, 200, `${c.name}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.availability, "ok", c.name);
      const d = r.json.data;
      matches(d.from, c.expected.from, `${c.name} from`);
      matches(d.to, c.expected.to, `${c.name} to`);
      assert.deepEqual(d.steps.map((s) => s.driver), c.expected.steps.map((s) => s.driver), `${c.name} drivers`);
      c.expected.steps.forEach((e, i) => assert.ok(Math.abs(d.steps[i].value - e.value) <= 1e-6, `${c.name} ${e.driver}: ${d.steps[i].value} vs ${e.value}`));
      const sum = d.steps.reduce((a, s) => a + s.value, 0);
      assert.ok(Math.abs(sum - (d.to.value - d.from.value)) <= 1e-9, `${c.name}: Σ steps ${sum}`);
      assert.ok(Math.abs(sum - c.sum) <= 1e-9, `${c.name}: Σ by hand`);
      for (const n of c.notes_include ?? []) assert.ok(d.notes.some((x) => x.includes(n)), `${c.name}: a note mentions ${n}: ${JSON.stringify(d.notes)}`);
      for (const n of c.notes_exclude ?? []) assert.ok(!d.notes.some((x) => x.includes(n)), `${c.name}: no note mentions ${n}`);
      for (const [driver, label] of Object.entries(c.labels ?? {})) assert.equal(d.steps.find((s) => s.driver === driver).label, label, `${c.name} ${driver} label`);
    }
    for (const c of g.no_data) {
      const r = await get(c.who, `/insights/bridge?${c.query}`);
      assert.equal(r.json.availability, "no_data", c.name);
      assert.equal(r.json.data, null);
    }
  },
  // IN-6 · flow: tonnes conserved 0→1 and 1→2, disclosure counts = mapped rows of the enabled frameworks.
  async flow(suite) {
    const g = load(suite.file);
    const check = (flow, c, name) => {
      const key = (l) => `${l.source}→${l.target}`;
      const got = new Map(flow.links.map((l) => [key(l), l]));
      for (const [source, target, value, measure, fit] of c.links) {
        const l = got.get(`${source}→${target}`);
        assert.ok(l, `${name}: link ${source}→${target}`);
        matches(l.value, value, `${name} ${source}→${target}`);
        assert.equal(l.measure, measure, `${name} ${source}→${target} measure`);
        if (fit) assert.equal(l.fit, fit);
      }
      assert.equal(flow.links.length, c.links.length, `${name}: link count`);
      for (const [col, n] of Object.entries(c.columns)) assert.equal(flow.nodes.filter((x) => x.column === Number(col)).length, n, `${name}: column ${col}`);
      for (const id of c.absent ?? []) assert.ok(!flow.nodes.some((x) => x.id === id), `${name}: ${id} absent`);
      // Conservation: into each scope = out of it in tCO2e (where column 2 takes it).
      const sum = (pred) => flow.links.filter(pred).reduce((a, l) => a + l.value, 0);
      for (const n of [1, 2]) matches(sum((l) => l.target === `scope:${n}`), sum((l) => l.source === `scope:${n}` && l.measure === "tCO2e"), `${name}: scope ${n} conserved`);
    };
    const off = await get("admin", `/insights/flow?${g.kpi_off.query}`);
    assert.equal(off.status, 200, JSON.stringify(off.json));
    check(off.json.data, g.kpi_off, "kpi off");
    ensureKpiLibrary();
    const c = g.kpi_on;
    try {
      await withDb(async (db) => {
        await db.query(`UPDATE company SET kpi_tracking_enabled = true WHERE company_id = 901`);
        await db.query(`INSERT INTO company_kpi_settings (company_id, year_type, first_year, due_day, setup_completed_at) VALUES (901, 'CY', 2021, 15, now())`);
        await db.query(`INSERT INTO company_framework (company_id, framework_id, framework_code) SELECT 901, id, code FROM kpi_framework WHERE active AND code = ANY($1::text[])`, [c.frameworks]);
        await db.query(`INSERT INTO company_kpi (company_id, kpi_definition_id, selected, frequency) SELECT 901, id, true, 'annual' FROM kpi_definition WHERE company_id IS NULL AND code = ANY($1::text[])`, [c.kpis]);
        for (const [code, bySite] of Object.entries(c.values)) {
          for (const [site, v] of Object.entries(bySite)) {
            await db.query(
              `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
               SELECT 901, $1, id, '2025-01-01', '2025-12-31', 'annual', 'CY', $2, NULL, $2, 'auto', 'approved' FROM kpi_definition WHERE company_id IS NULL AND code = $3`,
              [Number(site), v, code],
            );
          }
        }
      });
      const on = await get("admin", `/insights/flow?${c.query}`);
      assert.equal(on.status, 200, JSON.stringify(on.json));
      const siteLinks = g.kpi_off.links.filter(([source]) => source.startsWith("site:"));
      check(on.json.data, { ...c, links: [...siteLinks, ...c.links] }, "kpi on");
      assert.equal(on.json.links["disc:BRSR:P6-E7"], "/kpi/reports/BRSR?year=2025#P6-E7");
    } finally {
      await withDb((db) => db.query(fs.readFileSync(path.join(FIXTURE_DIR, "cleanup-in6.sql"), "utf8")));
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
