// IN-1 · GET /insights/summary: the envelope, server numbers equal the source
// pages (net and pending = GET /manager/overview, intensity = the emission
// intensity comparison, pathway = POST /user/targets/tables, readiness =
// GET /kpi/esg), roles, site scope, tenant isolation, switch-off, kpi_off,
// ETag/304 and the cache busting after an approval.
//
// Own rows live in 2017–2018 on site 2 (other tests use 2020 and later) and are
// removed by id; the fixture's 2024–2025 rows are read as they are.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, q, ensureKpiLibrary, kpiIds, kpiValue, wipeKpi, panel, assertEnvelope } = require("./in-lib.cjs");
const { setupCompany } = require("./kpi-lib.cjs");

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const own = { emissions: [], production: [], products: [] };

const reset = async () => {
  await setInsights(1, false);
  await setInsights(2, false);
  await setKpi(1, false);
  await setKpi(2, false);
  if (own.emissions.length) await q(`DELETE FROM emission WHERE pk_id = ANY($1::bigint[])`, [own.emissions]);
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

const summary = async (who, qs = "year=2025", opts) => (await panel(who, `/summary?${qs}`, opts)).json;

test("the envelope: panel, period, label, sites, stamp, links and pending_not_in", async () => {
  const body = await summary("manager");
  assertEnvelope(assert, body, "summary");
  assert.equal(body.availability, "ok");
  assert.deepEqual(body.period, { year: 2025, yearType: "CY" });
  assert.equal(body.sites, "all");
  assert.equal(body.label, "CY 2025 · All sites");
  for (const k of ["net", "pathway", "intensity", "readiness", "attention", "renewable_share_pct"]) assert.ok(k in body.data, k);
  assert.equal(body.data.net.unit, "tCO2e");
  const one = await summary("manager", "year=2025&sites=1");
  assert.deepEqual(one.sites, [1]);
  assert.equal(one.label, "CY 2025 · CI Plant A");
});

test("net, change and pending equal GET /manager/overview for CY and FY, all sites and one", async () => {
  for (const [qs, period, siteIds] of [
    ["year=2025", "2025", ""],
    ["year=2024", "2024", ""],
    ["year=2025&sites=1", "2025", "1"],
    ["year=2025&sites=2", "2025", "2"],
    ["year=2026&yearType=FY", "FY2025-26", ""],
    ["year=2025&yearType=FY&sites=2", "FY2024-25", "2"],
  ]) {
    const ov = (await call("GET", `/manager/overview?period=${period}${siteIds ? `&siteIds=${siteIds}` : ""}`, "manager")).json;
    const s = await summary("manager", qs);
    assert.equal(s.data.net.value, ov.kpis.net, `${qs} net`);
    assert.equal(s.data.net.change_pct, ov.kpis.net_vs_last_year_pct, `${qs} change`);
    const prior = ov.last_year && ov.last_year.status !== "not_due" ? ov.last_year.kpis.net : null;
    assert.equal(s.data.net.prior, prior, `${qs} prior`);
    assert.equal(s.data.net.good, ov.kpis.net_vs_last_year_pct === null || ov.kpis.net_vs_last_year_pct === 0 ? null : ov.kpis.net_vs_last_year_pct < 0, `${qs} good`);
    assert.equal(s.pending_not_in.emissions, ov.kpis.pending_review_count, `${qs} pending`);
    assert.equal(s.pending_not_in.kpi_values, 0);
    assert.equal(s.pending_not_in.link, ov.kpis.pending_review_count ? "/data/approvals" : null);
    assert.equal(s.data.attention.items.find((i) => i.kind === "missing_submitters")?.count ?? 0, ov.submission.missing, `${qs} submitters`);
  }
});

test("pending rows are left out of net and counted in pending_not_in and attention", async () => {
  // 2025 on the fixture: approved rows 1, 3, 6, 14 (4.29 + 1 + 10 + 11 = 26.29 net); pending rows 2 and 5 (FERA twin folds into 2) → 1.
  const s = await summary("manager", "year=2025");
  const ov = (await call("GET", `/manager/overview?period=2025`, "manager")).json;
  assert.equal(ov.kpis.pending_review_count, s.pending_not_in.emissions);
  assert.ok(s.pending_not_in.emissions >= 1);
  const approvals = s.data.attention.items.find((i) => i.kind === "approvals");
  assert.ok(approvals && approvals.count >= s.pending_not_in.emissions);
  assert.equal(approvals.link, "/data/approvals");
  assert.equal(s.data.attention.total, s.data.attention.items.reduce((a, i) => a + i.count, 0));
});

test("intensity equals the emission-intensity comparison, combined over sites; null without production", async () => {
  // 2018 on site 2: 300 t approved over 1,000 t steel → 0.3; 2017: 400 t over 1,000 t → 0.4.
  own.products = (await q(`INSERT INTO product (name, unit, site_id) VALUES ('IN-1 bar', 't', 2) RETURNING product_id`)).map((r) => r.product_id);
  own.production = (
    await q(
      `INSERT INTO production_data (product_id, site_id, quantity, unit, start_date, end_date, status, created_by) VALUES
         ($1, 2, 1000, 't', '2018-01-01', '2018-12-31', 'approved', 7),
         ($1, 2, 1000, 't', '2017-01-01', '2017-12-31', 'approved', 7),
         ($1, 2, 50, 't', '2018-06-01', '2018-06-30', 'pending', 7)
       RETURNING production_id`,
      [own.products[0]],
    )
  ).map((r) => r.production_id);
  own.emissions.push(
    ...(
      await q(
        `INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES
           ('{}', 200, 'tCO2e', '2018-05-31', 'approved', 7, 1, 2, 'monthly'),
           ('{}', 100, 'tCO2e', '2018-06-30', 'approved', 7, 2, 2, 'monthly'),
           ('{}', 400, 'tCO2e', '2017-06-30', 'approved', 7, 1, 2, 'monthly')
         RETURNING pk_id`,
      )
    ).map((r) => r.pk_id),
  );
  const s = await summary("manager", "year=2018&sites=2");
  const cmp = (await call("GET", `/user/emission-intensity/comparison?siteIds=2&startDate=2018-01-01&endDate=2018-12-31`, "manager")).json.comparison[0];
  close(s.data.intensity.value, cmp.totalEmissions / cmp.totalProduction, "intensity");
  close(s.data.intensity.value, 0.3, "by hand");
  assert.equal(s.data.intensity.unit, "t");
  assert.equal(s.data.intensity.combined, false);
  close(s.data.intensity.change_pct, -25, "0.4 → 0.3");
  assert.equal(s.data.intensity.good, true);
  // The pending production row is an approval waiting.
  assert.equal(s.data.attention.items.find((i) => i.kind === "approvals").count, 1);
  const none = await summary("manager", "year=2016&sites=2");
  assert.equal(none.data.intensity.value, null);
  assert.equal(none.data.intensity.change_pct, null);
  assert.equal(none.data.net.value, 0);
  assert.equal(none.data.renewable_share_pct, null);
});

test("pathway: null without a base year; with one, the period year's actual vs the Targets pathway (I6)", async () => {
  assert.equal((await summary("manager", "year=2018&sites=2")).data.pathway, null);
  await q(`INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (1, 'Scope 3', 2017, 'CY')`);
  // Near-term: target 2027 (2030 is > 10 years from 2017), 4.2 %/yr from 400 t: 2018 pathway 383.2 t; actual 300 t → on track.
  const s = await summary("manager", "year=2018&sites=2");
  const t = (await call("POST", "/user/targets/tables", "manager", { siteIds: [2], baseYear: 2017, targetYear: 2027, annualRate: 0.042 })).json;
  const row = t.tables.table3.find((r) => r.year === 2018);
  assert.equal(s.data.pathway.target_year, 2027);
  assert.equal(s.data.pathway.status, "on_track");
  close(s.data.pathway.gap_pct, ((row.actualTotal - row.targetTotal) / row.targetTotal) * 100, "gap");
  close(row.targetTotal, 383.2, "pathway by hand");
  // A year past the data: no actual → no_data.
  assert.equal((await summary("manager", "year=2019&sites=2")).data.pathway.status, "no_data");
  // Off track: +10 % above the 2018 pathway.
  const extra = (await q(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES ('{}', 121.52, 'tCO2e', '2018-07-31', 'approved', 7, 1, 2, 'monthly') RETURNING pk_id`))[0].pk_id;
  own.emissions.push(extra);
  const off = await summary("manager", "year=2018&sites=2");
  close(off.data.pathway.gap_pct, ((421.52 - 383.2) / 383.2) * 100, "off gap");
  assert.equal(off.data.pathway.status, "off_track");
  const offItem = off.data.attention.items.find((i) => i.kind === "off_track");
  assert.equal(offItem.count, 1);
  assert.equal(offItem.link, "/targets");
  await q(`DELETE FROM emission WHERE pk_id = $1`, [extra]);
  own.emissions = own.emissions.filter((id) => id !== extra);
  // at_risk: +3 % above.
  const near = (await q(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES ('{}', 94.696, 'tCO2e', '2018-07-31', 'approved', 7, 1, 2, 'monthly') RETURNING pk_id`))[0].pk_id;
  own.emissions.push(near);
  assert.equal((await summary("manager", "year=2018&sites=2")).data.pathway.status, "at_risk");
  await q(`DELETE FROM emission WHERE pk_id = $1`, [near]);
  own.emissions = own.emissions.filter((id) => id !== near);
  await q(`DELETE FROM company_base_year WHERE company_id = 1`);
});

test("roles: Users get IN_FORBIDDEN, Admin and Superadmin see the company, a Manager their sites", async () => {
  for (const who of ["user", "multiSiteUser"]) {
    const r = await call("GET", "/insights/summary?year=2025", who);
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "IN_FORBIDDEN");
  }
  const admin = await summary("admin");
  const sa = await summary("superadmin", "year=2025", { companyId: 1 });
  const mgr = await summary("manager");
  assert.equal(admin.data.net.value, mgr.data.net.value); // the manager reaches both company 1 sites
  assert.equal(sa.data.net.value, admin.data.net.value);
  assert.equal((await call("GET", "/insights/summary?year=2025", "superadmin")).json.code, "IN_COMPANY_REQUIRED");
});

test("site scope and tenant isolation: another company's site or id is 404; a bad query is 400", async () => {
  for (const [who, qs] of [["manager", "sites=3"], ["admin", "sites=1,3"], ["otherManager", "sites=1"], ["manager", "sites=999"]]) {
    const r = await call("GET", `/insights/summary?year=2025&${qs}`, who);
    assert.equal(r.status, 404, `${who} ${qs}`);
    assert.equal(r.json.code, "IN_SITE_NOT_FOUND");
  }
  for (const [who, url] of [["admin", "/insights/summary?company_id=2"], ["otherManager", "/insights/summary?company_id=1"]]) {
    const r = await call("GET", url, who);
    assert.equal(r.status, 404, url);
  }
  for (const qs of ["sites=abc", "year=1800", "yearType=QY", "compare=sideways"]) {
    const r = await call("GET", `/insights/summary?${qs}`, "manager");
    assert.equal(r.status, 400, qs);
    assert.equal(r.json.code, "IN_VALIDATION");
  }
  // Company 2 sees its own 999 t (fixture row 8), never company 1's figures.
  const other = await summary("otherManager", "year=2025");
  const ov2 = (await call("GET", "/manager/overview?period=2025", "otherManager")).json;
  assert.equal(other.data.net.value, ov2.kpis.net);
  assert.equal(other.data.net.value, 999);
  const sa2 = await summary("superadmin", "year=2025", { companyId: 2 });
  assert.equal(sa2.data.net.value, 999);
});

test("switch off: IN_OFF on the summary for every role", async () => {
  await setInsights(1, false);
  try {
    for (const who of ["manager", "admin", "user"]) {
      const r = await call("GET", "/insights/summary?year=2025", who);
      assert.equal(r.status, 403, who);
      assert.equal(r.json.code, "IN_OFF");
    }
    assert.equal((await call("GET", "/insights/summary?year=2025&company_id=1", "superadmin")).json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});

test("ETag: the same data answers 304; an approval changes the stamp and the figures (cache busts)", async () => {
  const first = await panel("manager", "/summary?year=2018&sites=2");
  const etag = first.headers.get("etag");
  assert.equal(etag, `"in-${first.json.stamp}"`);
  const again = await call("GET", "/insights/summary?year=2018&sites=2", "manager", undefined, { "If-None-Match": etag });
  assert.equal(again.status, 304);
  const pend = (await q(`INSERT INTO emission (activity_data, total_emission, unit, date_of_reporting, status, created_by, category_id, site_id, reporting_period) VALUES ('{}', 40, 'tCO2e', '2018-09-30', 'pending', 7, 1, 2, 'monthly') RETURNING pk_id`))[0].pk_id;
  own.emissions.push(pend);
  const withPending = await panel("manager", "/summary?year=2018&sites=2", { headers: { "If-None-Match": etag } });
  assert.notEqual(withPending.json.stamp, first.json.stamp);
  assert.equal(withPending.json.data.net.value, first.json.data.net.value);
  assert.equal(withPending.json.pending_not_in.emissions, first.json.pending_not_in.emissions + 1);
  // The Manager approves it through the API (as the approvals list does).
  const ok = await call("PUT", `/user/emissions/${pend}/approve`, "manager", {});
  if (ok.status !== 200) await q(`UPDATE emission SET status = 'approved', updated_at = now() WHERE pk_id = $1`, [pend]);
  const after = await panel("manager", "/summary?year=2018&sites=2");
  assert.notEqual(after.json.stamp, withPending.json.stamp);
  close(after.json.data.net.value, first.json.data.net.value + 40, "net after approval");
  assert.equal(after.json.pending_not_in.emissions, first.json.pending_not_in.emissions);
});

test("KPI tracking off: readiness null (still 200); on and set up: readiness equals /kpi/esg coverage", async () => {
  const off = await summary("admin", "year=2025");
  assert.equal(off.data.readiness, null);
  assert.equal(off.pending_not_in.kpi_values, 0);
  ensureKpiLibrary();
  await setKpi(1, true);
  // Not set up yet: still null.
  assert.equal((await summary("admin", "year=2025")).data.readiness, null);
  const codes = ["WATER_WITHDRAWAL", "WASTE_GENERATED", "EMPLOYEES_TOTAL", "WOMEN_ON_BOARD"];
  await setupCompany(1, { frameworks: ["GRI"], kpis: codes, frequencies: Object.fromEntries(codes.map((c) => [c, "annual"])), topicOwners: false });
  const ids = await kpiIds(codes);
  await kpiValue(1, ids.WATER_WITHDRAWAL, 1, 2025, 1000);
  await kpiValue(1, ids.WATER_WITHDRAWAL, 2, 2025, 400, "pending");
  await kpiValue(1, ids.EMPLOYEES_TOTAL, 1, 2025, 120);
  const s = await summary("admin", "year=2025");
  const e = (await call("GET", "/kpi/esg?year=2025", "admin")).json;
  for (const p of e.pillars) {
    const c = p.approved + p.pending + p.missing;
    if (c === 0) assert.equal(s.data.readiness.by_pillar[p.pillar], null, p.pillar);
    else close(s.data.readiness.by_pillar[p.pillar], (p.approved / c) * 100, p.pillar);
    if (p.coverage_pct !== null) assert.equal(Math.round(s.data.readiness.by_pillar[p.pillar]), p.coverage_pct, `${p.pillar} rounds to /kpi/esg`);
  }
  const all = e.pillars.reduce((a, p) => [a[0] + p.approved, a[1] + p.approved + p.pending + p.missing], [0, 0]);
  close(s.data.readiness.pct, (all[0] / all[1]) * 100, "overall");
  assert.equal(s.pending_not_in.kpi_values, e.pending_not_in.count);
  assert.ok(s.pending_not_in.kpi_values >= 1);
  const gaps = (await call("GET", "/kpi/dashboard?year=2025", "admin")).json.gaps.length;
  assert.equal(s.data.attention.items.find((i) => i.kind === "kpi_gaps")?.count ?? 0, gaps);
  await wipeKpi();
  await setKpi(1, false);
});
