// IN-3 · GET /insights/cards: the envelope, cards fired from the fixture's
// real figures (largest_source and pending_large worked by hand from
// ci/api/fixture.sql), at most six and ranked, KPI tracking off drops the KPI
// rules only (biggest_mover), roles, site scope, tenant isolation, switch-off
// and `?ai=1` accepted (rule text until IN-9).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, ensureKpiLibrary, kpiIds, kpiValue, wipeKpi, panel, assertEnvelope } = require("./in-lib.cjs");
const { setupCompany } = require("./kpi-lib.cjs");

const RANK = ["critical", "attention", "good", "info"];

const reset = async () => {
  await setInsights(1, false);
  await setInsights(2, false);
  await setKpi(1, false);
  await wipeKpi();
};
test.before(async () => {
  await reset();
  await setInsights(1, true);
  await setInsights(2, true);
});
test.after(reset);

const cards = async (who, qs, opts) => (await panel(who, `/cards?${qs}`, opts)).json;
const byRule = (body, rule) => body.data.cards.find((c) => c.rule === rule);

test("the envelope, and cards from site 1's 2025 figures worked by hand", async () => {
  const body = await cards("manager", "year=2025&sites=1");
  assertEnvelope(assert, body, "cards");
  assert.equal(body.availability, "ok");
  // Site 1, 2025 approved: Stationary Combustion 4.29 (row 1), Business Travel 1.0 + 11.0 (rows 3, 14) → gross 16.29;
  // Business Travel is 12 ÷ 16.29 = 73.7 % → "74".
  const largest = byRule(body, "largest_source");
  assert.deepEqual(largest.params, { category: "Business Travel", share_pct: 74 });
  assert.equal(largest.severity, "info");
  assert.equal(largest.panel, "flow");
  // Pending: rows 2 (312.4 t) and 5 (0.5 t, the FERA twin of approved row 1, so its own entry) → two
  // entries as the approvals list counts them, 312.9 t against 16.29 t net → ≥ 5 %.
  const pending = byRule(body, "pending_large");
  const ov = (await call("GET", "/manager/overview?period=2025&siteIds=1", "manager")).json;
  assert.equal(ov.kpis.pending_review_count, 2);
  assert.deepEqual(pending.params, { count: 2, link: "/data/approvals" });
  assert.equal(pending.link, "/data/approvals");
  assert.equal(body.links.pending_large, "/data/approvals");
  // One site: no concentration card.
  assert.equal(byRule(body, "site_concentration"), undefined);
  for (const c of body.data.cards) {
    assert.equal(c.source, "rule");
    assert.equal(c.id, c.rule);
    assert.equal(c.text, undefined);
  }
});

test("at most six cards, ranked by severity", async () => {
  for (const qs of ["year=2025", "year=2024", "year=2025&sites=2", "year=2026&yearType=FY"]) {
    const list = (await cards("admin", qs)).data.cards;
    assert.ok(list.length <= 6, qs);
    const ranks = list.map((c) => RANK.indexOf(c.severity));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `${qs} ordered`);
  }
});

test("KPI tracking off drops the KPI rules only; on, /kpi/esg's top mover makes a card", async () => {
  ensureKpiLibrary();
  await setKpi(1, true);
  const codes = ["WATER_WITHDRAWAL", "EMPLOYEES_TOTAL"];
  await setupCompany(1, { frameworks: ["GRI"], kpis: codes, frequencies: Object.fromEntries(codes.map((c) => [c, "annual"])), topicOwners: false });
  const ids = await kpiIds(codes);
  await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2024, 1000);
  await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2025, 800);
  const on = await cards("admin", "year=2025&sites=1");
  const esg = (await call("GET", "/kpi/esg?year=2025", "admin")).json;
  const top = esg.movers[0];
  const mover = byRule(on, "biggest_mover");
  assert.ok(mover, JSON.stringify(on.data.cards));
  assert.equal(mover.params.name, top.name);
  assert.equal(mover.params.change_pct, Math.abs(top.change_pct) < 10 ? Math.round(top.change_pct * 10) / 10 : Math.round(top.change_pct));
  assert.equal(mover.severity, top.good ? "good" : "attention");
  await setKpi(1, false);
  const off = await cards("admin", "year=2025&sites=1");
  assert.equal(byRule(off, "biggest_mover"), undefined);
  assert.equal(byRule(off, "coverage_gap"), undefined);
  assert.equal(byRule(off, "target_off_track"), undefined);
  const nonKpi = (b) => b.data.cards.filter((c) => !["biggest_mover", "coverage_gap", "target_off_track"].includes(c.rule)).map((c) => [c.rule, c.params]);
  assert.deepEqual(nonKpi(off), nonKpi(on));
  await wipeKpi();
});

test("?ai=1 is accepted and answers rule cards until IN-9; a bad ai value is 400", async () => {
  const ai = await cards("manager", "year=2025&sites=1&ai=1");
  assert.ok(ai.data.cards.every((c) => c.source === "rule"));
  const r = await call("GET", "/insights/cards?ai=yes", "manager");
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "IN_VALIDATION");
});

test("roles, site scope, tenant isolation and switch-off", async () => {
  for (const who of ["user", "multiSiteUser"]) assert.equal((await call("GET", "/insights/cards?year=2025", who)).json.code, "IN_FORBIDDEN");
  for (const [who, qs] of [["manager", "sites=3"], ["otherManager", "sites=1"]]) {
    const r = await call("GET", `/insights/cards?year=2025&${qs}`, who);
    assert.equal(r.status, 404, `${who} ${qs}`);
    assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
  }
  assert.equal((await call("GET", "/insights/cards?company_id=1", "otherManager")).status, 404);
  // Company 2's only 2025 row is 999 t of Stationary Combustion: 100 % of its footprint.
  const other = await cards("otherManager", "year=2025");
  assert.deepEqual(byRule(other, "largest_source").params, { category: "Stationary Combustion", share_pct: 100 });
  const sa = await cards("superadmin", "year=2025&sites=1", { companyId: 1 });
  assert.deepEqual(byRule(sa, "largest_source").params, { category: "Business Travel", share_pct: 74 });
  await setInsights(1, false);
  try {
    for (const who of ["manager", "admin"]) assert.equal((await call("GET", "/insights/cards?year=2025", who)).json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});
