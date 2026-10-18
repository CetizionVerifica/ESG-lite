// D19 (KPI wave E): ESG pillars and GET /kpi/esg.
//   - migrate:kpi-pillars: adds and backfills kpi_definition.pillar from the topic, twice clean,
//     never touching an override;
//   - the Superadmin's library override (and a re-seed keeping it), a topic change following its
//     pillar, the library pillar filter; a custom KPI's pillar defaults from its topic;
//   - `pillar` on the catalogue, setup kpis and topics_in_use, /kpi/my items, dashboard cards and
//     gaps, value rows and targets;
//   - /kpi/esg figures worked by hand (below), approved values only, D17 expected sites, the
//     filters, roles, tenant isolation, before setup and the switch.
//
// Company 1, CY 2025 (every period has ended), every KPI annual, no topic owners (so a manual KPI
// is expected on both sites). Values are written straight to the database (KPI-8 owns review).
//
//   Environment  GHG_SCOPE1 (auto)   2025: site 1 100, site 2 50     2024: 120, 80
//                GHG_SCOPE2_LB (auto) 2025: site 1 30                 2024: site 1 20
//                WATER_WITHDRAWAL     2025: site 1 1000, site 2 500 pending   2024: 1250, 750
//                WASTE_GENERATED      2025: site 1 3                  2024: —
//                ENERGY_TOTAL (auto)  —
//   Social       HOURS_WORKED         2025: 3,000,000 and 1,000,000   2024: 1,000,000 each
//                LTIFR                2025: 2 and 5                    2024: 5 and 5
//                EMPLOYEES_TOTAL      2025: 200                        2024: 160      (company)
//                WOMEN_IN_WORKFORCE   2025: 30                         2024: 25       (company)
//                TRAINING_HOURS_AVG   2025: 12 pending                 2024: 10       (company)
//                WOMEN_ON_BOARD       —                                                (company)
//   Governance   REVENUE              —                                                (company)
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, setTopicOwners } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const SELECTED = [
  "GHG_SCOPE1", "GHG_SCOPE2_LB", "WATER_WITHDRAWAL", "WASTE_GENERATED", "ENERGY_TOTAL",
  "HOURS_WORKED", "LTIFR", "EMPLOYEES_TOTAL", "WOMEN_IN_WORKFORCE", "TRAINING_HOURS_AVG", "WOMEN_ON_BOARD", "REVENUE",
];
const TOPIC_PILLAR = {
  climate: "environment", energy: "environment", water: "environment", waste: "environment", pollution: "environment", biodiversity: "environment", materials: "environment",
  workforce: "social", health_safety: "social", diversity: "social", training: "social", human_rights: "social", community: "social", customers: "social",
  governance: "governance", ethics: "governance",
};
const ids = {};
const wipe = async () => {
  await q(`DELETE FROM kpi_target WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM company_kpi WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_definition WHERE company_id IN (1, 2) OR code LIKE 'TESTE\\_%'`);
  await clearSetup();
};
const value = (code, site, year, v, status = "approved", source = "manual") =>
  q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
     VALUES (1, $1, $2, $3, $4, 'annual', 'CY', $5, NULL, $5, $6, $7)`,
    [site, ids[code], `${year}-01-01`, `${year}-12-31`, v, source, status],
  );
const get = async (who, qs = "") => {
  const r = await call("GET", `/kpi/esg?year=2025${qs}`, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const pillarOf = (r, p) => r.pillars.find((x) => x.pillar === p);
const counts = (p) => [p.kpis, p.approved, p.pending, p.missing, p.not_due, p.coverage_pct, p.change.approved_pct_vs_last_year];
const trend = (r, code) => r.trends.find((t) => t.code === code);

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "migrateKpiPillars", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment", "migrateKpiTargets"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI", "BRSR", "ESRS"], kpis: SELECTED, frequencies: Object.fromEntries(SELECTED.map((c) => [c, "annual"])), topicOwners: false });
  await setupCompany(2, { frameworks: ["GRI"], kpis: ["WATER_WITHDRAWAL"] });
  for (const code of SELECTED) ids[code] = (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
  // 2025
  await value("GHG_SCOPE1", 1, 2025, 100, "approved", "auto");
  await value("GHG_SCOPE1", 2, 2025, 50, "approved", "auto");
  await value("GHG_SCOPE2_LB", 1, 2025, 30, "approved", "auto");
  await value("WATER_WITHDRAWAL", 1, 2025, 1000);
  await value("WATER_WITHDRAWAL", 2, 2025, 500, "pending");
  await value("WASTE_GENERATED", 1, 2025, 3);
  await value("HOURS_WORKED", 1, 2025, 3000000);
  await value("HOURS_WORKED", 2, 2025, 1000000);
  await value("LTIFR", 1, 2025, 2);
  await value("LTIFR", 2, 2025, 5);
  await value("EMPLOYEES_TOTAL", null, 2025, 200);
  await value("WOMEN_IN_WORKFORCE", null, 2025, 30);
  await value("TRAINING_HOURS_AVG", null, 2025, 12, "pending");
  // 2024
  await value("GHG_SCOPE1", 1, 2024, 120, "approved", "auto");
  await value("GHG_SCOPE1", 2, 2024, 80, "approved", "auto");
  await value("GHG_SCOPE2_LB", 1, 2024, 20, "approved", "auto");
  await value("WATER_WITHDRAWAL", 1, 2024, 1250);
  await value("WATER_WITHDRAWAL", 2, 2024, 750);
  await value("HOURS_WORKED", 1, 2024, 1000000);
  await value("HOURS_WORKED", 2, 2024, 1000000);
  await value("LTIFR", 1, 2024, 5);
  await value("LTIFR", 2, 2024, 5);
  await value("EMPLOYEES_TOTAL", null, 2024, 160);
  await value("WOMEN_IN_WORKFORCE", null, 2024, 25);
  await value("TRAINING_HOURS_AVG", null, 2024, 10);
  // A draft and a rejected value never count.
  await value("WASTE_GENERATED", 2, 2025, 99, "draft");
  await value("REVENUE", null, 2025, 99, "rejected");
  await q(`INSERT INTO kpi_target (company_id, kpi_definition_id, site_id, baseline_year, baseline_value, target_year, target_value, direction, created_by) VALUES (1, $1, NULL, 2024, 2000, 2030, 1000, 'reduce', 3)`, [ids.WATER_WITHDRAWAL]);
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await q(`UPDATE kpi_definition SET pillar = 'social', edited_at = NULL WHERE company_id IS NULL AND code = 'WOMEN_ON_BOARD'`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_library', 'kpi_setup') AND entity_id IN (SELECT id FROM kpi_definition WHERE code LIKE 'TESTE\\_%')`);
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

test("migrate:kpi-pillars adds the column and fills it from the topic; twice clean; an override is kept", async () => {
  const filled = (r) => Number(/; (\d+) KPI\(s\) given/.exec(r.stdout)?.[1]);
  const nullable = async () => (await q(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'kpi_definition' AND column_name = 'pillar'`))[0]?.is_nullable;
  const [{ n: total }] = await q(`SELECT COUNT(*)::int AS n FROM kpi_definition`);
  // A database from before wave E: no column at all.
  await q(`ALTER TABLE kpi_definition DROP COLUMN pillar`);
  const first = runScript("migrateKpiPillars");
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.equal(filled(first), total, "every KPI got a pillar");
  assert.equal(await nullable(), "NO");
  const rows = await q(`SELECT code, topic, pillar FROM kpi_definition`);
  for (const r of rows) assert.equal(r.pillar, TOPIC_PILLAR[r.topic], r.code);
  const second = runScript("migrateKpiPillars");
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(filled(second), 0, "the second run changes nothing");
  // Half done (nullable, some rows empty), with an override: only the empty rows are filled.
  await q(`ALTER TABLE kpi_definition ALTER COLUMN pillar DROP NOT NULL`);
  await q(`UPDATE kpi_definition SET pillar = 'governance' WHERE company_id IS NULL AND code = 'WATER_RECYCLED'`);
  await q(`UPDATE kpi_definition SET pillar = NULL WHERE company_id IS NULL AND code IN ('ENERGY_TOTAL', 'LTIFR')`);
  const third = runScript("migrateKpiPillars");
  assert.equal(filled(third), 2);
  assert.equal(await nullable(), "NO");
  const pick = await q(`SELECT code, pillar FROM kpi_definition WHERE company_id IS NULL AND code IN ('ENERGY_TOTAL', 'LTIFR', 'WATER_RECYCLED') ORDER BY code`);
  assert.deepEqual(pick.map((r) => [r.code, r.pillar]), [["ENERGY_TOTAL", "environment"], ["LTIFR", "social"], ["WATER_RECYCLED", "governance"]]);
  await q(`UPDATE kpi_definition SET pillar = 'environment' WHERE company_id IS NULL AND code = 'WATER_RECYCLED'`);
});

test("the ESG dashboard: pillars, topics and the change on last year, worked by hand", async () => {
  const r = await get("manager");
  assert.deepEqual([r.year, r.year_type, r.label], [2025, "CY", "2025"]);
  assert.deepEqual(r.filters, { site: null, pillar: null, topic: null });
  assert.deepEqual(r.pillars.map((p) => [p.pillar, p.label]), [["environment", "Environment"], ["social", "Social"], ["governance", "Governance"]]);
  // E: GHG 1 and 2 approved, water pending (site 2), waste missing (site 2), energy missing → 2 / 5 = 40 %.
  //    2024: GHG 1, 2 and water approved, waste and energy missing → 60 %. Change −20 points.
  const e = pillarOf(r, "environment");
  assert.deepEqual(counts(e), [5, 2, 1, 2, 0, 40, -20]);
  assert.deepEqual(e.topics.map((t) => [t.topic, t.label, t.kpis, t.approved, t.pending, t.missing, t.coverage_pct]), [
    ["climate", "Climate", 2, 2, 0, 0, 100],
    ["energy", "Energy", 1, 0, 0, 1, 0],
    ["water", "Water", 1, 0, 1, 0, 0],
    ["waste", "Waste", 1, 0, 0, 1, 0],
  ]);
  // S: hours, LTIFR, employees, women approved; training pending; women on the board missing → 4 / 6 = 67 %.
  //    2024: training approved too → 5 / 6 = 83 %. Change −16 points.
  const s = pillarOf(r, "social");
  assert.deepEqual(counts(s), [6, 4, 1, 1, 0, 67, -16]);
  assert.deepEqual(s.topics.map((t) => [t.topic, t.kpis, t.coverage_pct]), [["workforce", 1, 100], ["health_safety", 2, 100], ["diversity", 2, 50], ["training", 1, 0]]);
  // G: revenue missing both years (a rejected value doesn't count).
  assert.deepEqual(counts(pillarOf(r, "governance")), [1, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(r.pending_not_in, { count: 2, link: "/data/approvals?view=kpi" });
});

test("headline trends: GHG Scope 1 + 2 from the approved auto values, series, change and target", async () => {
  const r = await get("admin");
  assert.deepEqual(r.trends.map((t) => [t.pillar, t.code]), [
    ["environment", "GHG_SCOPE1_2"], ["environment", "ENERGY_TOTAL"], ["environment", "WATER_WITHDRAWAL"], ["environment", "WASTE_GENERATED"],
    ["social", "EMPLOYEES_TOTAL"], ["social", "LTIFR"], ["social", "WOMEN_IN_WORKFORCE"], ["social", "TRAINING_HOURS_AVG"],
  ], "at most 4 per pillar: women on the board is the 5th Social headline; no Governance headline is selected");
  const ghg = trend(r, "GHG_SCOPE1_2");
  // 2025: 100 + 50 + 30 = 180; 2024: 120 + 80 + 20 = 220; (180 − 220) / 220 = −18.2 %.
  assert.deepEqual(
    [ghg.kpi_definition_id, ghg.topic, ghg.name, ghg.unit, ghg.direction_good, ghg.value, ghg.previous, ghg.change_pct, ghg.target],
    [ids.GHG_SCOPE1, "climate", "GHG emissions, Scope 1 and 2", "tCO2e", "down", 180, 220, -18.2, null],
  );
  assert.deepEqual(ghg.series, [2021, 2022, 2023, 2024, 2025].map((y) => ({ period: String(y), period_start: `${y}-01-01`, label: String(y), value: y === 2024 ? 220 : y === 2025 ? 180 : null })), "annual: the last 5 years");
  const w = trend(r, "WATER_WITHDRAWAL");
  // Site 2's 500 is pending: not in. 1,000 vs 2,000 → −50 %; target 2,000 → 1,000 by 2030 reached.
  assert.deepEqual([w.value, w.previous, w.change_pct, w.direction_good, w.unit, w.decimals], [1000, 2000, -50, "down", "kL", w.decimals]);
  assert.deepEqual(w.target, { progress_pct: 100, status: "on_track", label: "−50 % by 2030 from 2024" });
  assert.deepEqual([trend(r, "ENERGY_TOTAL").value, trend(r, "ENERGY_TOTAL").series.length], [null, 5]);
  assert.deepEqual([trend(r, "WASTE_GENERATED").value, trend(r, "WASTE_GENERATED").previous, trend(r, "WASTE_GENERATED").change_pct], [3, null, null], "the draft at site 2 isn't in");
  const l = trend(r, "LTIFR");
  assert.deepEqual([l.value, l.previous, l.change_pct, l.direction_good], [2.75, 5, -45, "down"], "(2 × 3m + 5 × 1m) / 4m hours");
  assert.deepEqual([trend(r, "EMPLOYEES_TOTAL").change_pct, trend(r, "EMPLOYEES_TOTAL").direction_good], [25, null]);
  assert.deepEqual([trend(r, "WOMEN_IN_WORKFORCE").change_pct, trend(r, "WOMEN_IN_WORKFORCE").direction_good], [20, "up"]);
  assert.deepEqual([trend(r, "TRAINING_HOURS_AVG").value, trend(r, "TRAINING_HOURS_AVG").previous], [null, 10], "pending isn't counted");
  for (const t of r.trends) assert.deepEqual(Object.keys(t), ["pillar", "topic", "kpi_definition_id", "code", "name", "unit", "decimals", "direction_good", "series", "value", "previous", "change_pct", "target"]);
});

test("sites × pillars, movers and the filters", async () => {
  const r = await get("admin");
  // Site 1: E 4 of 5 (energy missing) = 80; S 2 of 2. Site 2: E 1 of 5 (GHG 1) = 20; S 100. No site-level G KPI.
  assert.deepEqual(r.sites, [
    { site_id: 1, name: "CI Plant A", pillars: { environment: 80, social: 100, governance: null } },
    { site_id: 2, name: "CI Plant B", pillars: { environment: 20, social: 100, governance: null } },
  ]);
  // Hours +100 %, Scope 2 +50 %, water −50 %, LTIFR −45 %, employees +25 % (ties by code: before Scope 1's −25 %).
  assert.deepEqual(r.movers.map((x) => [x.kpi_definition_id, x.pillar, x.change_pct, x.direction_good, x.good]), [
    [ids.HOURS_WORKED, "social", 100, null, false],
    [ids.GHG_SCOPE2_LB, "environment", 50, "down", false],
    [ids.WATER_WITHDRAWAL, "environment", -50, "down", true],
    [ids.LTIFR, "social", -45, "down", true],
    [ids.EMPLOYEES_TOTAL, "social", 25, null, false],
  ]);
  assert.deepEqual(Object.keys(r.movers[0]), ["kpi_definition_id", "name", "pillar", "change_pct", "direction_good", "good"]);

  const env = await get("admin", "&pillar=environment");
  assert.deepEqual(env.filters, { site: null, pillar: "environment", topic: null });
  assert.deepEqual(env.pillars.map((p) => p.pillar), ["environment", "social", "governance"], "the cards stay");
  assert.ok(env.trends.every((t) => t.pillar === "environment") && env.trends.length === 4);
  assert.deepEqual(env.movers.map((x) => x.kpi_definition_id), [ids.GHG_SCOPE2_LB, ids.WATER_WITHDRAWAL, ids.GHG_SCOPE1]);
  assert.equal(env.pending_not_in.count, 1);

  const water = await get("admin", "&topic=water");
  assert.deepEqual(counts(pillarOf(water, "environment")), [1, 0, 1, 0, 0, 0, -100]);
  assert.deepEqual(counts(pillarOf(water, "social")), [0, 0, 0, 0, 0, null, null]);
  assert.deepEqual(water.trends.map((t) => t.code), ["WATER_WITHDRAWAL"]);
  assert.deepEqual(water.sites.map((s) => s.pillars), [{ environment: 100, social: null, governance: null }, { environment: 0, social: null, governance: null }]);

  // One site: company-level KPIs drop out (as the KPI-10 cards).
  const s2 = await get("manager", "&site=2");
  assert.deepEqual(counts(pillarOf(s2, "environment")).slice(0, 6), [5, 1, 1, 3, 0, 20]);
  assert.deepEqual(counts(pillarOf(s2, "social")).slice(0, 6), [2, 2, 0, 0, 0, 100]);
  assert.deepEqual(counts(pillarOf(s2, "governance")).slice(0, 6), [0, 0, 0, 0, 0, null]);
  assert.deepEqual(s2.sites.map((s) => s.site_id), [2]);
  assert.deepEqual([trend(s2, "GHG_SCOPE1_2").value, trend(s2, "GHG_SCOPE1_2").previous, trend(s2, "GHG_SCOPE1_2").change_pct], [50, 80, -37.5]);
  assert.deepEqual(s2.trends.map((t) => t.code), ["GHG_SCOPE1_2", "ENERGY_TOTAL", "WATER_WITHDRAWAL", "WASTE_GENERATED", "LTIFR"]);
  assert.equal(s2.pending_not_in.count, 1);
});

test("D17 expected sites: a manual KPI owned on one site is expected there only", async () => {
  await setTopicOwners(1, { 1: 1 }, ["waste"]);
  try {
    const r = await get("admin");
    // Waste is now expected on site 1 only, which has it: E 3 of 5 = 60.
    assert.deepEqual(counts(pillarOf(r, "environment")).slice(0, 6), [5, 3, 1, 1, 0, 60]);
    assert.equal(r.sites.find((s) => s.site_id === 2).pillars.environment, 25, "site 2 doesn't owe waste: 1 of 4");
  } finally {
    await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1`);
  }
});

test("the library pillar override: Superadmin only, kept by a re-seed, moves the headline; a topic change follows its pillar", async () => {
  const put = (who, id, body) => call("PUT", `/kpi/library/definitions/${id}`, who, body);
  assert.equal((await put("admin", ids.WOMEN_ON_BOARD, { pillar: "governance" })).status, 403);
  const bad = await put("superadmin", ids.WOMEN_ON_BOARD, { pillar: "economic" });
  assert.deepEqual([bad.status, bad.json.code], [400, "KPI_VALIDATION"]);
  const ok = await put("superadmin", ids.WOMEN_ON_BOARD, { pillar: "governance" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.definition.topic, ok.json.definition.pillar], ["diversity", "governance"]);
  const reseed = runScript("seedKpiLibrary");
  assert.equal(reseed.status, 0, reseed.stderr);
  assert.equal((await q(`SELECT pillar FROM kpi_definition WHERE id = $1`, [ids.WOMEN_ON_BOARD]))[0].pillar, "governance", "an edited row keeps its pillar");
  const lib = await call("GET", "/kpi/library/definitions?pillar=governance", "superadmin");
  assert.deepEqual(lib.json.definitions.map((d) => d.code).sort(), ["REVENUE", "WOMEN_ON_BOARD"]);

  const r = await get("admin");
  assert.deepEqual(r.trends.filter((t) => t.pillar === "governance").map((t) => t.code), ["WOMEN_ON_BOARD"]);
  assert.deepEqual(counts(pillarOf(r, "governance")).slice(0, 6), [2, 0, 0, 2, 0, 0]);
  assert.deepEqual(pillarOf(r, "governance").topics.map((t) => t.topic), ["diversity", "governance"]);
  assert.deepEqual(counts(pillarOf(r, "social")).slice(0, 6), [5, 4, 1, 0, 0, 80]);

  // A new library KPI takes its topic's pillar; moving topic follows it, unless overridden.
  const made = await call("POST", "/kpi/library/definitions", "superadmin", {
    code: "TESTE_SITE_VISITS", name: "Site visits", question: "How many?", topic: "water", value_type: "integer", unit_dimension: "count",
    canonical_unit: "count", allowed_units: ["count"], aggregation: "sum", level: "site", default_frequency: "annual", source: "manual",
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.definition.id;
  assert.equal(made.json.definition.pillar, "environment");
  assert.equal((await put("superadmin", id, { topic: "training" })).json.definition.pillar, "social", "follows the new topic");
  assert.equal((await put("superadmin", id, { pillar: "governance" })).json.definition.pillar, "governance");
  assert.equal((await put("superadmin", id, { topic: "water" })).json.definition.pillar, "governance", "an override stays");
  assert.equal((await put("superadmin", id, { topic: "energy", pillar: "environment" })).json.definition.pillar, "environment");
});

test("a custom KPI's pillar defaults from its topic; the Admin may set it; /kpi/esg counts it there", async () => {
  const body = { name: "ESG test supplier audits", question: "How many supplier audits?", topic: "community", value_type: "integer", unit_dimension: "count", canonical_unit: "count", allowed_units: ["count"], aggregation: "sum", level: "company", default_frequency: "annual" };
  const a = await call("POST", "/kpi/setup/custom-kpis", "admin", body);
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.definition.pillar, "social");
  const b = await call("POST", "/kpi/setup/custom-kpis?company_id=1", "superadmin", { ...body, name: "ESG test board meetings", pillar: "governance" });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.equal(b.json.definition.pillar, "governance");
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, name: "ESG bad", pillar: "economic" })).json.code, "KPI_VALIDATION");
  try {
    const setup = (await call("GET", "/kpi/setup", "admin")).json;
    assert.deepEqual(setup.kpis.filter((k) => k.custom).map((k) => k.pillar).sort(), ["governance", "social"]);
    const r = await get("admin");
    assert.equal(pillarOf(r, "governance").kpis, 3, "revenue, women on the board (moved above) and the board meetings KPI");
    assert.equal(pillarOf(r, "social").kpis, 6, "the five Social KPIs left and the supplier audits KPI");
  } finally {
    await q(`DELETE FROM company_kpi WHERE kpi_definition_id IN ($1, $2)`, [a.json.definition.id, b.json.definition.id]);
    await q(`DELETE FROM kpi_definition WHERE id IN ($1, $2)`, [a.json.definition.id, b.json.definition.id]);
  }
});

test("pillar on the catalogue, setup, /kpi/my, dashboard cards and gaps, value rows and targets", async () => {
  await q(`UPDATE kpi_definition SET pillar = 'social', edited_at = NULL WHERE company_id IS NULL AND code = 'WOMEN_ON_BOARD'`);
  const cat = (await call("GET", "/kpi/catalogue", "admin")).json;
  for (const d of cat.definitions) assert.equal(d.pillar, TOPIC_PILLAR[d.topic], d.code);
  const setup = (await call("GET", "/kpi/setup", "manager")).json;
  for (const k of setup.kpis) assert.equal(k.pillar, TOPIC_PILLAR[k.topic], k.code);
  assert.ok(setup.topics_in_use.length > 0);
  for (const t of setup.topics_in_use) assert.equal(t.pillar, TOPIC_PILLAR[t.topic], t.topic);
  const dash = (await call("GET", "/kpi/dashboard?year=2025", "manager")).json;
  for (const c of dash.cards) assert.equal(c.pillar, TOPIC_PILLAR[c.topic], c.code);
  assert.ok(dash.gaps.length > 0);
  for (const g of dash.gaps) assert.equal(g.pillar, TOPIC_PILLAR[g.topic], g.code);
  const vals = (await call("GET", "/kpi/values?kpi=WATER_WITHDRAWAL", "admin")).json.values;
  assert.ok(vals.length && vals.every((v) => v.pillar === "environment"));
  const targets = (await call("GET", "/kpi/targets", "admin")).json.targets;
  assert.deepEqual(targets.map((t) => t.pillar), ["environment"]);
  await setTopicOwners(1, { 1: 1 }, ["water"]);
  try {
    const my = (await call("GET", "/kpi/my?period=2025-12", "user")).json;
    assert.ok(my.items.length > 0);
    for (const i of my.items) assert.equal(i.pillar, TOPIC_PILLAR[i.topic], i.code);
    assert.equal(my.items.find((i) => i.code === "WATER_WITHDRAWAL").value.pillar, "environment");
  } finally {
    await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1`);
  }
});

test("who sees it: Managers (their sites), Admins, the Superadmin with company_id; Users can't; tenant isolation", async () => {
  for (const who of ["user", "multiSiteUser"]) {
    const r = await call("GET", "/kpi/esg?year=2025", who);
    assert.deepEqual([r.status, r.json.code], [403, "KPI_FORBIDDEN"]);
  }
  assert.deepEqual([(await call("GET", "/kpi/esg?year=2025", "superadmin")).status, (await call("GET", "/kpi/esg?year=2025", "superadmin")).json.code], [400, "KPI_COMPANY_REQUIRED"]);
  assert.deepEqual(await get("superadmin", "&company_id=1"), await get("admin"), "the Superadmin sees what the Admin sees");
  assert.equal((await call("GET", "/kpi/esg?year=2025&company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/kpi/esg?year=2025&site=3", "manager")).status, 404, "company 2's site");
  assert.equal((await call("GET", "/kpi/esg", "manager")).json.code, "KPI_VALIDATION");
  assert.equal((await call("GET", "/kpi/esg?year=2025&pillar=economic", "manager")).status, 400);
  const other = await get("otherManager");
  assert.deepEqual(counts(pillarOf(other, "environment")).slice(0, 6), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(other.trends.map((t) => [t.code, t.value, t.previous]), [["WATER_WITHDRAWAL", null, null]], "none of company 1's values");
  assert.deepEqual(other.sites.map((s) => s.site_id), [3]);
  assert.deepEqual(other.movers, []);
  // A Manager sees their own sites only.
  await q(`DELETE FROM user_sites WHERE user_id = 2 AND site_id = 2`);
  try {
    const one = await get("manager");
    assert.deepEqual(one.sites.map((s) => s.site_id), [1]);
    assert.equal(trend(one, "GHG_SCOPE1_2").value, 130, "site 1 only: 100 + 30");
    assert.equal((await call("GET", "/kpi/esg?year=2025&site=2", "manager")).status, 404);
  } finally {
    await q(`INSERT INTO user_sites (user_id, site_id) VALUES (2, 2)`);
  }
});

test("before setup: 409 KPI_SETUP_INCOMPLETE; switch off: 403 KPI_TRACKING_OFF", async () => {
  await q(`UPDATE company_kpi_settings SET setup_completed_at = NULL WHERE company_id = 2`);
  try {
    assert.deepEqual([(await call("GET", "/kpi/esg?year=2025", "otherManager")).status, (await call("GET", "/kpi/esg?year=2025", "otherManager")).json.code], [409, "KPI_SETUP_INCOMPLETE"]);
  } finally {
    await q(`UPDATE company_kpi_settings SET setup_completed_at = now() WHERE company_id = 2`);
  }
  await setSwitch(1, false);
  try {
    for (const who of ["user", "manager", "admin"]) {
      const r = await call("GET", "/kpi/esg?year=2025", who);
      assert.deepEqual([r.status, r.json.code], [403, "KPI_TRACKING_OFF"], who);
    }
    const sa = await call("GET", "/kpi/esg?year=2025&company_id=1", "superadmin");
    assert.deepEqual([sa.status, sa.json.code], [403, "KPI_TRACKING_OFF"]);
  } finally {
    await setSwitch(1, true);
  }
});
