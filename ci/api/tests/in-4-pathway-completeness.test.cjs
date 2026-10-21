// IN-4 · GET /insights/pathway and /insights/completeness on the API fixture
// (company 1): pathway no_data without a base year or base-year data, the
// pathway and actuals equal POST /user/targets/tables, events in range;
// completeness from the site's categories (monthly rows and the FY yearly
// batch covering months), future months null, the KPI part only with KPI
// tracking on (a quarterly KPI in the quarter's last month); roles, site
// scope, tenant isolation, switch-off.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call } = require("../helpers.cjs");
const { setInsights, setKpi, q, ensureKpiLibrary, kpiIds, wipeKpi, panel, assertEnvelope } = require("./in-lib.cjs");
const { setupCompany } = require("./kpi-lib.cjs");

const reset = async () => {
  await q(`DELETE FROM company_base_year WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM insight_event WHERE company_id IN (1, 2)`);
  await wipeKpi();
  for (const id of [1, 2]) {
    await setInsights(id, false);
    await setKpi(id, false);
  }
};
test.before(async () => {
  await reset();
  await setInsights(1, true);
  await setInsights(2, true);
});
test.after(reset);

test("pathway: no_data with a reason without a base year, or without approved emissions in it", async () => {
  const none = (await panel("manager", "/pathway?year=2025")).json;
  assertEnvelope(assert, none, "pathway");
  assert.equal(none.availability, "no_data");
  assert.equal(none.data, null);
  assert.match(none.reason, /base year in Targets/);
  await q(`INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (1, 'Scope 3', 2012, 'CY')`);
  const empty = (await panel("manager", "/pathway?year=2025")).json;
  assert.equal(empty.availability, "no_data");
  assert.match(empty.reason, /2012/);
  await q(`DELETE FROM company_base_year WHERE company_id = 1`);
});

test("pathway: the pathway and actuals equal POST /user/targets/tables for the base year; events in range", async () => {
  await q(`INSERT INTO company_base_year (company_id, scope, base_year, year_type) VALUES (1, 'Scope 3', 2024, 'CY')`);
  await q(`INSERT INTO insight_event (company_id, site_id, date, label, kind, created_by) VALUES (1, NULL, '2025-02-01', 'In range', 'initiative', 3), (1, 1, '2019-02-01', 'Before the base year', 'other', 3), (2, NULL, '2025-03-01', 'Other company', 'other', 6)`);
  const r = (await panel("manager", "/pathway?year=2025")).json;
  assert.equal(r.availability, "ok", JSON.stringify(r));
  const t = (await call("POST", "/user/targets/tables", "manager", { siteIds: [1, 2], baseYear: 2024, targetYear: 2030, annualRate: 0.042 })).json;
  assert.equal(r.data.base_year, 2024);
  assert.equal(r.data.target_year, 2030);
  assert.equal(r.data.annual_rate_pct, 4.2);
  assert.deepEqual(r.data.years, t.tables.table1.map((x) => x.year));
  assert.deepEqual(r.data.pathway, t.tables.table1.map((x) => x.targetEmission));
  // 2024 base year: S1 50 (row 9) and S2 80 (the CY yearly batch, row 13) → 130 t.
  assert.equal(r.data.pathway[0], 130);
  for (const row of t.tables.table3) {
    const i = r.data.years.indexOf(row.year);
    if (row.status === "No Data") {
      assert.equal(r.data.actual.s1[i], null, `${row.year} no data`);
      continue;
    }
    assert.equal(r.data.actual.s1[i], row.actualScope1);
    assert.equal(r.data.actual.s2[i], row.actualScope2);
  }
  assert.ok(r.data.actual.s3.every((v) => v === null), "Scope 3 is outside the boundary (< 40 %)");
  for (const g of r.data.gap_band) {
    const row = t.tables.table3.find((x) => x.year === g.year);
    assert.equal(g.gap, Math.max(0, row.actualTotal - row.targetTotal));
  }
  assert.deepEqual(r.data.events.map((e) => e.label), ["In range"]);
  assert.equal(r.data.levers[0].key, "renewable_share");
  assert.equal(r.data.levers[0].values.length, r.data.years.length);
  assert.equal(r.links.targets, "/targets?baseYear=2024&targetYear=2030");
  await q(`DELETE FROM company_base_year WHERE company_id = 1`);
  await q(`DELETE FROM insight_event WHERE company_id IN (1, 2)`);
});

const cell = (body, site, month) => body.data.rows.find((r) => r.site_id === site).cells.find((c) => c.month === month);

test("completeness: the site's categories each month; monthly rows and a yearly batch covering the month count", async () => {
  const r = (await panel("admin", "/completeness?year=2025")).json;
  assertEnvelope(assert, r, "completeness");
  assert.equal(r.data.months.length, 12);
  assert.deepEqual(r.data.rows.map((x) => x.site_id), [1, 2]);
  // Site 1 files categories 1–4 (FERA left out). Sep 2025: rows 1 (cat 1) and 3 (cat 3) approved; row 2 pending.
  const sep = cell(r, 1, "2025-09");
  assert.deepEqual({ ...sep, link: undefined }, { month: "2025-09", pct: 50, emissions_expected: 4, emissions_approved: 2, kpi_expected: 0, kpi_approved: 0, link: undefined });
  assert.equal(sep.link, "/overview?period=2025-09&siteIds=1");
  assert.equal(cell(r, 1, "2025-02").pct, 25); // row 14
  assert.equal(cell(r, 1, "2025-10").pct, 0);
  // Site 2 files 1 and 2; the FY batch ending Mar 2026 (row 7, category 2) covers Apr 2025 – Mar 2026.
  assert.equal(cell(r, 2, "2025-03").pct, 0);
  assert.equal(cell(r, 2, "2025-04").pct, 50);
  assert.equal(cell(r, 2, "2025-08").pct, 100); // + row 6 (category 1)
  // FY 2026 reads Apr 2025 – Mar 2026.
  const fy = (await panel("admin", "/completeness?year=2026&yearType=FY")).json;
  assert.equal(fy.data.months[0], "2025-04");
  assert.equal(cell(fy, 2, "2026-03").pct, 50);
});

test("completeness: months that haven't started are null, never 0; sites filter and tenant", async () => {
  const today = new Date().toISOString().slice(0, 7);
  const y = Number(today.slice(0, 4));
  const r = (await panel("admin", `/completeness?year=${y + 1}`)).json;
  assert.ok(r.data.rows.every((row) => row.cells.every((c) => c.pct === null)));
  const one = (await panel("manager", "/completeness?year=2025&sites=2")).json;
  assert.deepEqual(one.data.rows.map((x) => x.site_id), [2]);
  assert.equal((await call("GET", "/insights/completeness?year=2025&sites=3", "manager")).status, 404);
  const other = (await panel("otherManager", "/completeness?year=2025")).json;
  assert.deepEqual(other.data.rows.map((x) => x.site_id), [3]);
});

test("completeness with KPI tracking on: a quarterly KPI is expected in the quarter's last month on its sites", async () => {
  ensureKpiLibrary();
  await setKpi(1, true);
  await setupCompany(1, { frameworks: ["GRI"], kpis: ["WATER_WITHDRAWAL"], frequencies: { WATER_WITHDRAWAL: "quarterly" } });
  const ids = await kpiIds(["WATER_WITHDRAWAL"]);
  await q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
     VALUES (1, 1, $1, '2025-01-01', '2025-03-31', 'quarterly', 'CY', 10, NULL, 10, 'manual', 'approved'),
            (1, 2, $1, '2025-01-01', '2025-03-31', 'quarterly', 'CY', 10, NULL, 10, 'manual', 'pending')`,
    [ids.WATER_WITHDRAWAL],
  );
  const r = (await panel("admin", "/completeness?year=2025")).json;
  const mar1 = cell(r, 1, "2025-03");
  assert.equal(mar1.kpi_expected, 1);
  assert.equal(mar1.kpi_approved, 1);
  assert.equal(mar1.pct, 20); // 0 of 4 categories + 1 of 1 KPI
  const mar2 = cell(r, 2, "2025-03");
  assert.equal(mar2.kpi_expected, 1);
  assert.equal(mar2.kpi_approved, 0); // pending doesn't count
  assert.equal(cell(r, 1, "2025-02").kpi_expected, 0);
  assert.equal(cell(r, 1, "2025-06").kpi_expected, 1);
  assert.equal(cell(r, 1, "2025-12").kpi_expected, 1);
  // KPI off again: emissions only.
  await setKpi(1, false);
  const off = (await panel("admin", "/completeness?year=2025")).json;
  assert.equal(cell(off, 1, "2025-03").kpi_expected, 0);
  assert.equal(cell(off, 1, "2025-03").pct, 0);
  await wipeKpi();
});

test("roles, scope and switch-off on pathway and completeness", async () => {
  for (const p of ["/insights/pathway", "/insights/completeness"]) {
    assert.equal((await call("GET", p, "user")).json.code, "IN_FORBIDDEN");
    assert.equal((await call("GET", `${p}?sites=3`, "admin")).json.code, "IN_SITE_NOT_FOUND");
    assert.equal((await call("GET", `${p}?company_id=2`, "admin")).status, 404);
    assert.equal((await call("GET", `${p}?company_id=1`, "superadmin")).status, 200);
  }
  await setInsights(1, false);
  try {
    for (const p of ["/insights/pathway", "/insights/completeness"]) assert.equal((await call("GET", p, "manager")).json.code, "IN_OFF");
  } finally {
    await setInsights(1, true);
  }
});
