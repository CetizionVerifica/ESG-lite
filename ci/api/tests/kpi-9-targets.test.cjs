// KPI-9 targets: PUT/GET/DELETE /kpi/targets — validation (baseline from the
// approved figure or typed with a note, years, direction, KPI and site),
// progress from approved annual figures (worked by hand), the audit trail,
// the role matrix (Admins write, everyone reads; site targets only on your
// sites), tenant isolation and the switch.
//
// Approved values are written straight to the database here: the review path
// is KPI-8's and tested there.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, kpiRoutes, concrete } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wipe = async () => {
  await q(`DELETE FROM kpi_target WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_target', 'kpi_value', 'kpi_setup')`);
  await q(`DELETE FROM company_kpi WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE code LIKE 'C1_T9_%' OR code LIKE 'C2_T9_%')`);
  await q(`DELETE FROM kpi_definition WHERE code LIKE 'C1_T9_%' OR code LIKE 'C2_T9_%'`);
  await clearSetup();
};
const kpiId = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
const ids = {};

/** Approved monthly water values: `perMonth` for each month of `year` on `site`. */
const water = async (site, year, perMonth) => {
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${String(m).padStart(2, "0")}-01`;
    await q(
      `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
       VALUES (1, $1, $2, $3, ($3::date + interval '1 month' - interval '1 day')::date, 'monthly', 'CY', $4, 'kL', $4, 'manual', 'approved')`,
      [site, ids.water, start, perMonth],
    );
  }
};
const put = (who, body) => call("PUT", "/kpi/targets", who, body);
const base = () => ({ kpi_definition_id: ids.water, site_id: null, baseline_year: 2024, baseline_value: 1800, target_year: 2030, target_value: 1440, direction: "reduce" });

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTargets"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI"], kpis: ["WATER_WITHDRAWAL", "REVENUE", "EMPLOYEE_TURNOVER_RATE"] });
  await setupCompany(2, { frameworks: ["GRI"], kpis: ["WATER_WITHDRAWAL"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
  ids.water = await kpiId("WATER_WITHDRAWAL");
  ids.revenue = await kpiId("REVENUE");
  ids.turnover = await kpiId("EMPLOYEE_TURNOVER_RATE");
  ids.discharge = await kpiId("WATER_DISCHARGE");
  const [text] = await q(
    `INSERT INTO kpi_definition (code, name, question, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level, default_frequency, source, company_id, active, decimals)
     VALUES ('C1_T9_POLICY', 'Water policy', 'Describe your water policy', 'water', 'text', 'none', NULL, '[]', 'latest', 'company', 'annual', 'manual', 1, true, 0) RETURNING id`,
  );
  ids.text = text.id;
  await q(`INSERT INTO company_kpi (company_id, kpi_definition_id, selected) VALUES (1, $1, true)`, [ids.text]);
  const [other] = await q(
    `INSERT INTO kpi_definition (code, name, question, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level, default_frequency, source, company_id, active, decimals)
     VALUES ('C2_T9_OWN', 'Company 2 KPI', 'q', 'water', 'number', 'volume', 'kL', '["kL"]', 'sum', 'site', 'annual', 'manual', 2, true, 0) RETURNING id`,
  );
  ids.otherCompanyKpi = other.id;
  // 2024: site 1 100/month, site 2 50/month = 1,800 kL. 2025: 90 and 45 = 1,620 kL.
  await water(1, 2024, 100);
  await water(2, 2024, 50);
  await water(1, 2025, 90);
  await water(2, 2025, 45);
  // A pending 2025 value never counts.
  await q(`UPDATE kpi_value SET status = 'pending' WHERE company_id = 1 AND site_id = 2 AND period_start = '2025-12-01'`);
  await q(`INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status) VALUES (1, 2, $1, '2025-12-01', '2025-12-31', 'quarterly', 'CY', 45, 'kL', 45, 'manual', 'approved')`, [ids.water]);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

test("an Admin sets a company target from the approved baseline; progress is worked from approved annual figures", async () => {
  const r = await put("admin", base());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = r.json.target;
  ids.companyTarget = t.id;
  assert.deepEqual(
    [t.kpi_code, t.unit, t.site_id, t.baseline_value, t.target_value, t.direction, t.note, t.created_by],
    ["WATER_WITHDRAWAL", "kL", null, 1800, 1440, "reduce", null, 3],
  );
  // 2025: 1,080 + 495 approved (site 2's December is pending; a quarterly row isn't at the company frequency) = 1,575.
  // Straight line: 1,800 − 360 × 1/6 = 1,740; 1,575 ≤ 1,740 → on track; (1,575 − 1,800) / −360 = 62.5 %.
  assert.deepEqual(
    [t.progress.current_year, t.progress.current_value, t.progress.progress_pct, t.progress.expected_value, t.progress.status, t.progress.achieved],
    [2025, 1575, 62.5, 1740, "on_track", false],
  );
  assert.deepEqual(t.series.slice(0, 3).map((p) => [p.year, p.value, p.complete]), [[2024, 1800, true], [2025, 1575, false], [2026, null, false]]);
  assert.equal(t.series.length, 7, "2024–2030");
  const [audit] = await q(`SELECT action, changed_by, changed_fields FROM audit_log WHERE entity_type = 'kpi_target' AND entity_id = $1`, [t.id]);
  assert.deepEqual([audit.action, audit.changed_by, audit.changed_fields.target_value], ["create", 3, { old: null, new: 1440 }]);
});

test("the baseline: equal to the approved figure, or typed with a note", async () => {
  const differs = await put("admin", { ...base(), baseline_value: 2000, target_value: 1500, target_year: 2029 });
  assert.deepEqual([differs.status, differs.json.code, differs.json.details], [422, "KPI_VALUE_INVALID", { field: "baseline_value", rule: "differs_from_the_approved_value", approved_value: 1800 }]);
  const noted = await put("admin", { ...base(), baseline_value: 2000, target_value: 1500, target_year: 2029, note: "Includes the 2024 leak estimate" });
  assert.equal(noted.status, 200, JSON.stringify(noted.json));
  assert.equal(noted.json.target.note, "Includes the 2024 leak estimate");
  const typed = await put("admin", { ...base(), baseline_year: 2020, baseline_value: 3000, target_value: 2000, target_year: 2028 });
  assert.deepEqual(typed.json.details, { field: "note", rule: "typed_baseline_needs_a_note" });
  assert.equal((await put("admin", { ...base(), baseline_year: 2020, baseline_value: 3000, target_value: 2000, target_year: 2028, note: "From the 2020 audit" })).status, 200);
});

test("validation: years, direction, KPI, site, one target per year", async () => {
  const rule = async (body) => {
    const r = await put("admin", body);
    return [r.status, r.json.code, r.json.details?.rule ?? r.json.details];
  };
  assert.deepEqual(await rule({ ...base(), target_year: 2024 }), [422, "KPI_VALUE_INVALID", "after_baseline_year"]);
  assert.deepEqual(await rule({ ...base(), target_value: 2000 }), [422, "KPI_VALUE_INVALID", "reduce_needs_a_lower_target"]);
  assert.deepEqual(await rule({ ...base(), direction: "increase" }), [422, "KPI_VALUE_INVALID", "increase_needs_a_higher_target"]);
  assert.deepEqual(await rule({ ...base(), direction: "maintain" }), [422, "KPI_VALUE_INVALID", "maintain_keeps_the_baseline"]);
  assert.deepEqual(await rule({ ...base() }), [422, "KPI_VALUE_INVALID", "one_target_per_year"]);
  assert.deepEqual((await rule({ ...base(), kpi_definition_id: ids.discharge }))[1], "KPI_NOT_SELECTED");
  assert.deepEqual((await rule({ ...base(), kpi_definition_id: ids.otherCompanyKpi }))[0], 404, "another company's KPI");
  assert.deepEqual(await rule({ ...base(), kpi_definition_id: ids.text, baseline_value: 1, target_value: 0, note: "x" }), [422, "KPI_VALUE_INVALID", "numbers_only"]);
  assert.deepEqual(await rule({ ...base(), kpi_definition_id: ids.revenue, site_id: 1, note: "x" }), [422, "KPI_VALUE_INVALID", "company_level_kpi"]);
  assert.deepEqual((await rule({ ...base(), site_id: 3, note: "x" }))[0], 404, "company 2's site");
  assert.equal((await put("admin", { ...base(), direction: "sideways" })).json.code, "KPI_VALIDATION");
  assert.equal((await put("admin", { ...base(), id: 999999 })).status, 404);
});

test("site targets; updates are audited; no data yet; who reads what", async () => {
  const s1 = await put("admin", { ...base(), site_id: 1, baseline_value: 1200, target_value: 900 });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  assert.deepEqual([s1.json.target.site_name, s1.json.target.progress.current_value, s1.json.target.progress.status], ["CI Plant A", 1080, "on_track"]);
  const s2 = await put("admin", { ...base(), site_id: 2, baseline_value: 600, target_value: 500, target_year: 2027 });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  ids.site2Target = s2.json.target.id;
  const turnover = await put("admin", { kpi_definition_id: ids.turnover, baseline_year: 2025, baseline_value: 12, target_year: 2028, target_value: 8, direction: "reduce", note: "HR report" });
  assert.equal(turnover.json.target.progress.status, "no_data");

  const up = await put("admin", { ...base(), id: s1.json.target.id, site_id: 1, baseline_value: 1200, target_value: 800 });
  assert.equal(up.json.target.target_value, 800);
  const audits = await q(`SELECT action, changed_fields FROM audit_log WHERE entity_type = 'kpi_target' AND entity_id = $1 ORDER BY id`, [s1.json.target.id]);
  assert.deepEqual(audits.map((a) => a.action), ["create", "update"]);
  assert.deepEqual(audits[1].changed_fields, { target_value: { old: 900, new: 800 } });

  const list = async (who, qs = "") => {
    const r = await call("GET", `/kpi/targets${qs}`, who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.targets;
  };
  const sites = (ts) => [...new Set(ts.map((t) => t.site_id))].sort();
  assert.deepEqual(sites(await list("user")), [1, null].sort(), "a User: company targets and their site's");
  assert.deepEqual(sites(await list("manager")), [1, 2, null].sort());
  assert.deepEqual(sites(await list("admin", "?site=company")), [null]);
  assert.deepEqual((await list("admin", `?kpi=${ids.turnover}`)).map((t) => t.kpi_code), ["EMPLOYEE_TURNOVER_RATE"]);
  assert.equal((await call("GET", "/kpi/targets?site=2", "user")).status, 404, "not the User's site");
  assert.deepEqual(await list("otherUser"), [], "company 2 has none");
  assert.equal((await call("GET", "/kpi/targets?company_id=1", "otherUser")).status, 404);
  assert.equal((await list("superadmin", "?company_id=1")).length >= 5, true);
});

test("who writes: Admins and the Superadmin; delete is audited; another company's target is 404", async () => {
  for (const who of ["user", "manager", "multiSiteUser"]) {
    assert.deepEqual([(await put(who, { ...base(), target_year: 2031 })).status, (await put(who, { ...base(), target_year: 2031 })).json.code], [403, "KPI_FORBIDDEN"], who);
    assert.equal((await call("DELETE", `/kpi/targets/${ids.site2Target}`, who)).status, 403);
  }
  assert.equal((await put("superadmin", { ...base(), target_year: 2031 })).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await put("superadmin", { ...base(), target_year: 2031, company_id: 1 })).status, 200);
  assert.equal((await call("DELETE", `/kpi/targets/${ids.site2Target}?company_id=2`, "superadmin")).status, 404, "not company 2's");
  assert.equal((await call("DELETE", "/kpi/targets/abc", "admin")).status, 404);
  const del = await call("DELETE", `/kpi/targets/${ids.site2Target}`, "admin");
  assert.deepEqual(del.json, { removed: ids.site2Target });
  assert.equal((await call("DELETE", `/kpi/targets/${ids.site2Target}`, "admin")).status, 404);
  const [audit] = await q(`SELECT changed_fields FROM audit_log WHERE entity_type = 'kpi_target' AND entity_id = $1 AND action = 'delete'`, [ids.site2Target]);
  assert.deepEqual(audit.changed_fields.target_value, { old: 500, new: null });
});

test("switch off: every KPI-9 route answers KPI_TRACKING_OFF", async () => {
  const routes = kpiRoutes().filter((r) => r.path.startsWith("/targets"));
  assert.equal(routes.length, 3);
  await setSwitch(1, false);
  try {
    for (const r of routes) {
      const res = await call(r.method, concrete(r.path), "admin", r.method === "GET" || r.method === "DELETE" ? undefined : {});
      assert.deepEqual([res.status, res.json?.code], [403, "KPI_TRACKING_OFF"], `${r.method} ${r.path}`);
    }
  } finally {
    await setSwitch(1, true);
  }
});
