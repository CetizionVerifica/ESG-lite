// KPI-10 dashboard: GET /kpi/dashboard coverage per framework (worked by hand
// for GRI, BRSR with Core and ESRS with materiality), gaps with owners scoped
// to the caller's sites, KPI cards (year figure, last year, 12 periods,
// LTIFR weighted by hours, target progress), "pending, not counted yet";
// POST /kpi/dashboard/remind once a day per item; role matrix, tenant
// isolation and the switch.
//
// Company 1, CY 2025 (a past year: every period is due), all KPIs annual.
// Approved and pending values are written straight to the database (the
// review path is KPI-8's).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, kpiRoutes, concrete, setTopicOwners } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const SELECTED = ["WATER_WITHDRAWAL", "WATER_DISCHARGE", "WATER_CONSUMPTION", "FATALITIES", "RECORDABLE_INJURIES", "HIGH_CONSEQUENCE_INJURIES", "HOURS_WORKED", "LTIFR", "REVENUE"];
const EXCLUDED = ["AIR_NOX", "AIR_SOX", "AIR_PM", "WATER_INTENSITY_REVENUE"];
const ids = {};
const wipe = async () => {
  await q(`DELETE FROM kpi_target WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM notification WHERE type LIKE 'kpi_%'`);
  await q(`DELETE FROM emission WHERE pk_id = 9801`);
  await clearSetup();
};
const value = (code, site, year, v, status = "approved", source = "manual") =>
  q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
     VALUES (1, $1, $2, $3, $4, 'annual', 'CY', $5, NULL, $5, $6, $7)`,
    [site, ids[code], `${year}-01-01`, `${year}-12-31`, v, source, status],
  );
const dash = async (who, qs = "") => {
  const r = await call("GET", `/kpi/dashboard?year=2025${qs}`, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTargets"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  // The coverage below was worked by hand with per-KPI assignments only (D17: no topic owners here,
  // so a KPI with no owner anywhere is expected on every site, and one assigned on site 2 only there).
  await setupCompany(1, { frameworks: ["GRI", "BRSR", "ESRS"], kpis: SELECTED, frequencies: Object.fromEntries(SELECTED.map((c) => [c, "annual"])), topicOwners: false });
  await setupCompany(2, { frameworks: ["GRI"], kpis: ["WATER_WITHDRAWAL"] });
  for (const code of [...SELECTED, ...EXCLUDED]) ids[code] = (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
  for (const code of EXCLUDED) await q(`INSERT INTO company_kpi (company_id, kpi_definition_id, selected, reason_excluded) VALUES (1, $1, false, 'No stacks or water intensity reporting')`, [ids[code]]);
  await q(`INSERT INTO company_material_topic (company_id, esrs_topic, material, reason) VALUES (1, 'E3', false, 'No water stress at our sites')`);
  await q(`INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id) VALUES (1, $1, 2, 7)`, [ids.HIGH_CONSEQUENCE_INJURIES]);
  // 2025
  await value("WATER_WITHDRAWAL", 1, 2025, 1000);
  await value("WATER_WITHDRAWAL", 2, 2025, 500);
  await value("WATER_DISCHARGE", 1, 2025, 400);
  await value("WATER_DISCHARGE", 2, 2025, 100, "pending");
  await value("WATER_CONSUMPTION", 1, 2025, 600, "approved", "formula");
  await value("FATALITIES", 1, 2025, 0);
  await value("FATALITIES", 2, 2025, 0);
  await value("RECORDABLE_INJURIES", 1, 2025, 3);
  await value("HOURS_WORKED", 1, 2025, 3000000);
  await value("HOURS_WORKED", 2, 2025, 1000000);
  await value("LTIFR", 1, 2025, 2);
  await value("LTIFR", 2, 2025, 5);
  await value("RECORDABLE_INJURIES", 2, 2025, 9, "draft");
  // 2024 (last year)
  await value("WATER_WITHDRAWAL", 1, 2024, 1250);
  await value("WATER_WITHDRAWAL", 2, 2024, 750);
  await q(`INSERT INTO kpi_target (company_id, kpi_definition_id, site_id, baseline_year, baseline_value, target_year, target_value, direction, created_by) VALUES (1, $1, NULL, 2024, 2000, 2030, 1000, 'reduce', 3)`, [ids.WATER_WITHDRAWAL]);
  await q(
    `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, activity_data_unit)
     VALUES (9801, '{"activity_value": 10}', 1.2, 'tCO2e', '2025-06-30', 'pending', 1, 1, 1, 'monthly', 'litre')`,
  );
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const fw = (r, code) => r.coverage.find((c) => c.framework === code);
const pick = (c) => [c.required, c.approved, c.pending, c.missing, c.not_due, c.excluded, c.percent];

test("coverage per framework, worked by hand", async () => {
  const r = await dash("manager");
  assert.deepEqual([r.year, r.year_type, r.label], [2025, "CY", "2025"]);
  assert.deepEqual(r.coverage.map((c) => c.framework), ["GRI", "BRSR", "ESRS"]);

  // GRI: 32 required; 305-7 excluded (every air KPI left out with a reason) → 31 counted.
  // 303-3 approved (both sites), 303-5 approved (the calculated value), 303-4 pending (site 2),
  // 403-9 missing (high-consequence injuries nowhere, recordable injuries not on site 2; a draft
  // doesn't count); the other 27 aren't tracked → missing. 2 / 31 = 6 %.
  const gri = fw(r, "GRI");
  assert.deepEqual(pick(gri), [31, 2, 1, 28, 0, 1, 6]);
  const state = (c, code) => c.disclosures.find((d) => d.code === code).state;
  assert.deepEqual(["303-3", "303-4", "303-5", "403-9", "305-7", "302-1"].map((c) => state(gri, c)), ["approved", "pending", "approved", "missing", "excluded", "missing"]);
  assert.equal(gri.disclosures.find((d) => d.code === "302-1").reason_kind, "not_tracked");
  assert.deepEqual(gri.excluded_disclosures, [{ disclosure_id: gri.excluded_disclosures[0].disclosure_id, code: "305-7", title: gri.excluded_disclosures[0].title, reason_kind: "excluded", reason: "No stacks or water intensity reporting" }]);
  assert.equal(gri.core, null);
  assert.equal(gri.gaps, 2, "recordable injuries on site 2; high-consequence injuries on site 2 (assigned there only)");

  // BRSR: 26 disclosures, P6-L2 voluntary, P6-E6 excluded → 24 counted. P6-E3 approved (withdrawal and
  // consumption; intensity left out with a reason), P6-E4 pending. Core: 11, done 1. 1 / 24 = 4 %.
  const brsr = fw(r, "BRSR");
  assert.deepEqual(pick(brsr), [24, 1, 1, 22, 0, 1, 4]);
  assert.deepEqual(brsr.core, { done: 1, total: 11 });
  assert.equal(state(brsr, "P6-L2"), "voluntary");

  // ESRS: GOV-1 required (women on the board isn't tracked); E3 not material with its reason; the other topics (G1 too) undecided.
  const esrs = fw(r, "ESRS");
  assert.deepEqual(esrs.material_topics, [{ esrs_topic: "E3", material: false, reason: "No water stress at our sites" }]);
  assert.equal(gri.material_topics, undefined);
  assert.deepEqual(pick(esrs), [1, 0, 0, 1, 0, 17, 0]);
  assert.deepEqual(esrs.excluded_disclosures.find((d) => d.code === "E3-4"), { disclosure_id: esrs.excluded_disclosures.find((d) => d.code === "E3-4").disclosure_id, code: "E3-4", title: esrs.excluded_disclosures.find((d) => d.code === "E3-4").title, reason_kind: "not_material", reason: "No water stress at our sites" });

  assert.deepEqual((await dash("manager", "&framework=BRSR")).coverage.map((c) => c.framework), ["BRSR"]);
});

test("gaps: nothing submitted for a period that has ended, with the owner; scoped to the caller's sites", async () => {
  const r = await dash("manager");
  const g = r.gaps.map((x) => [x.code, x.site_id, x.periods_missing, x.owner_name]);
  // High-consequence injuries are assigned on site 2 only, so site 1 doesn't owe them.
  assert.deepEqual(g.sort(), [
    ["HIGH_CONSEQUENCE_INJURIES", 2, ["2025-01-01"], "CI Multi User"],
    ["RECORDABLE_INJURIES", 2, ["2025-01-01"], null],
    ["REVENUE", null, ["2025-01-01"], null],
  ].sort());
  const hc = r.gaps.find((x) => x.code === "HIGH_CONSEQUENCE_INJURIES" && x.site_id === 2);
  assert.deepEqual([hc.owner_user_id, hc.period_labels, hc.site_name, hc.link], [7, ["2025"], "CI Plant B", "/kpi?period=2025-12&site=2"]);
  assert.deepEqual([hc.kpi, hc.site, hc.owner, hc.frameworks], [{ id: ids.HIGH_CONSEQUENCE_INJURIES, code: "HIGH_CONSEQUENCE_INJURIES", name: hc.kpi_name }, { id: 2, name: "CI Plant B" }, { id: 7, name: "CI Multi User" }, ["GRI", "BRSR"]]);
  assert.deepEqual(r.gaps.find((x) => x.code === "REVENUE").frameworks, [], "revenue answers no counted disclosure");
  assert.deepEqual((await dash("manager", "&site=1")).gaps, [], "site 1 has everything it owes");
  assert.deepEqual((await dash("manager", "&site=2")).gaps.map((x) => x.code).sort(), ["HIGH_CONSEQUENCE_INJURIES", "RECORDABLE_INJURIES"]);
  assert.deepEqual((await dash("admin", "&topic=water")).gaps, []);
  assert.deepEqual((await dash("admin", "&framework=GRI")).gaps.map((x) => x.code).sort(), ["HIGH_CONSEQUENCE_INJURIES", "RECORDABLE_INJURIES"], "revenue answers no GRI disclosure");
});

test("cards: the approved year figure, last year, 12 periods, weighted LTIFR, the target's progress", async () => {
  const r = await dash("admin");
  const card = (code) => r.cards.find((c) => c.code === code);
  const w = card("WATER_WITHDRAWAL");
  assert.deepEqual([w.value, w.previous, w.change_pct, w.status, w.unit, w.pending], [1500, 2000, -25, "approved", "kL", 0]);
  assert.equal(w.series.length, 12);
  assert.deepEqual(w.series.slice(-2).map((p) => [p.label, p.value]), [["2024", 2000], ["2025", 1500]]);
  assert.equal(w.series[0].label, "2014");
  // Target 2,000 → 1,000 by 2030: (1,500 − 2,000) / −1,000 = 50 %; the line is at 1,833.3 in 2025 → on track.
  assert.deepEqual([w.target.target_year, w.target.progress_pct, w.target.status, w.target.label], [2030, 50, "on_track", "−50 % by 2030 from 2024"]);
  assert.deepEqual(w.series.at(-1), { period: "2025", period_start: "2025-01-01", label: "2025", value: 1500 });
  const d = card("WATER_DISCHARGE");
  assert.deepEqual([d.value, d.status, d.pending], [400, "partial", 1], "the pending site isn't counted");
  assert.equal(card("LTIFR").value, 2.75, "(2 × 3m + 5 × 1m) / 4m hours");
  assert.equal(card("REVENUE").value, null);
  assert.equal(card("REVENUE").status, "none");
  assert.deepEqual((await dash("admin", "&topic=water")).cards.map((c) => c.code).sort(), ["WATER_CONSUMPTION", "WATER_DISCHARGE", "WATER_WITHDRAWAL"]);
  const s2 = await dash("admin", "&site=2");
  assert.equal(s2.cards.find((c) => c.code === "WATER_WITHDRAWAL").value, 500);
  assert.ok(!s2.cards.some((c) => c.code === "REVENUE"), "company-level cards aren't per site");
  const [pendingRows] = await q(`SELECT COUNT(*)::int AS n FROM emission WHERE site_id IN (1, 2) AND status::text = 'pending' AND date_of_reporting BETWEEN '2025-01-01' AND '2025-12-31'`);
  assert.ok(pendingRows.n >= 1, "row 9801 at least");
  assert.deepEqual(r.pending_not_in, { count: 1, value_ids: r.pending_not_in.kpi_value_ids, kpi_values: 1, kpi_value_ids: r.pending_not_in.kpi_value_ids, emission_rows: pendingRows.n, link: "/data/approvals?view=kpi" });
  assert.equal(r.pending_not_in.kpi_value_ids.length, 1);
});

test("who sees it: Managers, Admins, the Superadmin; Users can't; tenant isolation; bad queries", async () => {
  for (const who of ["user", "multiSiteUser"]) assert.deepEqual([(await call("GET", "/kpi/dashboard?year=2025", who)).status, (await call("GET", "/kpi/dashboard?year=2025", who)).json.code], [403, "KPI_FORBIDDEN"]);
  assert.equal((await call("GET", "/kpi/dashboard?year=2025", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/kpi/dashboard?year=2025&company_id=1", "superadmin")).status, 200);
  assert.equal((await call("GET", "/kpi/dashboard?year=2025&company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/kpi/dashboard?year=2025&site=3", "manager")).status, 404, "company 2's site");
  const other = await dash("otherManager");
  assert.deepEqual(other.coverage.map((c) => c.framework), ["GRI"]);
  assert.deepEqual(other.cards.map((c) => [c.code, c.value]), [["WATER_WITHDRAWAL", null]], "none of company 1's values");
  assert.equal((await call("GET", "/kpi/dashboard", "manager")).json.code, "KPI_VALIDATION");
  assert.equal((await call("GET", "/kpi/dashboard?year=2025&framework=XBRL", "manager")).status, 400);
});

test("remind: kpi_due to the owner, at most once a day per item", async () => {
  const remind = (who, body) => call("POST", "/kpi/dashboard/remind", who, body);
  const r = await remind("manager", { kpi: ids.HIGH_CONSEQUENCE_INJURIES, site: 2 });
  assert.deepEqual(r.json, { reminded: true, owner_name: "CI Multi User", message: "Reminder sent to CI Multi User.", sent: true, notified: [7], already_today: [] });
  const [n] = await q(`SELECT * FROM notification WHERE user_id = 7 AND type = 'kpi_due'`);
  assert.deepEqual([n.title, n.link, n.meta.kpi_definition_id, n.meta.site_id], ["Reminder: KPI values due", "/kpi?site=2", ids.HIGH_CONSEQUENCE_INJURIES, 2]);
  assert.match(n.message, /High-consequence|high-consequence|injur/i);
  assert.deepEqual((await remind("admin", { kpi: ids.HIGH_CONSEQUENCE_INJURIES, site: 2 })).json, { reminded: false, owner_name: "CI Multi User", message: "CI Multi User was already reminded today.", sent: false, notified: [], already_today: [7] }, "once a day");
  // D17: unassigned is nobody's; a topic owner is reminded through the resolver.
  assert.deepEqual((await remind("manager", { kpi: ids.RECORDABLE_INJURIES, site: 1 })).json.details, { field: "kpi", rule: "nobody_owes_it" });
  await setTopicOwners(1, { 1: 1, company: 3 }, ["health_safety", "governance"]);
  try {
    assert.deepEqual((await remind("manager", { kpi: ids.RECORDABLE_INJURIES, site: 1 })).json.notified, [1], "the topic owner");
    assert.deepEqual((await remind("manager", { kpi: ids.REVENUE, site: null })).json.notified, [3], "company level: its topic owner");
  } finally {
    await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1`);
  }
  assert.equal((await remind("manager", { kpi: ids.WATER_CONSUMPTION, site: 1 })).json.code, "KPI_AUTO_READ_ONLY");
  assert.deepEqual((await remind("manager", { kpi: ids.REVENUE, site: 1 })).json.details, { field: "site", rule: "company_level_kpi" });
  assert.equal((await remind("manager", { kpi: ids.AIR_NOX, site: 1 })).json.code, "KPI_NOT_SELECTED");
  assert.equal((await remind("manager", { kpi: ids.FATALITIES, site: 3 })).status, 404);
  assert.equal((await remind("user", { kpi: ids.FATALITIES, site: 1 })).json.code, "KPI_FORBIDDEN");
  assert.equal((await remind("otherManager", { kpi: ids.FATALITIES, site: 1, company_id: 1 })).status, 404);
  assert.equal((await remind("manager", { kpi: ids.FATALITIES })).json.code, "KPI_VALIDATION");
});

test("switch off: every KPI-10 route answers KPI_TRACKING_OFF", async () => {
  const routes = kpiRoutes().filter((r) => r.path.startsWith("/dashboard"));
  assert.equal(routes.length, 2);
  await setSwitch(1, false);
  try {
    for (const r of routes) {
      const res = await call(r.method, concrete(r.path) + (r.method === "GET" ? "?year=2025" : ""), "manager", r.method === "GET" ? undefined : { kpi: 1, site: null });
      assert.deepEqual([res.status, res.json?.code], [403, "KPI_TRACKING_OFF"], `${r.method} ${r.path}`);
    }
  } finally {
    await setSwitch(1, true);
  }
});
