// IN-2 · GET /insights/esg-ring, /decoupling, /target-wall on the API fixture
// (company 1 and 2): the envelope, kpi_off and setup_incomplete for the ring,
// no_data for decoupling, the wall with and without KPI targets (SBTi only when
// KPI is off; sorting; pillar filter), roles, site scope, tenant isolation and
// switch-off. Hand-worked figures on the Insights fixture are in
// ci/golden/in/story (in-10-golden). Own rows: 2017–2018 on site 2, removed by id.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, q, ensureKpiLibrary, kpiIds, kpiValue, wipeKpi, panel, assertEnvelope } = require("./in-lib.cjs");
const { setupCompany } = require("./kpi-lib.cjs");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const own = { emissions: [], production: [], products: [] };
const ROUTES = ["/esg-ring", "/decoupling", "/target-wall"];

const reset = async () => {
  for (const id of [1, 2]) {
    await setInsights(id, false);
    await setKpi(id, false);
  }
  if (own.emissions.length) await q(`DELETE FROM emission WHERE pk_id = ANY($1::int[])`, [own.emissions]);
  if (own.production.length) await q(`DELETE FROM production_data WHERE production_id = ANY($1::int[])`, [own.production]);
  if (own.products.length) await q(`DELETE FROM product WHERE product_id = ANY($1::int[])`, [own.products]);
  await q(`DELETE FROM company_base_year WHERE company_id IN (1, 2)`);
  await wipeKpi();
};
test.before(async () => {
  await reset();
  await setInsights(1, true);
  await setInsights(2, true);
});
test.after(reset);

test("every IN-2 route answers the envelope", async () => {
  for (const [route, id] of [["/esg-ring", "esg_ring"], ["/decoupling", "decoupling"], ["/target-wall", "target_wall"]]) {
    assertEnvelope(assert, (await panel("manager", `${route}?year=2025`)).json, id);
  }
});

test("ESG ring: kpi_off while KPI tracking is off (200, data null); setup_incomplete before setup", async () => {
  const off = (await panel("admin", "/esg-ring?year=2025")).json;
  assert.equal(off.availability, "kpi_off");
  assert.equal(off.data, null);
  ensureKpiLibrary();
  await setKpi(1, true);
  try {
    const before = (await panel("admin", "/esg-ring?year=2025")).json;
    assert.equal(before.availability, "setup_incomplete");
    assert.equal(before.data, null);
    assert.ok(before.reason);
  } finally {
    await setKpi(1, false);
  }
});

test("ESG ring with KPI on: topics and counts equal /kpi/esg, coverage unrounded, auto_share by hand", async () => {
  ensureKpiLibrary();
  await setKpi(1, true);
  try {
    const codes = ["GHG_SCOPE1", "GHG_SCOPE2_LB", "GHG_SCOPE3", "WATER_WITHDRAWAL", "WOMEN_ON_BOARD"];
    await setupCompany(1, { frameworks: ["GRI"], kpis: codes, frequencies: Object.fromEntries(codes.map((c) => [c, "annual"])), topicOwners: false });
    const ids = await kpiIds(codes);
    // climate: 3 auto KPIs, one with a value on site 1 → approved 1 of 3, auto_share 33.3.
    await kpiValue(1, ids.GHG_SCOPE1, 1, 2025, 15.29, "approved", "auto");
    // water: site 1 approved, site 2 approved → approved; governance: company value pending.
    await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2025, 1000);
    await kpiValue(1, ids.WATER_WITHDRAWAL, 2, 2025, 600);
    await kpiValue(1, ids.WOMEN_ON_BOARD, null, 2025, 25, "pending");
    const r = (await panel("admin", "/esg-ring?year=2025")).json;
    assert.equal(r.availability, "ok");
    const e = (await call("GET", "/kpi/esg?year=2025", "admin")).json;
    assert.deepEqual(r.data.pillars.map((p) => p.pillar), e.pillars.map((p) => p.pillar));
    for (const p of e.pillars) {
      const rp = r.data.pillars.find((x) => x.pillar === p.pillar);
      assert.equal(rp.kpis, p.kpis);
      assert.equal(rp.approved, p.approved);
      assert.equal(rp.label, p.label);
      assert.equal(Math.round(rp.coverage_pct), p.coverage_pct ?? 0, p.pillar);
      assert.deepEqual(rp.topics.map((t) => t.topic), p.topics.map((t) => t.topic));
    }
    const env = r.data.pillars.find((p) => p.pillar === "environment");
    const climate = env.topics.find((t) => t.topic === "climate");
    assert.equal(climate.kpis, 3);
    assert.equal(climate.approved, 1);
    close(climate.coverage_pct, 100 / 3, "climate coverage");
    close(climate.auto_share, 100 / 3, "climate auto_share");
    const water = env.topics.find((t) => t.topic === "water");
    assert.equal(water.coverage_pct, 100);
    assert.equal(water.auto_share, 0);
    const gov = r.data.pillars.find((p) => p.pillar === "governance");
    assert.equal(gov.coverage_pct, 0);
    close(r.data.pct, 200 / 5, "overall: 2 approved of 5 counted");
    assert.equal(r.pending_not_in.kpi_values, e.pending_not_in.count);
    assert.equal(r.links["pillar:environment"], "/kpi/esg?year=2025&pillar=environment");
    // A Manager's site filter: site 2 only → the climate value on site 1 is out.
    const s2 = (await panel("manager", "/esg-ring?year=2025&sites=2")).json;
    const c2 = s2.data.pillars.find((p) => p.pillar === "environment").topics.find((t) => t.topic === "climate");
    assert.equal(c2.approved, 0);
    assert.equal(c2.auto_share, 0);
  } finally {
    await wipeKpi();
    await setKpi(1, false);
  }
});

test("decoupling: no_data with fewer than two years of emissions and production; numbers with two", async () => {
  const none = (await panel("manager", "/decoupling?year=2025")).json; // the fixture has no production
  assert.equal(none.availability, "no_data");
  assert.equal(none.data, null);
  assert.match(none.reason, /production/i);
  own.products = (await q(`INSERT INTO product (name, unit, site_id) VALUES ('IN-2 bar', 't', 2) RETURNING product_id`)).map((r) => r.product_id);
  own.production = (await q(`INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES ($1, 2, 1000, 't', '2017-01-01', '2017-12-31', 'approved', 7), ($1, 2, 1250, 't', '2018-01-01', '2018-12-31', 'approved', 7) RETURNING production_id`, [own.products[0]])).map((r) => r.production_id);
  own.emissions = (await q(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES ('{}', 400, 'tCO2e', '2017-06-30', 'approved', 7, 1, 2, 'monthly'), ('{}', 360, 'tCO2e', '2018-06-30', 'approved', 7, 1, 2, 'monthly') RETURNING pk_id`)).map((r) => r.pk_id);
  const one = (await panel("manager", "/decoupling?year=2017&years=2&sites=2")).json;
  assert.equal(one.availability, "no_data", "2016 + 2017: one year with both");
  const r = (await panel("manager", "/decoupling?year=2018&years=2&sites=2")).json;
  assert.equal(r.availability, "ok");
  const d = r.data;
  assert.deepEqual(d.years, [2017, 2018]);
  assert.equal(d.base_year, 2017);
  const [out, em, int] = d.series;
  assert.deepEqual(out.index, [100, 125]);
  assert.deepEqual(out.raw, [1000, 1250]);
  assert.equal(out.unit, "t");
  assert.deepEqual(em.index, [100, 90]);
  assert.deepEqual(em.raw, [400, 360]);
  close(int.index[1], (360 / 1250 / (400 / 1000)) * 100, "intensity index");
  assert.equal(d.combined_output, false);
  assert.equal(d.decoupled, true);
  close(d.headline.output_change_pct, 25, "output");
  close(d.headline.emissions_change_pct, -10, "emissions");
  close(d.headline.intensity_change_pct, -28, "intensity 0.4 → 0.288");
  // All of the Manager's sites: site 1 has no production in 2017 → the output is a combined index.
  const all = (await panel("manager", "/decoupling?year=2018&years=2")).json;
  assert.equal(all.data.combined_output, true);
  assert.deepEqual(all.data.series[0].index, [100, 125], "only site 2 has output weight");
  // years outside 2..10 → 400.
  for (const n of [1, 11]) assert.equal((await call("GET", `/insights/decoupling?years=${n}`, "manager")).status, 400);
});

test("target wall: empty without a base year or KPI; SBTi items with one; KPI targets join when KPI is on, worst first", async () => {
  assert.deepEqual((await panel("admin", "/target-wall?year=2018&sites=2")).json.data.items, []);
  await q(`INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (1, 'Scope 3', 2017, 'CY')`);
  try {
  const sb = (await panel("admin", "/target-wall?year=2018&sites=2")).json.data.items;
  assert.deepEqual(sb.map((i) => i.id).sort(), ["sbti:long", "sbti:near"]);
  const near = sb.find((i) => i.id === "sbti:near");
  // Base 400 t (2017, site 2 Scope 1), target 2027 = 400 × 0.958^10; latest 2018 360 t.
  const t = (await call("POST", "/user/targets/tables", "admin", { siteIds: [2], baseYear: 2017, targetYear: 2027, annualRate: 0.042 })).json;
  assert.equal(near.baseline.value, t.targetBoundaryBase);
  assert.equal(near.target.value, t.tables.table1[t.tables.table1.length - 1].targetEmission);
  // Latest = the last year after the base with data on the Targets page (the fixture's FY batch dated
  // 31 Mar 2026 on site 2 is calendar 2026 there: 120 t).
  const last = t.tables.table3.filter((r) => r.year > 2017 && r.status !== "No Data").pop();
  assert.deepEqual(near.latest, { year: last.year, value: last.actualTotal });
  assert.deepEqual(near.latest, { year: 2026, value: 120 });
  close(near.progress_pct, ((400 - 120) / (400 - near.target.value)) * 100, "near progress");
  const yearEnd = (y) => Date.UTC(y, 11, 31, 23, 59, 59);
  const now = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  close(near.expected_pct, Math.min(100, Math.max(0, ((now - yearEnd(2017)) / (yearEnd(2027) - yearEnd(2017))) * 100)), "near expected (I6 line at today)");
  assert.equal(near.source, "sbti");
  assert.equal(near.pillar, "environment");
  assert.equal(near.direction_good, "down");
  } catch (err) {
    await q(`DELETE FROM company_base_year WHERE company_id = 1`);
    throw err;
  }

  ensureKpiLibrary();
  await setKpi(1, true);
  try {
    const codes = ["WATER_WITHDRAWAL", "WOMEN_ON_BOARD"];
    await setupCompany(1, { frameworks: ["GRI"], kpis: codes, frequencies: Object.fromEntries(codes.map((c) => [c, "annual"])), topicOwners: false });
    const ids = await kpiIds(codes);
    await kpiValue(1, ids.WOMEN_ON_BOARD, null, 2022, 20);
    await kpiValue(1, ids.WOMEN_ON_BOARD, null, 2025, 45);
    await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2020, 1000);
    await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2025, 950);
    // Up is good: 20 → 40 by 2030, now 45 → reached. Down is good: 1,000 → 500 by 2026, now 950 → 10 % of the way.
    await q(`INSERT INTO kpi_target (company_id, kpi_definition_id, site_id, baseline_year, baseline_value, target_year, target_value, direction) VALUES (1, $1, NULL, 2022, 20, 2030, 40, 'increase'), (1, $2, NULL, 2020, 1000, 2026, 500, 'reduce')`, [ids.WOMEN_ON_BOARD, ids.WATER_WITHDRAWAL]);
    const items = (await panel("admin", "/target-wall?year=2018&sites=2")).json.data.items;
    const women = items.find((i) => i.source === "kpi" && i.pillar === "governance");
    const water = items.find((i) => i.source === "kpi" && i.pillar === "environment");
    assert.equal(women.status, "reached");
    close(women.progress_pct, 125, "women progress");
    assert.equal(women.direction_good, "up");
    assert.equal(women.link, `/kpi/targets?kpi=${ids.WOMEN_ON_BOARD}`);
    close(water.progress_pct, 10, "water progress");
    assert.equal(water.direction_good, "down");
    assert.ok(water.expected_pct > 90, "2020 → 2026 is nearly over");
    assert.equal(water.status, "off_track");
    // Sorted: off_track, at_risk, on_track, reached, no_data; then by (expected − progress) desc.
    const rank = { off_track: 0, at_risk: 1, on_track: 2, reached: 3, no_data: 4 };
    for (let i = 1; i < items.length; i++) assert.ok(rank[items[i - 1].status] <= rank[items[i].status], `order at ${i}`);
    assert.equal(items[0].id, water.id, "the off-track water target leads");
    // Two reached items (women 125 %, the near-term SBTi item past 100 % with the 2026 batch): the
    // smaller overshoot has the larger (expected − progress), so it comes first.
    const reached = items.filter((i) => i.status === "reached");
    for (let i = 1; i < reached.length; i++) assert.ok(reached[i - 1].expected_pct - reached[i - 1].progress_pct >= reached[i].expected_pct - reached[i].progress_pct);
    // pillar filter.
    const gov = (await panel("admin", "/target-wall?year=2018&sites=2&pillar=governance")).json.data.items;
    assert.deepEqual(gov.map((i) => i.id), [women.id]);
    // KPI off again: the wall is SBTi only.
    await setKpi(1, false);
    const off = (await panel("admin", "/target-wall?year=2018&sites=2")).json.data.items;
    assert.ok(off.every((i) => i.source === "sbti"));
  } finally {
    await wipeKpi();
    await setKpi(1, false);
    await q(`DELETE FROM company_base_year WHERE company_id = 1`);
  }
});

test("roles, site scope, tenant isolation and switch-off on every IN-2 route", async () => {
  for (const route of ROUTES) {
    const u = await call("GET", `/insights${route}`, "user");
    assert.equal(u.status, 403, route);
    assert.equal(u.json.code, "IN_FORBIDDEN");
    for (const [who, qs] of [["manager", "sites=3"], ["otherManager", "sites=1"], ["admin", "company_id=2"]]) {
      const r = await call("GET", `/insights${route}?${qs}`, who);
      assert.equal(r.status, 404, `${who} ${route} ${qs}`);
      assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
    }
    assert.equal((await call("GET", `/insights${route}?company_id=1`, "superadmin")).status, 200, route);
    assert.equal((await call("GET", `/insights${route}`, "superadmin")).json.code, "IN_COMPANY_REQUIRED");
  }
  await setInsights(1, false);
  try {
    for (const route of ROUTES) for (const who of ["manager", "admin"]) assert.equal((await call("GET", `/insights${route}`, who)).json.code, "IN_OFF", `${who} ${route}`);
  } finally {
    await setInsights(1, true);
  }
});

test("company 2 sees only its own data: its wall and decoupling never read company 1", async () => {
  await q(`INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (1, 'Scope 3', 2017, 'CY')`);
  try {
    const items = (await panel("otherManager", "/target-wall?year=2025")).json.data.items;
    assert.deepEqual(items, [], "company 2 has no base year");
    assert.equal((await panel("otherManager", "/decoupling?year=2018&years=2")).json.availability, "no_data");
  } finally {
    await q(`DELETE FROM company_base_year WHERE company_id = 1`);
  }
});
