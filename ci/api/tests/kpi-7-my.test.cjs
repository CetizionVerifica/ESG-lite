// KPI-7 backend part: GET /kpi/my?period=YYYY-MM&site= lists only what the
// caller owes — since D17 the pairs they own through the resolver (a per-KPI
// assignment, else the topic owner of the site; kpi-lib gives site 1 to user 1,
// site 2 to user 7 and the company level to the Admin) — for the periods ending in
// that month, with status groups, the value, last year's value, due dates,
// framework badges, reviewer, and read-only auto/formula items (with a
// formula's inputs). Plus the site filter, setup-first, role and tenant
// checks and the switch.
//
// Fixture: company 1 (sites 1 "CI Plant A", 2; user 1 on site 1, manager 2 on 1+2, admin 3, multi user 7 on 1+2), company 2.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, setTopicOwners, TOPICS } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_value', 'kpi_setup')`);
  await clearSetup();
};
const kpiId = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI", "BRSR"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
  const water = await kpiId("WATER_WITHDRAWAL");
  await q(`INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id, reviewer_user_id) VALUES (1, $1, 1, 7, 2), (1, $1, 2, 2, NULL)`, [water]);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const my = async (who, query = "?period=2026-09") => {
  const r = await call("GET", `/kpi/my${query}`, who);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};
const find = (res, code, site) => res.items.find((i) => i.code === code && i.site_id === site);

test("a User owes the topics they own on their site; a pair assigned to someone else isn't theirs; auto items are read-only", async () => {
  const r = await my("user");
  assert.equal(r.period, "2026-09");
  assert.ok(r.items.every((i) => i.site_id === 1), "site 1 only");
  assert.ok(!find(r, "WATER_WITHDRAWAL", 1), "assigned to user 7");
  const lti = find(r, "LOST_TIME_INJURIES", 1);
  assert.ok(lti, "a monthly KPI of September");
  assert.deepEqual(
    [lti.group, lti.status, lti.value, lti.period_start, lti.period_end, lti.period_label, lti.frequency, lti.year_type, lti.due_date, lti.site_name, lti.assigned, lti.assigned_via, lti.topic, lti.topic_label],
    ["due", "missing", null, "2026-09-01", "2026-09-30", "Sep 2026", "monthly", "CY", "2026-10-15", "CI Plant A", true, "topic", "health_safety", "Health and safety"],
  );
  assert.ok(Array.isArray(lti.used_in));
  assert.ok(!find(r, "WASTE_GENERATED", 1), "an annual KPI ends in December");
  const energy = find(r, "ENERGY_TOTAL", 1);
  assert.deepEqual([energy.group, energy.source, energy.auto_source], ["auto", "auto", "energy_total"]);
  assert.ok(!r.items.some((i) => i.site_id === null), "no company-level items for a User");
  assert.equal(r.counts.total, r.items.length);
  assert.equal(r.counts.auto, r.items.filter((i) => i.group === "auto").length);
  assert.equal(r.counts.due + r.counts.sent_back + r.counts.done + r.counts.auto, r.counts.total);
  // BRSR Core needs evidence; the badges show where a KPI is used.
  const dec = await my("user", "?period=2026-12");
  const waste = find(dec, "WASTE_GENERATED", 1);
  assert.equal(waste.needs_evidence, true);
  assert.ok(waste.used_in.some((b) => b.framework === "BRSR" && b.core === true));
  assert.ok(waste.used_in.some((b) => b.framework === "GRI"));
});

test("assigned owners see their pairs with the reviewer; Managers only what's assigned to them; Admins company-level KPIs", async () => {
  const u7 = await my("multiSiteUser");
  const w = find(u7, "WATER_WITHDRAWAL", 1);
  assert.deepEqual([w.assigned, w.reviewer_user_id, w.reviewer_name], [true, 2, "CI Manager"]);
  assert.ok(!find(u7, "WATER_WITHDRAWAL", 2), "site 2's water is the manager's");
  assert.ok(find(u7, "LOST_TIME_INJURIES", 2), "unassigned on site 2");
  const mgr = await my("manager");
  assert.deepEqual([...new Set(mgr.items.filter((i) => i.group !== "auto").map((i) => `${i.code}@${i.site_id}`))], ["WATER_WITHDRAWAL@2"]);
  const admin = await my("admin", "?period=2026-12");
  assert.ok(find(admin, "REVENUE", null), "company-level, annual, ends in December");
  assert.ok(admin.items.filter((i) => i.group !== "auto").every((i) => i.site_id === null));
  assert.ok(find(admin, "GHG_INTENSITY_REVENUE", null)?.group === "auto");
  assert.deepEqual((await my("superadmin", "?period=2026-09&company_id=1")).items, [], "a Superadmin owes nothing");
});

test("statuses group the items; last year's value; a sent-back value carries the reviewer's comment", async () => {
  const r = await call("PUT", "/kpi/values", "user", { items: [{ kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-09-01", value_numeric: 2 }] });
  const id = r.json.results[0].value.id;
  let lti = find(await my("user"), "LOST_TIME_INJURIES", 1);
  assert.deepEqual([lti.group, lti.status, lti.value.id, lti.value.value_numeric], ["due", "draft", id, 2]);
  assert.equal(find(await my("multiSiteUser"), "LOST_TIME_INJURIES", 1), undefined, "D17: site 1's safety isn't user 7's (drafts of others are hidden: kpi-4)");
  await call("POST", "/kpi/values/submit", "user", { ids: [id] });
  assert.deepEqual([find(await my("user"), "LOST_TIME_INJURIES", 1).group, find(await my("user"), "LOST_TIME_INJURIES", 1).status], ["done", "pending"]);
  assert.deepEqual((await call("PUT", "/kpi/values/reject", "manager", { ids: [id], reason: "Check the logbook" })).json, { updated: [id], refused: [] });
  lti = find(await my("user"), "LOST_TIME_INJURIES", 1);
  assert.deepEqual([lti.group, lti.value.review_comment], ["sent_back", "Check the logbook"]);
  // Last September, approved.
  const ltiId = await kpiId("LOST_TIME_INJURIES");
  await q(`INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status) VALUES (1, 1, $1, '2025-09-01', '2025-09-30', 'monthly', 'CY', 5, 'count', 5, 'manual', 'approved')`, [ltiId]);
  assert.deepEqual(find(await my("user"), "LOST_TIME_INJURIES", 1).last_value, { value: 5, unit: "count", value_canonical: 5, period_start: "2025-09-01", status: "approved" });
});

test("a formula item shows its value and inputs once both are submitted", async () => {
  const w = await call("PUT", "/kpi/values", "multiSiteUser", { items: [{ kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-09-01", value_numeric: 1200 }] });
  const d = await call("PUT", "/kpi/values", "user", { items: [{ kpi_code: "WATER_DISCHARGE", site_id: 1, period_start: "2026-09-01", value_numeric: 840 }] });
  // Water withdrawn is BRSR Core here: evidence first.
  await call("POST", `/kpi/values/${w.json.results[0].value.id}/evidence`, "multiSiteUser", { document_url: "https://files.example.invalid/m.pdf", document_name: "m.pdf" });
  await call("POST", `/kpi/values/${d.json.results[0].value.id}/evidence`, "user", { document_url: "https://files.example.invalid/d.pdf", document_name: "d.pdf" });
  assert.deepEqual((await call("POST", "/kpi/values/submit", "multiSiteUser", { ids: [w.json.results[0].value.id] })).json.refused, []);
  assert.deepEqual((await call("POST", "/kpi/values/submit", "user", { ids: [d.json.results[0].value.id] })).json.refused, []);
  const c = find(await my("user"), "WATER_CONSUMPTION", 1);
  assert.deepEqual([c.group, c.source, c.formula, c.value.value_canonical, c.value.status], ["auto", "formula", "WATER_WITHDRAWAL - WATER_DISCHARGE", 360, "pending"]);
  assert.deepEqual(c.inputs.map((i) => [i.code, i.name, i.value, i.status]), [["WATER_WITHDRAWAL", "Water withdrawn", 1200, "pending"], ["WATER_DISCHARGE", "Water discharged", 840, "pending"]]);
});

test("D17: a User owning only water on their site sees only water items; items come in topic order", async () => {
  await setTopicOwners(1, { 1: 7 }, TOPICS.filter((t) => t !== "water"));
  try {
    const r = await my("user");
    assert.ok(r.items.filter((i) => i.group !== "auto").length > 0);
    assert.ok(r.items.filter((i) => i.group !== "auto").every((i) => i.topic === "water"), JSON.stringify(r.items.map((i) => i.code)));
    assert.ok(find(r, "WATER_DISCHARGE", 1));
    const order = (await my("multiSiteUser")).items.map((i) => TOPICS.indexOf(i.topic));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "sorted by KPI_TOPICS order");
  } finally {
    await setTopicOwners(1, { 1: 1 });
  }
});

test("site filter, bad queries, setup first, tenant isolation, the default month", async () => {
  const s2 = await my("multiSiteUser", "?period=2026-09&site=2");
  assert.ok(s2.items.length && s2.items.every((i) => i.site_id === 2));
  assert.equal((await call("GET", "/kpi/my?period=2026-09&site=3", "multiSiteUser")).status, 404, "another company's site");
  assert.equal((await call("GET", "/kpi/my?period=2026-09&site=2", "user")).status, 404, "not the caller's site");
  assert.equal((await call("GET", "/kpi/my?period=2026-13", "user")).json.code, "KPI_VALIDATION");
  assert.equal((await call("GET", "/kpi/my?period=Sep", "user")).status, 400);
  const notSetUp = await call("GET", "/kpi/my", "otherUser");
  assert.equal(notSetUp.status, 409);
  assert.equal(notSetUp.json.code, "KPI_SETUP_INCOMPLETE");
  assert.equal((await call("GET", "/kpi/my?company_id=1", "otherUser")).status, 404);
  const d = new Date();
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() - 1;
  assert.equal((await my("user", "")).period, `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`);
  // FY companies: Q4 FY2027 ends in March 2027.
  await q(`UPDATE company_kpi_settings SET year_type = 'FY' WHERE company_id = 1`);
  try {
    const fy = await my("user", "?period=2027-03");
    assert.ok(fy.items.every((i) => i.year_type === "FY"));
    assert.equal(find(fy, "WASTE_GENERATED", 1).period_label, "FY2026-27");
  } finally {
    await q(`UPDATE company_kpi_settings SET year_type = 'CY' WHERE company_id = 1`);
  }
});

test("switch off: KPI_TRACKING_OFF", async () => {
  await setSwitch(1, false);
  try {
    for (const who of ["user", "manager", "admin"]) {
      const r = await call("GET", "/kpi/my?period=2026-09", who);
      assert.equal(r.status, 403);
      assert.equal(r.json.code, "KPI_TRACKING_OFF");
    }
  } finally {
    await setSwitch(1, true);
  }
});
