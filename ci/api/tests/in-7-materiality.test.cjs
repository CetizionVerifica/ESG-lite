// IN-7 · GET /insights/materiality and PUT /kpi/setup/materiality-scores:
// worst-status roll-up, weight normalisation, scored false with a missing
// score (by hand), kpi_off, setup_incomplete, the pillar filter, roles
// (scores Admin and Superadmin only), validation (IN_SCORES_INVALID),
// tenant isolation, and the switches (IN_OFF for the panel, KPI_TRACKING_OFF
// for the PUT).
//
// Company 1, CY 2025. Selected KPIs and their ESRS topics (kpi_disclosure_map →
// kpi_disclosure.esrs_topic): GHG_SCOPE1 → E1; WATER_WITHDRAWAL, WATER_CONSUMPTION → E3;
// WASTE_GENERATED → E5; EMPLOYEES_TOTAL → S1 (not material). Material: E1, E3, E5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, q, ensureKpiLibrary, kpiIds, kpiValue, wipeKpi, panel, assertEnvelope } = require("./in-lib.cjs");
const { setupCompany } = require("./kpi-lib.cjs");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const CODES = ["GHG_SCOPE1", "WATER_WITHDRAWAL", "WATER_CONSUMPTION", "WASTE_GENERATED", "EMPLOYEES_TOTAL"];
let ids;

const reset = async () => {
  await wipeKpi();
  await q(`DELETE FROM audit_log WHERE entity_type = 'kpi_setup' AND action = 'materiality_scores'`);
  for (const id of [1, 2]) {
    await setInsights(id, false);
    await setKpi(id, false);
  }
};
test.before(async () => {
  await reset();
  ensureKpiLibrary();
  for (const id of [1, 2]) {
    await setInsights(id, true);
    await setKpi(id, true);
  }
  ids = await kpiIds(CODES);
});
test.after(reset);

const setup = async () => {
  await setupCompany(1, { frameworks: ["ESRS", "GRI"], kpis: CODES, frequencies: Object.fromEntries(CODES.map((c) => [c, "annual"])), topicOwners: false });
  await q(`INSERT INTO company_material_topic (company_id, esrs_topic, material, reason, impact_score, financial_score) VALUES
             (1, 'E1', true, NULL, 8, 9), (1, 'E3', true, NULL, 7, 6.5), (1, 'E5', true, NULL, 4, NULL), (1, 'S1', false, 'Small team', NULL, NULL)`);
  // E3: one reduce target behind the line (off track), one achieved (reached).
  await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2025, 980);
  await kpiValue(1, ids.WATER_CONSUMPTION, 1, 2025, 390);
  await q(
    `INSERT INTO kpi_target (company_id, kpi_definition_id, site_id, baseline_year, baseline_value, target_year, target_value, direction) VALUES
       (1, $1, NULL, 2023, 1000, 2026, 700, 'reduce'), (1, $2, NULL, 2023, 500, 2025, 400, 'reduce')`,
    [ids.WATER_WITHDRAWAL, ids.WATER_CONSUMPTION],
  );
};

const get = async (who = "admin", qs = "year=2025") => (await panel(who, `/materiality?${qs}`)).json;

test("kpi_off while KPI tracking is off; setup_incomplete before setup and without material topics", async () => {
  await setKpi(1, false);
  const off = await get();
  assertEnvelope(assert, off, "materiality");
  assert.equal(off.availability, "kpi_off");
  assert.equal(off.data, null);
  await setKpi(1, true);
  assert.equal((await get()).availability, "setup_incomplete");
  await setupCompany(1, { frameworks: ["ESRS"], kpis: CODES, topicOwners: false });
  const none = await get();
  assert.equal(none.availability, "setup_incomplete");
  assert.match(none.reason, /material topics/);
  await wipeKpi();
});

test("points by hand: worst status, counts, weights 1–10, scored false with E5's missing financial score", async () => {
  await setup();
  const r = await get();
  assert.equal(r.availability, "ok");
  const d = r.data;
  assert.equal(d.scored, false);
  assert.deepEqual(d.points.map((p) => p.esrs_topic), ["E1", "E3", "E5"]);
  const [e1, e3, e5] = d.points;
  assert.equal(e1.label, "Climate change");
  assert.deepEqual([e1.impact, e1.financial, e1.kpis, e1.status, e1.on_track, e1.off_track], [8, 9, 1, "no_data", 0, 0]);
  // E3: withdrawal 1,000 → 980 of the way to 700 is 6.7 % against ~94 % expected → off_track; consumption 390 ≤ 400 → reached.
  assert.deepEqual([e3.impact, e3.financial, e3.kpis, e3.status, e3.on_track, e3.off_track], [7, 6.5, 2, "off_track", 1, 1]);
  assert.deepEqual([e5.impact, e5.financial, e5.kpis, e5.status], [4, null, 1, "no_data"]);
  // Weights: company 1 has approved tCO₂e in 2025 → E1 = 10; E3 2 of 4 KPIs → 1 + 9 × 50 % = 5.5; E5 1 of 4 → 3.25.
  close(e1.weight, 10, "E1");
  close(e3.weight, 5.5, "E3");
  close(e5.weight, 3.25, "E5");
  assert.equal(e3.link, "/kpi/esg?topic=E3");
  assert.equal(r.links.E3, "/kpi/esg?topic=E3");
  assert.equal(r.links.scores, "/kpi/setup?step=materiality");
  // A year without approved emissions: E1 weighs by its KPI share (1 of 4 → 3.25).
  close((await get("admin", "year=2016")).data.points[0].weight, 3.25, "E1 without tCO2e");
  // Pillar filter keeps E topics only (S1 isn't material anyway).
  assert.equal((await get("admin", "year=2025&pillar=social")).data.points.length, 0);
  assert.equal((await get("admin", "year=2025&pillar=environment")).data.points.length, 3);
});

test("PUT /kpi/setup/materiality-scores: Admin and Superadmin save; scored turns true; audit lists topics only", async () => {
  const r = await call("PUT", "/kpi/setup/materiality-scores", "admin", { topics: [{ esrs_topic: "E5", impact_score: 4.5, financial_score: 3 }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.topics.find((t) => t.esrs_topic === "E5"), { esrs_topic: "E5", label: "E5 Resource use and circular economy", material: true, impact_score: 4.5, financial_score: 3 });
  const p = await get();
  assert.equal(p.data.scored, true);
  assert.deepEqual([p.data.points[2].impact, p.data.points[2].financial], [4.5, 3]);
  const sa = await call("PUT", "/kpi/setup/materiality-scores?company_id=1", "superadmin", { topics: [{ esrs_topic: "E1", impact_score: 9.5, financial_score: null }], company_id: 1 });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.equal((await get()).data.scored, false);
  const audit = await q(`SELECT entity_id, changed_fields, changed_by FROM audit_log WHERE entity_type = 'kpi_setup' AND action = 'materiality_scores' ORDER BY id`);
  assert.equal(audit.length, 2);
  assert.deepEqual(audit.map((a) => [a.entity_id, a.changed_fields, a.changed_by]), [[1, { esrs_topics: ["E5"] }, 3], [1, { esrs_topics: ["E1"] }, 5]]);
});

test("scores validation: out of range, two decimals, a non-material or unknown topic, duplicates → IN_SCORES_INVALID; nothing saved", async () => {
  const before = await q(`SELECT esrs_topic, impact_score, financial_score FROM company_material_topic WHERE company_id = 1 ORDER BY esrs_topic`);
  for (const body of [
    {},
    { topics: [] },
    { topics: [{ esrs_topic: "E3", impact_score: 11, financial_score: 1 }] },
    { topics: [{ esrs_topic: "E3", impact_score: -1, financial_score: 1 }] },
    { topics: [{ esrs_topic: "E3", impact_score: 1.25, financial_score: 1 }] },
    { topics: [{ esrs_topic: "S1", impact_score: 5, financial_score: 5 }] },
    { topics: [{ esrs_topic: "E3", impact_score: 5, financial_score: 5 }, { esrs_topic: "X9", impact_score: 1, financial_score: 1 }] },
    { topics: [{ esrs_topic: "E3", impact_score: 5, financial_score: 5 }, { esrs_topic: "E3", impact_score: 6, financial_score: 6 }] },
  ]) {
    const r = await call("PUT", "/kpi/setup/materiality-scores", "admin", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, "IN_SCORES_INVALID", JSON.stringify(body));
  }
  assert.deepEqual(await q(`SELECT esrs_topic, impact_score, financial_score FROM company_material_topic WHERE company_id = 1 ORDER BY esrs_topic`), before);
});

test("scores roles, tenant and switch: Manager/User 403; company 2's Admin can't score company 1; KPI off → KPI_TRACKING_OFF", async () => {
  const body = { topics: [{ esrs_topic: "E3", impact_score: 1, financial_score: 1 }] };
  for (const who of ["manager", "user", "multiSiteUser"]) {
    const r = await call("PUT", "/kpi/setup/materiality-scores", who, body);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "KPI_FORBIDDEN", who);
  }
  assert.equal((await call("PUT", "/kpi/setup/materiality-scores?company_id=2", "admin", body)).status, 404);
  // Company 2 has no material topics: its own Superadmin call is a validation answer, never company 1's rows.
  const other = await call("PUT", "/kpi/setup/materiality-scores?company_id=2", "superadmin", { ...body, company_id: 2 });
  assert.equal(other.status, 400);
  assert.equal(other.json.code, "IN_SCORES_INVALID");
  assert.equal((await call("PUT", "/kpi/setup/materiality-scores", "superadmin", body)).json.code, "KPI_COMPANY_REQUIRED");
  await setKpi(1, false);
  try {
    const off = await call("PUT", "/kpi/setup/materiality-scores", "admin", body);
    assert.equal(off.status, 403);
    assert.equal(off.json.code, "KPI_TRACKING_OFF");
  } finally {
    await setKpi(1, true);
  }
  assert.equal(Number((await q(`SELECT impact_score FROM company_material_topic WHERE company_id = 1 AND esrs_topic = 'E3'`))[0].impact_score), 7);
});

test("panel roles, scope, tenant and switch-off", async () => {
  for (const who of ["user", "multiSiteUser"]) assert.equal((await call("GET", "/insights/materiality?year=2025", who)).json.code, "IN_FORBIDDEN");
  const mgr = await get("manager");
  assert.equal(mgr.data.points.length, 3);
  assert.equal((await get("superadmin")).data.points.length, 3);
  assert.equal((await call("GET", "/insights/materiality?year=2025&sites=3", "manager")).status, 404);
  assert.equal((await call("GET", "/insights/materiality?company_id=1", "otherManager")).status, 404);
  // Company 2 (KPI on, no setup) never sees company 1's topics.
  assert.equal((await get("otherManager")).availability, "setup_incomplete");
  await setInsights(1, false);
  try {
    const r = await call("GET", "/insights/materiality?year=2025", "admin");
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});
