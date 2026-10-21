// IN-6 · GET /insights/flow: sites → scopes equal Overview per site, the KPI-off
// variant (scopes → top categories), the KPI-on variant (scopes → GHG KPIs in
// tCO2e, KPIs → disclosures as counts of the ENABLED frameworks' mapping rows),
// site scope, tenant isolation (another company's KPI selection and values
// never show), roles, switch-off, no_data.
//
// Reads the API fixture's 2025 rows for company 1 (site 1: S1 4.29, S3 1 + 11;
// site 2: S1 10). KPI rows are written for 2025 and removed by wipeKpi.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, q, ensureKpiLibrary, kpiIds, kpiValue, wipeKpi, panel, assertEnvelope } = require("./in-lib.cjs");
const { setupCompany } = require("./kpi-lib.cjs");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const link = (flow, s, t) => flow.links.find((l) => l.source === s && l.target === t);
const into = (flow, id, measure = "tCO2e") => flow.links.filter((l) => l.target === id && l.measure === measure).reduce((a, l) => a + l.value, 0);
const outOf = (flow, id, measure = "tCO2e") => flow.links.filter((l) => l.source === id && l.measure === measure).reduce((a, l) => a + l.value, 0);

const reset = async () => {
  for (const id of [1, 2]) {
    await setInsights(id, false);
    await setKpi(id, false);
  }
  await wipeKpi();
};
test.before(async () => {
  await reset();
  await setInsights(1, true);
  await setInsights(2, true);
});
test.after(reset);

const flow = async (who, qs = "year=2025", opts) => (await panel(who, `/flow?${qs}`, opts)).json;

test("KPI off: sites → scopes equal /manager/overview per site, scopes → the top categories", async () => {
  const body = await flow("manager");
  assertEnvelope(assert, body, "flow");
  assert.equal(body.availability, "ok");
  const f = body.data;
  for (const site of [1, 2]) {
    const k = (await call("GET", `/manager/overview?period=2025&siteIds=${site}`, "manager")).json.kpis;
    for (const n of [1, 2, 3]) {
      const l = link(f, `site:${site}`, `scope:${n}`);
      const v = k[`scope_${n}`];
      if (v > 0) close(l.value, v, `site ${site} scope ${n}`);
      else assert.equal(l, undefined, `no zero link site ${site} scope ${n}`);
    }
  }
  close(link(f, "site:1", "scope:1").value, 4.29, "by hand");
  close(link(f, "site:1", "scope:3").value, 12, "by hand");
  close(link(f, "site:2", "scope:1").value, 10, "by hand");
  // Categories: Overview's by_category, top 6; each scope's tonnes go on.
  const cats = (await call("GET", "/manager/overview?period=2025", "manager")).json.by_category;
  for (const c of cats.slice(0, 6)) close(link(f, `scope:${c.scope.slice(-1)}`, `cat:${c.category_id}`).value, c.total, c.category_name);
  for (const n of [1, 3]) close(outOf(f, `scope:${n}`), into(f, `scope:${n}`), `scope ${n} conserved`);
  assert.ok(f.nodes.every((n) => n.column <= 2), "no disclosure column");
  assert.ok(f.nodes.some((n) => n.kind === "category" && n.column === 2));
  assert.ok(!f.links.some((l) => l.measure === "count"));
  assert.ok(body.links["site:1"] && body.links["scope:1"] && body.links["cat:1"]);
  // Stable node ids and columns.
  assert.deepEqual(f.nodes.filter((n) => n.column === 1).map((n) => n.id), ["scope:1", "scope:2", "scope:3"]);
  assert.deepEqual(f.nodes.filter((n) => n.column === 0).map((n) => [n.id, n.label]), [["site:1", "CI Plant A"], ["site:2", "CI Plant B"]]);
});

test("KPI on: GHG KPIs take their scope's tonnes; disclosures of enabled frameworks only, one count per mapping", async () => {
  ensureKpiLibrary();
  await setKpi(1, true);
  await setKpi(2, true);
  const codes = ["GHG_SCOPE1", "GHG_SCOPE2_LB", "GHG_SCOPE3", "ENERGY_TOTAL", "WATER_WITHDRAWAL"];
  await setupCompany(1, { frameworks: ["GRI", "BRSR"], kpis: codes, frequencies: Object.fromEntries(codes.map((c) => [c, "annual"])), topicOwners: false });
  // Company 2 selects ESRS and GHG_SCOPE1 with a big value: never on company 1's flow.
  await setupCompany(2, { frameworks: ["ESRS"], kpis: ["GHG_SCOPE1"], frequencies: { GHG_SCOPE1: "annual" }, topicOwners: false });
  const ids = await kpiIds(codes);
  await kpiValue(1, ids.GHG_SCOPE1, 1, 2025, 4.29, "approved", "auto");
  await kpiValue(1, ids.GHG_SCOPE1, 2, 2025, 10, "approved", "auto");
  await kpiValue(1, ids.GHG_SCOPE3, 1, 2025, 12, "approved", "auto");
  await kpiValue(1, ids.GHG_SCOPE2_LB, 1, 2025, 999, "pending", "auto"); // pending: never a tonnes link
  await kpiValue(2, ids.GHG_SCOPE1, 3, 2025, 5000, "approved", "auto");

  const f = (await flow("admin")).data;
  close(link(f, "scope:1", "kpi:GHG_SCOPE1").value, 14.29, "scope 1 → KPI");
  close(into(f, "scope:1"), outOf(f, "scope:1"), "scope 1 conserved");
  close(link(f, "scope:3", "kpi:GHG_SCOPE3").value, 12, "scope 3 → KPI");
  close(into(f, "scope:3"), outOf(f, "scope:3"), "scope 3 conserved");
  assert.equal(link(f, "scope:2", "kpi:GHG_SCOPE2_LB"), undefined, "no approved Scope 2 value");
  assert.ok(f.nodes.some((n) => n.id === "kpi:GHG_SCOPE2_LB"), "still a node: it feeds disclosures");
  assert.ok(f.nodes.some((n) => n.id === "kpi:ENERGY_TOTAL"), "energy: count-only node");
  assert.ok(!f.links.some((l) => l.target === "kpi:ENERGY_TOTAL"), "energy has no tonnes");
  assert.ok(!f.nodes.some((n) => n.id === "kpi:WATER_WITHDRAWAL"), "water isn't on the flow");
  assert.ok(!f.nodes.some((n) => n.kind === "category"), "no categories with KPI on");

  // Disclosures: exactly the mapping rows of the enabled frameworks for the KPIs shown.
  const rows = await q(
    `SELECT kd.code AS kpi, f.code AS fw, d.code, m.fit FROM kpi_disclosure_map m JOIN kpi_disclosure d ON d.id = m.disclosure_id
       JOIN kpi_framework f ON f.id = d.framework_id JOIN company_framework cf ON cf.framework_id = f.id AND cf.company_id = 1
       JOIN kpi_definition kd ON kd.id = m.kpi_definition_id WHERE kd.code = ANY($1::text[])`,
    [["GHG_SCOPE1", "GHG_SCOPE2_LB", "GHG_SCOPE3", "ENERGY_TOTAL"]],
  );
  const counts = f.links.filter((l) => l.measure === "count");
  assert.equal(counts.length, rows.length);
  for (const r of rows) {
    const l = link(f, `kpi:${r.kpi}`, `disc:${r.fw}:${r.code}`);
    assert.ok(l, `${r.kpi} → ${r.fw} ${r.code}`);
    assert.equal(l.value, 1);
    assert.equal(l.fit, r.fit);
  }
  // By hand from data/kpi/mappings.json: GRI 305-1/305-2/305-3/302-1, BRSR P6-E7 (×2), P6-L2, P6-E1 = 8.
  assert.equal(counts.length, 8);
  assert.ok(!f.nodes.some((n) => n.id.startsWith("disc:ESRS:")), "ESRS isn't enabled for company 1");
  assert.equal(into(f, "disc:BRSR:P6-E7", "count"), 2);
  const p6 = f.nodes.find((n) => n.id === "disc:BRSR:P6-E7");
  assert.equal(p6.column, 3);
  assert.equal(p6.kind, "disclosure");

  // Company 2 sees its own KPI and only ESRS.
  const f2 = (await flow("otherManager")).data;
  close(link(f2, "scope:1", "kpi:GHG_SCOPE1").value, 5000, "company 2 value");
  assert.ok(f2.nodes.filter((n) => n.column === 3).every((n) => n.id.startsWith("disc:ESRS:")));
  assert.ok(!f2.nodes.some((n) => n.id === "kpi:GHG_SCOPE3" || n.id === "site:1"));
});

test("site scope: sites=1 reads site 1 only, its KPI figure too; outside the scope is 404", async () => {
  const f = (await flow("manager", "year=2025&sites=1")).data;
  assert.deepEqual(f.nodes.filter((n) => n.column === 0).map((n) => n.id), ["site:1"]);
  close(link(f, "scope:1", "kpi:GHG_SCOPE1").value, 4.29, "site 1's own GHG_SCOPE1");
  for (const [who, qs] of [["manager", "sites=3"], ["otherManager", "sites=1"], ["admin", "sites=1,3"]]) {
    const r = await call("GET", `/insights/flow?year=2025&${qs}`, who);
    assert.equal(r.status, 404, `${who} ${qs}`);
    assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
  }
  assert.equal((await call("GET", "/insights/flow?company_id=1", "otherManager")).status, 404);
  const sa = (await flow("superadmin", "year=2025", { companyId: 1 })).data;
  close(link(sa, "scope:1", "kpi:GHG_SCOPE1").value, 14.29, "superadmin company 1");
  await wipeKpi();
  await setKpi(1, false);
  await setKpi(2, false);
});

test("no approved emissions in the period → no_data with a reason", async () => {
  const body = await flow("manager", "year=2012");
  assert.equal(body.availability, "no_data");
  assert.equal(body.data, null);
  assert.match(body.reason, /Approved emissions/);
});

test("roles and switch-off: Users IN_FORBIDDEN, IN_OFF when the switch is off", async () => {
  for (const who of ["user", "multiSiteUser"]) assert.equal((await call("GET", "/insights/flow?year=2025", who)).json.code, "IN_FORBIDDEN");
  assert.equal((await call("GET", "/insights/flow?year=2025", "superadmin")).json.code, "IN_COMPANY_REQUIRED");
  await setInsights(1, false);
  try {
    for (const who of ["manager", "admin"]) {
      const r = await call("GET", "/insights/flow?year=2025", who);
      assert.equal(r.status, 403);
      assert.equal(r.json.code, "IN_OFF");
    }
  } finally {
    await setInsights(1, true);
  }
});
