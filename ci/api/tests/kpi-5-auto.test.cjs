// KPI-5 auto KPIs: POST /kpi/auto/refresh against the golden cases in
// ci/golden/kpi/auto.json — every GHG figure equal to the GHG report's own
// JSON for the same sites and period; energy worked by hand with NCVs (an
// unconvertible row listed as skipped); production and waste; a Scope 3
// category. Then staleness through the real emission and production write
// paths (approve, reject, delete), refresh after it, formulas recomputing
// after a refresh (and on approval), locks, read-only, role matrix, tenant
// isolation and the switch.
//
// Two sites are added to company 1 (9101, 9102) so other tests' rows never
// mix in; manager 2 gets them for reviewing. Everything is removed afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const G = require("../../golden/kpi/auto.json");
const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const SITES = [9101, 9102];
const ids = {};

const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_period_lock WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_value', 'kpi_library') OR (entity_type = 'emission' AND entity_id >= 9600 AND entity_id < 9700)`);
  await q(`DELETE FROM kpi_disclosure_map WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE code LIKE 'TEST5_%')`);
  await q(`DELETE FROM company_kpi WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE code LIKE 'TEST5_%')`);
  await q(`DELETE FROM kpi_definition WHERE code LIKE 'TEST5_%'`);
  await clearSetup();
  await q(`DELETE FROM emission_document WHERE emission_id IN (SELECT pk_id FROM emission WHERE site_id = ANY($1::int[]))`, [SITES]);
  await q(`DELETE FROM emission WHERE site_id = ANY($1::int[])`, [SITES]);
  await q(`DELETE FROM production_data WHERE site_id = ANY($1::int[])`, [SITES]);
  await q(`DELETE FROM product WHERE name = 'KPI-5 billets'`);
  await q(`DELETE FROM company_scope3_category WHERE company_id = 1 AND ghg_category IN (5, 6) AND NOT EXISTS (SELECT 1 FROM emission e JOIN category c ON c.category_id = e.category_id JOIN site s ON s.site_id = e.site_id WHERE s.company_id = 1 AND c.ghg_category IN (5, 6))`).catch(() => {});
  await q(`DELETE FROM user_sites WHERE site_id = ANY($1::int[])`, [SITES]);
  await q(`DELETE FROM site_categories WHERE site_id = ANY($1::int[])`, [SITES]);
  await q(`DELETE FROM notification WHERE user_id IN (1, 2) AND created_at > now() - interval '1 hour' AND link LIKE '%emission%'`).catch(() => {});
  await q(`DELETE FROM site WHERE site_id = ANY($1::int[])`, [SITES]);
  await q(`DELETE FROM category WHERE category_id = ANY($1::int[])`, [G.categories.map((c) => c.category_id)]);
};

const libraryKpi = (code, autoSource, over = {}) => ({
  code, name: code, question: `${code}?`, topic: "climate", value_type: "number", unit_dimension: "mass", canonical_unit: "tCO2e",
  allowed_units: ["tCO2e"], aggregation: "sum", level: "site", default_frequency: "annual", source: "auto", auto_source: autoSource, ...over,
});

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await q(`INSERT INTO site (site_id, name, address, contact_person, company_id) VALUES (9101, 'KPI-5 Plant A', 'x', 'x', 1), (9102, 'KPI-5 Plant B', 'x', 'x', 1)`);
  await q(`INSERT INTO user_sites (user_id, site_id) VALUES (2, 9101), (2, 9102)`);
  for (const c of G.categories) await q(`INSERT INTO category (category_id, category_name, scope, ghg_category) VALUES ($1, $2, $3, $4)`, [c.category_id, c.category_name, c.scope, c.ghg_category]);
  const cats = [...new Set(G.rows.map((r) => r.category_id))];
  for (const s of SITES) for (const c of cats) await q(`INSERT INTO site_categories (site_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [s, c]);
  let pk = 9600;
  for (const r of G.rows) {
    ids[r.key] = ++pk;
    await q(
      `INSERT INTO emission (pk_id, activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period, activity_data_unit, upload_batch_id)
       VALUES ($1, $2, $3, 'tCO2e', $4, $5, 1, $6, $7, 'monthly', $8, $9)`,
      [pk, JSON.stringify(r.activity), r.tco2e, r.date, r.status ?? "approved", r.category_id, r.site_id, r.unit, r.key === G.after_reject.row ? "kpi5-batch" : null],
    );
  }
  const [prod] = await q(`INSERT INTO product (name, unit, site_id) VALUES ('KPI-5 billets', 'tonne', 9101) RETURNING product_id`);
  for (const p of G.production) {
    const [row] = await q(`INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING production_id`, [
      prod.product_id, p.site_id, p.quantity, p.unit, p.start, p.end, p.status,
    ]);
    ids[`production_${p.status}`] = row.production_id;
  }
  for (const def of [
    libraryKpi("TEST5_S3_CAT6", "ghg_scope3_category_6"),
    libraryKpi("TEST5_PRODUCTION", "production_output", { topic: "materials", canonical_unit: "tonne", allowed_units: ["tonne", "kg"] }),
    libraryKpi("TEST5_WASTE", "waste_total", { topic: "waste", canonical_unit: "tonne", allowed_units: ["tonne", "kg"], breakdowns: { by: ["method"], values: ["landfill", "recycling", "incineration"] } }),
  ]) {
    const r = await call("POST", "/kpi/library/definitions", "superadmin", def);
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  await setupCompany(1, { frameworks: ["GRI"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const refresh = async (who = "manager", year = G.year, query = "") => {
  const r = await call("POST", `/kpi/auto/refresh?year=${year}${query}`, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const stored = async (code, site, start) =>
  (await q(`SELECT v.* FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = 1 AND d.code = $1 AND v.site_id IS NOT DISTINCT FROM $2 AND v.period_start = $3`, [code, site, start]))[0];
const num = (v) => (v === null || v === undefined ? null : Number(v));

test("who may refresh: Managers, Admins, Superadmins; Users can't; bad year 400; another company 404; setup first", async () => {
  const user = await call("POST", `/kpi/auto/refresh?year=${G.year}`, "user");
  assert.equal(user.status, 403);
  assert.equal(user.json.code, "KPI_FORBIDDEN");
  assert.equal((await call("POST", "/kpi/auto/refresh", "manager")).json.code, "KPI_VALIDATION");
  assert.equal((await call("POST", "/kpi/auto/refresh?year=20x3", "manager")).status, 400);
  assert.equal((await call("POST", `/kpi/auto/refresh?year=${G.year}`, "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("POST", `/kpi/auto/refresh?year=${G.year}&company_id=1`, "otherManager")).status, 404);
  const notSetUp = await call("POST", `/kpi/auto/refresh?year=${G.year}`, "otherManager");
  assert.equal(notSetUp.status, 409);
  assert.equal(notSetUp.json.code, "KPI_SETUP_INCOMPLETE");
});

test("golden: every auto value equals the hand figure and the GHG report's own number", async () => {
  const r = await refresh("admin");
  assert.equal(r.year, G.year);
  assert.ok(r.refreshed >= G.cases.length, JSON.stringify(r));
  assert.ok(Array.isArray(r.values) && r.values.every((v) => v.source === "auto"));
  for (const c of G.cases) {
    const v = await stored(c.kpi, c.site_id, c.period_start);
    assert.ok(v, `${c.name}: no value`);
    assert.equal(num(v.value_canonical), c.value, c.name);
    assert.deepEqual([v.source, v.status, v.entered_by, v.checks], ["auto", "approved", null, null], c.name);
    if (c.breakdown) assert.deepEqual(v.breakdown, c.breakdown, c.name);
    if (c.skipped) {
      assert.equal(v.auto_snapshot.skipped.length, c.skipped, c.name);
      assert.equal(v.auto_snapshot.skipped[0].id, ids.hydrogen_s1);
    }
    if (c.report?.startsWith("tables.")) {
      const t = await call("POST", "/user/ghg/tables", "admin", { siteIds: [c.site_id], yearType: "CY", year: G.year });
      assert.equal(t.status, 200, JSON.stringify(t.json));
      assert.equal(num(v.value_canonical), Number(t.json.totals[String(G.year)][c.report.split(".")[1]]), `${c.name}: = the report`);
      assert.equal(v.auto_snapshot.function, "computeGhgTables");
    }
    if (c.report?.startsWith("scope3.")) {
      const s3 = await call("GET", `/reports/ghg/scope3?siteIds=${c.site_id}&year=${G.year}&yearType=CY`, "admin");
      assert.equal(s3.status, 200, JSON.stringify(s3.json));
      const want = c.report === "scope3.total_tco2e" ? s3.json.total_tco2e : s3.json.rows.find((x) => x.n === 6).tco2e;
      assert.equal(num(v.value_canonical), want, `${c.name}: = the report`);
    }
  }
  // Scope 1 snapshot names its rows; a pending row is never read.
  const s1 = await stored("GHG_SCOPE1", 9101, "2023-01-01");
  assert.deepEqual(s1.auto_snapshot.row_ids, [ids.diesel_s1, ids.refrigerant_s1, ids.hydrogen_s1]);
  assert.deepEqual(s1.auto_snapshot.filters, { site_ids: [9101], year_type: "CY", year: 2023, frequency: "yearly", month: null, quarter: null });
  // Market-based Scope 2 isn't recorded in ESGLite: never invented.
  assert.equal(await stored("GHG_SCOPE2_MB", 9101, "2023-01-01"), undefined);
  // Months with no energy rows have no value (never 0).
  assert.equal(await stored("ENERGY_TOTAL", 9101, "2023-02-01"), undefined);
  // Each write is audited, by nobody.
  const audit = await q(`SELECT action, changed_by FROM audit_log WHERE entity_type = 'kpi_value' AND entity_id = $1`, [s1.id]);
  assert.deepEqual(audit, [{ action: "auto_refresh", changed_by: null }]);

  // A second refresh changes nothing.
  const again = await refresh("manager");
  assert.equal(again.refreshed, 0, JSON.stringify(again));
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_type = 'kpi_value' AND entity_id = $1`, [s1.id]))[0].n, 1);
});

test("auto values are read-only", async () => {
  const r = await call("PUT", "/kpi/values", "admin", { items: [{ kpi_code: "GHG_SCOPE1", site_id: 9101, period_start: "2023-01-01", value_numeric: 1 }] });
  assert.equal(r.json.results[0].code, "KPI_AUTO_READ_ONLY");
  const v = await stored("GHG_SCOPE1", 9101, "2023-01-01");
  assert.deepEqual((await call("POST", "/kpi/values/submit", "admin", { ids: [v.id] })).json.refused, [{ id: v.id, code: "KPI_NOT_DRAFT" }]);
});

const sum = async (code) => Number((await q(`SELECT COALESCE(SUM(v.value_canonical), 0) AS s FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = 1 AND d.code = $1 AND v.period_start >= '2023-01-01' AND v.period_end <= '2023-12-31'`, [code]))[0].s);

let revenueId;
test("calculated KPIs recompute after a refresh: pending while revenue waits for review, approved once it's approved", async () => {
  const rev = await call("PUT", "/kpi/values", "admin", { items: [{ kpi_code: "REVENUE", site_id: null, period_start: "2023-01-01", value_numeric: 10 }] });
  revenueId = rev.json.results[0].value.id;
  assert.deepEqual((await call("POST", "/kpi/values/submit", "admin", { ids: [revenueId] })).json.submitted, [revenueId]);
  const pending = await stored("GHG_INTENSITY_REVENUE", null, "2023-01-01");
  const expected = Number(((await sum("GHG_SCOPE1")) + (await sum("GHG_SCOPE2_LB"))) / 10);
  assert.ok(pending, "submitting revenue recomputed the intensity");
  assert.equal(num(pending.value_canonical), Number(expected.toFixed(6)));
  assert.equal(pending.status, "pending");
  assert.equal(pending.comment, "Waiting for Revenue.");
  // KPI-8 isn't built: approve in the database, then the refresh recomputes.
  await q(`UPDATE kpi_value SET status = 'approved' WHERE id = $1`, [revenueId]);
  const r = await refresh("manager");
  assert.ok(r.formulas.written >= 1, JSON.stringify(r.formulas));
  const approved = await stored("GHG_INTENSITY_REVENUE", null, "2023-01-01");
  assert.deepEqual([approved.status, approved.comment, approved.id], ["approved", null, pending.id]);
  const share = await stored("ENERGY_RENEWABLE_SHARE", null, "2023-01-01");
  assert.ok(share && share.status === "approved", "auto inputs only: approved at once");
});

test("staleness: rejecting an approved row holds its auto values; the refresh fixes them (golden after_reject)", async () => {
  const before = await stored("GHG_INTENSITY_REVENUE", null, "2023-01-01");
  const r = await call("PUT", "/user/emissions/batch/kpi5-batch/reject", "manager", { comment: "Wrong meter" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const [code, start] of [["GHG_SCOPE1", "2023-01-01"], ["ENERGY_TOTAL", "2023-03-01"]]) {
    assert.deepEqual((await stored(code, 9101, start)).checks?.held, ["KPI_AUTO_STALE"], code);
  }
  assert.equal((await stored("ENERGY_TOTAL", 9102, "2023-07-01")).checks, null, "another site isn't touched");
  await refresh("manager");
  for (const c of G.after_reject.cases) {
    const v = await stored(c.kpi, c.site_id, c.period_start);
    assert.equal(num(v.value_canonical), c.value, c.kpi);
    assert.equal(v.checks, null);
  }
  const after = await stored("GHG_INTENSITY_REVENUE", null, "2023-01-01");
  assert.ok(num(after.value_canonical) < num(before.value_canonical), "the intensity followed the refresh");
});

test("staleness after approve and delete, and production; a locked period is left alone", async () => {
  const ok = await call("PUT", `/user/emissions/${ids.grid_s1_pending}/approve`, "manager", {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual((await stored("ENERGY_TOTAL", 9101, "2023-03-01")).checks?.held, ["KPI_AUTO_STALE"]);
  assert.deepEqual((await stored("GHG_SCOPE2_LB", 9101, "2023-01-01")).checks?.held, ["KPI_AUTO_STALE"]);

  const del = await call("DELETE", `/user/emissions/${ids.travel_s1}`, "manager");
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.deepEqual((await stored("TEST5_S3_CAT6", 9101, "2023-01-01")).checks?.held, ["KPI_AUTO_STALE"], "marked before the row went");

  const prod = await call("PUT", `/user/production-data/${ids.production_pending}/approve`, "manager", {});
  assert.equal(prod.status, 200, JSON.stringify(prod.json));
  assert.deepEqual((await stored("TEST5_PRODUCTION", 9101, "2023-01-01")).checks?.held, ["KPI_AUTO_STALE"]);
  assert.equal((await stored("GHG_SCOPE1", 9101, "2023-01-01")).checks, null, "production doesn't touch emissions KPIs");

  // Close March for site A: its energy stays as it was.
  await q(`INSERT INTO kpi_period_lock (company_id, site_id, year, period, year_type, locked_by) VALUES (1, 9101, 2023, 3, 'CY', 2)`);
  const r = await refresh("manager");
  assert.ok(r.locked >= 1, JSON.stringify(r));
  assert.equal(num((await stored("ENERGY_TOTAL", 9101, "2023-03-01")).value_canonical), 43.2, "locked: unchanged");
  assert.equal(num((await stored("GHG_SCOPE2_LB", 9101, "2023-01-01")).value_canonical), 7.1, "the year overlaps the closed March: unchanged too");
  assert.equal(num((await stored("TEST5_PRODUCTION", 9101, "2023-01-01")).value_canonical), 1200, "every 2023 value of site A overlaps March");
  await q(`UPDATE kpi_period_lock SET reopened_at = now(), reopened_by = 2 WHERE company_id = 1 AND site_id = 9101`);
  await refresh("manager");
  assert.equal(num((await stored("ENERGY_TOTAL", 9101, "2023-03-01")).value_canonical), 61.2, "reopened: refreshed (36 + 18 + 7.2)");
  assert.equal(num((await stored("GHG_SCOPE2_LB", 9101, "2023-01-01")).value_canonical), 10.65);
  assert.equal((await stored("GHG_SCOPE2_LB", 9101, "2023-01-01")).checks, null);
  assert.equal(await stored("TEST5_S3_CAT6", 9101, "2023-01-01"), undefined, "no rows left: the value is removed");
  assert.equal(num((await stored("GHG_SCOPE3", 9101, "2023-01-01")).value_canonical), 1.6);
  assert.equal(num((await stored("TEST5_PRODUCTION", 9101, "2023-01-01")).value_canonical), 1299);
});

test("tenant isolation and the switch", async () => {
  assert.deepEqual((await call("GET", "/kpi/values", "otherManager")).json.values.filter((v) => v.source === "auto"), []);
  const mine = await refresh("manager");
  assert.ok(mine.values.every((v) => v.company_id === 1));
  await setSwitch(1, false);
  try {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call("POST", `/kpi/auto/refresh?year=${G.year}`, who);
      assert.equal(r.status, 403);
      assert.equal(r.json.code, "KPI_TRACKING_OFF");
    }
    // With the switch off, emission writes don't touch KPI values.
    const before = await q(`SELECT id, checks FROM kpi_value WHERE company_id = 1 AND source = 'auto' ORDER BY id`);
    await call("DELETE", `/user/emissions/${ids.waste_s1}`, "manager");
    assert.deepEqual(await q(`SELECT id, checks FROM kpi_value WHERE company_id = 1 AND source = 'auto' ORDER BY id`), before);
  } finally {
    await setSwitch(1, true);
  }
});
