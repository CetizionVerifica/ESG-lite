// KPI-4 value store: GET/PUT /kpi/values, POST /kpi/values/submit and the
// evidence endpoints. Every error code the store answers (KPI_NOT_FOUND,
// KPI_NOT_SELECTED, KPI_AUTO_READ_ONLY, KPI_NOT_ASSIGNED, KPI_VALUE_INVALID,
// KPI_UNIT_NOT_ALLOWED, KPI_PERIOD_LOCKED, KPI_NOT_DRAFT,
// KPI_EVIDENCE_REQUIRED, KPI_VALIDATION, KPI_TRACKING_OFF), drafts hidden from
// others, rejected → draft on edit, approved evidence rules, locks (CY and FY,
// reopened), company-level values, roles, tenant isolation, audit rows, and
// migrate:kpi-values running twice. KPI-3 wiring: setup must be finished
// (KPI_SETUP_INCOMPLETE), only selected KPIs take values, an item's frequency
// and year type are the company's, and BRSR Core evidence applies only to a
// company that reports BRSR.
//
// Fixture: company 1 (sites 1, 2; user 1 on site 1, manager 2 on 1+2, admin 3,
// multi user 7 on 1+2), company 2 (site 3; other user 4, other manager 6).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const wipe = () =>
  withDb(async (db) => {
    await db.query(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
    await db.query(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM kpi_period_lock WHERE company_id IN (1, 2)`);
    await db.query(`DELETE FROM audit_log WHERE entity_type = 'kpi_value'`);
    await db.query(`UPDATE kpi_definition SET active = true WHERE code = 'AIR_PM' AND company_id IS NULL`);
  });

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await clearSetup();
  await setupCompany(1, { frequencies: { WATER_DISCHARGE: "quarterly" } });
  await setupCompany(2, { frameworks: ["GRI"] });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await clearSetup();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const put = (who, items, query = "") => call("PUT", `/kpi/values${query}`, who, { items });
const water = (over = {}) => ({ kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-09-01", value_numeric: 1200, unit: "m3", ...over });
const one = async (who, item, query) => {
  const r = await put(who, [item], query);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.results[0];
};
const audits = (id) => withDb(async (db) => (await db.query(`SELECT action, changed_fields, changed_by FROM audit_log WHERE entity_type = 'kpi_value' AND entity_id = $1 ORDER BY id`, [id])).rows);

let draftId;

test("a contributor saves a draft on their site: converted, broken down, audited", async () => {
  const r = await one("user", water({ breakdown: { groundwater: 700, surface: 500 }, comment: "Meter read" }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = r.value;
  draftId = v.id;
  assert.equal(v.status, "draft");
  assert.equal(v.kpi_code, "WATER_WITHDRAWAL");
  assert.equal(v.period_start, "2026-09-01");
  assert.equal(v.period_end, "2026-09-30");
  assert.equal(v.frequency, "monthly");
  assert.equal(v.year_type, "CY");
  assert.equal(v.value_numeric, 1200);
  assert.equal(v.unit, "m3");
  assert.equal(v.value_canonical, 1200);
  assert.equal(v.canonical_unit, "kL");
  assert.deepEqual(v.breakdown, { groundwater: 700, surface: 500 });
  assert.equal(v.entered_by, 1);
  assert.deepEqual(v.evidence, []);

  // Saving again updates the same row (one value per site, KPI and period).
  const again = await one("user", water({ value_numeric: 1.3, unit: "ML" }));
  assert.equal(again.value.id, draftId);
  assert.equal(again.value.value_canonical, 1300);
  assert.equal(again.value.unit, "ML");
  assert.equal(again.value.breakdown, null);
  const rows = await audits(draftId);
  assert.deepEqual(rows.map((a) => a.action), ["create", "update"]);
  assert.equal(rows[1].changed_fields.value_canonical.old, 1200);
  assert.equal(rows[1].changed_fields.value_canonical.new, 1300);
  assert.equal(rows[1].changed_by, 1);
});

test("each refusal comes back per item, in order, without stopping the others", async () => {
  await withDb((db) => db.query(`UPDATE kpi_definition SET active = false WHERE code = 'AIR_PM' AND company_id IS NULL`));
  const items = [
    water({ kpi_code: "NO_SUCH_KPI" }),
    { kpi_code: "GHG_SCOPE1", site_id: 1, period_start: "2026-01-01", value_numeric: 5 },
    { kpi_code: "WATER_CONSUMPTION", site_id: 1, period_start: "2026-09-01", value_numeric: 5 },
    water({ site_id: 2 }),
    water({ site_id: 3 }),
    { kpi_code: "REVENUE", site_id: null, period_start: "2026-01-01", value_numeric: 10 },
    { kpi_code: "REVENUE", site_id: 1, period_start: "2026-01-01", value_numeric: 10 },
    water({ unit: "kWh" }),
    water({ value_numeric: -1 }),
    water({ breakdown: { groundwater: 700, surface: 400 } }),
    water({ breakdown: { rain: 1200 } }),
    water({ period_start: "2026-09-15" }),
    { kpi_code: "AIR_PM", site_id: 1, period_start: "2026-01-01", value_numeric: 1 },
    { kpi_code: "WATER_WITHDRAWAL", period_start: "2026-09-01", value_numeric: 1 },
    { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-08-01", value_numeric: 1.5 },
    water({ period_start: "2026-08-01", value_numeric: 800 }),
  ];
  const r = await put("user", items);
  assert.equal(r.status, 200);
  const codes = r.json.results.map((x) => (x.ok ? "ok" : x.code));
  assert.deepEqual(codes, [
    "KPI_NOT_FOUND", "KPI_AUTO_READ_ONLY", "KPI_AUTO_READ_ONLY", "KPI_NOT_ASSIGNED", "KPI_NOT_FOUND", "KPI_NOT_ASSIGNED",
    "KPI_VALUE_INVALID", "KPI_UNIT_NOT_ALLOWED", "KPI_VALUE_INVALID", "KPI_VALUE_INVALID", "KPI_VALUE_INVALID", "KPI_VALUE_INVALID",
    "KPI_NOT_SELECTED", "KPI_VALIDATION", "KPI_VALUE_INVALID", "ok",
  ]);
  assert.deepEqual(r.json.results.map((x) => x.index), items.map((_, i) => i));
  assert.equal(r.json.saved, 1);
  assert.deepEqual(r.json.results[9].details, { field: "breakdown", rule: "parts_must_add_up" });
  assert.deepEqual(r.json.results[7].details.allowed, ["kL", "m3", "litre", "ML"]);
  assert.ok(!JSON.stringify(r.json.results[8]).includes("-1"), "details never echo the value");
  await withDb((db) => db.query(`UPDATE kpi_definition SET active = true WHERE code = 'AIR_PM' AND company_id IS NULL`));

  // Percent range, a whole number and the body shape.
  const pct = await one("admin", { kpi_code: "WOMEN_IN_WORKFORCE", site_id: null, period_start: "2026-01-01", value_numeric: 120 });
  assert.equal(pct.code, "KPI_VALUE_INVALID");
  assert.equal((await call("PUT", "/kpi/values", "user", {})).status, 400);
  assert.equal((await call("PUT", "/kpi/values", "user", { items: [] })).json.code, "KPI_VALIDATION");

  // KPI-3: the company's frequency and year type; a KPI the company left out.
  assert.deepEqual((await one("user", water({ frequency: "quarterly", period_start: "2026-07-01" }))).details, { field: "frequency", rule: "company_frequency_monthly" });
  assert.deepEqual((await one("user", water({ year_type: "FY" }))).details, { field: "year_type", rule: "company_year_type_CY" });
  await withDb((db) => db.query(`UPDATE company_kpi SET selected = false, reason_excluded = 'Not tracked here' WHERE company_id = 1 AND kpi_definition_id = (SELECT id FROM kpi_definition WHERE code = 'AIR_NOX')`));
  assert.equal((await one("user", { kpi_code: "AIR_NOX", site_id: 1, period_start: "2026-01-01", value_numeric: 1 })).code, "KPI_NOT_SELECTED");
  await withDb((db) => db.query(`UPDATE company_kpi SET selected = true, reason_excluded = NULL WHERE company_id = 1 AND kpi_definition_id = (SELECT id FROM kpi_definition WHERE code = 'AIR_NOX')`));
});

test("KPI-3: no values until setup is finished", async () => {
  await withDb((db) => db.query(`UPDATE company_kpi_settings SET setup_completed_at = NULL WHERE company_id = 1`));
  try {
    assert.equal((await one("user", water())).code, "KPI_SETUP_INCOMPLETE");
    const sub = await call("POST", "/kpi/values/submit", "user", { ids: [draftId] });
    assert.deepEqual(sub.json.refused, [{ id: draftId, code: "KPI_SETUP_INCOMPLETE" }]);
    assert.equal((await call("GET", "/kpi/values", "user")).status, 200, "reads still answer");
  } finally {
    await withDb((db) => db.query(`UPDATE company_kpi_settings SET setup_completed_at = now() WHERE company_id = 1`));
  }
});

test("drafts are seen by their author, Admins and the Superadmin only; reads are scoped", async () => {
  const ids = (r) => r.json.values.map((v) => v.id);
  assert.ok(ids(await call("GET", "/kpi/values", "user")).includes(draftId));
  assert.ok(ids(await call("GET", "/kpi/values", "admin")).includes(draftId));
  assert.ok(ids(await call("GET", "/kpi/values?company_id=1", "superadmin")).includes(draftId));
  assert.ok(!ids(await call("GET", "/kpi/values", "manager")).includes(draftId));
  assert.ok(!ids(await call("GET", "/kpi/values", "multiSiteUser")).includes(draftId));
  assert.deepEqual(ids(await call("GET", "/kpi/values", "otherManager")), []);
  assert.equal((await call("GET", "/kpi/values?company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/kpi/values", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");

  // Filters.
  const f = await call("GET", "/kpi/values?kpi=WATER_WITHDRAWAL&site=1&from=2026-09-01&to=2026-09-30&status=draft", "user");
  assert.deepEqual(ids(f), [draftId]);
  assert.deepEqual(ids(await call("GET", "/kpi/values?site=company", "user")), []);
  assert.deepEqual(ids(await call("GET", "/kpi/values?from=2026-10-01", "user")), []);
  assert.equal((await call("GET", "/kpi/values?status=done", "user")).status, 400);
  assert.equal((await call("GET", "/kpi/values?kpi=NOPE_NOPE", "user")).status, 404);

  // Someone else's draft can't be overwritten by another person who may write there (the site's Manager);
  // since D17 another User doesn't own the pair at all.
  const other = await one("manager", water());
  assert.equal(other.code, "KPI_NOT_DRAFT");
  assert.equal((await one("multiSiteUser", water())).code, "KPI_NOT_ASSIGNED");
});

test("submit: draft → pending once; pending isn't editable; the Manager sees it", async () => {
  // Water withdrawn is BRSR Core (P6-E3), so it needs evidence first.
  assert.deepEqual((await call("POST", "/kpi/values/submit", "user", { ids: [draftId] })).json.refused, [{ id: draftId, code: "KPI_EVIDENCE_REQUIRED" }]);
  assert.equal((await call("POST", `/kpi/values/${draftId}/evidence`, "user", { document_url: "https://files.example.invalid/meter.pdf", document_name: "meter.pdf" })).status, 201);
  const r = await call("POST", "/kpi/values/submit", "user", { ids: [draftId, 999999] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { submitted: [draftId], refused: [{ id: 999999, code: "KPI_NOT_FOUND" }] });
  const again = await call("POST", "/kpi/values/submit", "user", { ids: [draftId] });
  assert.deepEqual(again.json.refused, [{ id: draftId, code: "KPI_NOT_DRAFT" }]);
  assert.equal((await one("user", water({ value_numeric: 5 }))).code, "KPI_NOT_DRAFT");
  const seen = (await call("GET", "/kpi/values?status=pending", "manager")).json.values;
  assert.equal(seen.find((v) => v.id === draftId).status, "pending");
  assert.ok((await call("GET", "/kpi/values?status=pending", "manager")).json.values[0].submitted_at);
  assert.equal((await call("POST", "/kpi/values/submit", "otherManager", { ids: [draftId] })).json.refused[0].code, "KPI_NOT_FOUND", "tenant");
  assert.equal((await call("POST", "/kpi/values/submit", "user", { ids: [] })).status, 400);
  assert.deepEqual((await audits(draftId)).map((a) => a.action), ["create", "update", "evidence_added", "submit"]);
});

test("a rejected value edited by its contributor becomes a draft again", async () => {
  const sentBack = await call("PUT", "/kpi/values/reject", "manager", { ids: [draftId], reason: "Please split by source" });
  assert.deepEqual(sentBack.json, { updated: [draftId], refused: [] }, "KPI-8's reject");
  const r = await one("user", water({ value_numeric: 1250, breakdown: { groundwater: 700, surface: 550 } }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.status, "draft");
  assert.equal(r.value.value_canonical, 1250);
  const last = (await audits(draftId)).at(-1);
  assert.equal(last.action, "reopen");
  assert.deepEqual(last.changed_fields.status, { old: "rejected", new: "draft" });
});

test("BRSR Core needs evidence to submit; evidence add, list and remove", async () => {
  const waste = await one("user", { kpi_code: "WASTE_GENERATED", site_id: 1, period_start: "2026-01-01", value_numeric: 12.4, unit: "tonne" });
  assert.equal(waste.ok, true, JSON.stringify(waste));
  const id = waste.value.id;
  const refused = await call("POST", "/kpi/values/submit", "user", { ids: [id] });
  assert.deepEqual(refused.json.refused, [{ id, code: "KPI_EVIDENCE_REQUIRED" }]);

  const form = new FormData();
  form.append("file", new Blob([Buffer.from("%PDF-1.4 manifest")], { type: "application/pdf" }), "waste-manifest.pdf");
  const up = await call("POST", `/kpi/values/${id}/evidence`, "user", form);
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.equal(up.json.evidence.document_name, "waste-manifest.pdf");
  assert.ok(up.json.evidence.document_url);
  const link = await call("POST", `/kpi/values/${id}/evidence`, "user", { document_url: "https://files.example.invalid/weighbridge.pdf", document_name: "weighbridge.pdf" });
  assert.equal(link.status, 201, JSON.stringify(link.json));
  assert.equal((await call("POST", `/kpi/values/${id}/evidence`, "user", { document_url: "not a url", document_name: "x" })).status, 400);

  const listed = (await call("GET", "/kpi/values?kpi=WASTE_GENERATED", "user")).json.values[0];
  assert.deepEqual(listed.evidence.map((e) => e.document_name), ["waste-manifest.pdf", "weighbridge.pdf"]);

  // Tenant isolation and scope on evidence.
  assert.equal((await call("POST", `/kpi/values/${id}/evidence`, "otherManager", { document_url: "https://x.invalid/a.pdf", document_name: "a.pdf" })).status, 404);
  assert.equal((await call("DELETE", `/kpi/values/${id}/evidence/${link.json.evidence.id}`, "otherUser")).status, 404);
  assert.equal((await call("DELETE", `/kpi/values/${id}/evidence/999999`, "user")).status, 404);
  assert.equal((await call("POST", `/kpi/values/${id}/evidence`, "manager", { document_url: "https://x.invalid/a.pdf", document_name: "a.pdf" })).status, 404, "someone else's draft");

  const del = await call("DELETE", `/kpi/values/${id}/evidence/${link.json.evidence.id}`, "user");
  assert.deepEqual(del.json, { removed: link.json.evidence.id });

  const ok = await call("POST", "/kpi/values/submit", "user", { ids: [id] });
  assert.deepEqual(ok.json, { submitted: [id], refused: [] });

  // Approved: the contributor can't change evidence; a Manager can, and the removal is logged.
  const approved = await call("PUT", "/kpi/values/approve", "manager", { ids: [id] });
  assert.deepEqual(approved.json, { updated: [id], refused: [] }, "KPI-8's approve");
  assert.equal((await call("POST", `/kpi/values/${id}/evidence`, "user", { document_url: "https://x.invalid/b.pdf", document_name: "b.pdf" })).json.code, "KPI_NOT_DRAFT");
  const mgr = await call("DELETE", `/kpi/values/${id}/evidence/${up.json.evidence.id}`, "manager");
  assert.equal(mgr.status, 200, JSON.stringify(mgr.json));
  const actions = (await audits(id)).map((a) => a.action);
  assert.deepEqual(actions, ["create", "evidence_added", "evidence_added", "evidence_removed", "submit", "approve", "evidence_removed_after_approval"]);
  assert.equal((await one("user", { kpi_code: "WASTE_GENERATED", site_id: 1, period_start: "2026-01-01", value_numeric: 1 })).code, "KPI_NOT_DRAFT", "approved isn't editable");

  // KPI-3: company 2 reports GRI only, so BRSR Core evidence isn't required there.
  const other = await one("otherUser", water({ site_id: 3, period_start: "2026-02-01" }));
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.deepEqual((await call("POST", "/kpi/values/submit", "otherUser", { ids: [other.value.id] })).json, { submitted: [other.value.id], refused: [] });
});

test("locks: a closed month refuses writes and submits; overlapping quarters too; FY years; a reopened lock lets them through", async () => {
  const draft = await one("user", { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-09-01", value_numeric: 1 });
  assert.equal(draft.ok, true);
  await withDb((db) => db.query(`INSERT INTO kpi_period_lock (company_id, site_id, year, period, year_type, locked_by) VALUES (1, NULL, 2026, 9, 'CY', 2)`));
  assert.equal((await one("user", { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-09-01", value_numeric: 2 })).code, "KPI_PERIOD_LOCKED");
  assert.equal((await one("admin", { kpi_code: "LOST_TIME_INJURIES", site_id: 2, period_start: "2026-09-01", value_numeric: 2 })).code, "KPI_PERIOD_LOCKED", "every site");
  assert.equal((await one("user", { kpi_code: "WATER_DISCHARGE", site_id: 1, period_start: "2026-07-01", frequency: "quarterly", value_numeric: 3000 })).code, "KPI_PERIOD_LOCKED", "Q3 overlaps September (discharge is quarterly for this company)");
  assert.equal((await one("user", { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-10-01", value_numeric: 2 })).ok, true);
  assert.deepEqual((await call("POST", "/kpi/values/submit", "user", { ids: [draft.value.id] })).json.refused, [{ id: draft.value.id, code: "KPI_PERIOD_LOCKED" }]);
  // Evidence on a locked period is still allowed: it changes no figure.
  assert.equal((await call("POST", `/kpi/values/${draft.value.id}/evidence`, "user", { document_url: "https://x.invalid/log.pdf", document_name: "log.pdf" })).status, 201);

  // A site lock covers only its site; an FY lock reads its year as April–March.
  await withDb((db) => db.query(`INSERT INTO kpi_period_lock (company_id, site_id, year, period, year_type, locked_by) VALUES (1, 2, 2027, 4, 'FY', 2), (1, 1, 2026, NULL, 'FY', 2)`));
  assert.equal((await one("admin", { kpi_code: "LOST_TIME_INJURIES", site_id: 2, period_start: "2026-04-01", value_numeric: 1 })).code, "KPI_PERIOD_LOCKED", "FY 2027 month 4 = April 2026");
  assert.equal((await one("admin", { kpi_code: "LOST_TIME_INJURIES", site_id: 2, period_start: "2026-05-01", value_numeric: 1 })).ok, true);
  assert.equal((await one("user", { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-03-01", value_numeric: 1 })).code, "KPI_PERIOD_LOCKED", "FY 2026 ends March 2026");
  assert.equal((await one("user", { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2025-03-01", value_numeric: 1 })).ok, true, "March 2025 is FY 2025");

  // Another company's lock never applies.
  assert.equal((await one("otherUser", water({ site_id: 3 }))).ok, true);

  await withDb((db) => db.query(`UPDATE kpi_period_lock SET reopened_at = now(), reopened_by = 2, reopened_reason = 'Late meter reading' WHERE company_id = 1 AND year = 2026 AND period = 9`));
  assert.equal((await one("user", { kpi_code: "LOST_TIME_INJURIES", site_id: 1, period_start: "2026-09-01", value_numeric: 2 })).ok, true);
});

test("company-level values: Admins and Managers enter them, any role reads them; converted from the unit entered", async () => {
  const rev = await one("admin", { kpi_code: "REVENUE", site_id: null, period_start: "2025-01-01", value_numeric: 250000, unit: "INR lakh" });
  assert.equal(rev.ok, true, JSON.stringify(rev));
  assert.equal(rev.value.value_canonical, 2500);
  assert.equal(rev.value.unit, "INR lakh");
  const mgr = await one("manager", { kpi_code: "WOMEN_ON_BOARD", site_id: null, period_start: "2025-01-01", value_numeric: 25 });
  assert.equal(mgr.ok, true, JSON.stringify(mgr));
  assert.equal((await call("POST", "/kpi/values/submit", "admin", { ids: [rev.value.id] })).json.submitted[0], rev.value.id);
  const userSees = (await call("GET", "/kpi/values?site=company", "user")).json.values.map((v) => v.kpi_code);
  assert.deepEqual(userSees, ["REVENUE"], "pending company value visible, the manager's draft isn't");
  const sa = await one("superadmin", { kpi_code: "HOURS_WORKED", site_id: 2, period_start: "2025-01-01", value_numeric: 250000 }, "?company_id=1");
  assert.equal(sa.ok, true, JSON.stringify(sa));
  assert.equal((await put("superadmin", [water()])).json.code, "KPI_COMPANY_REQUIRED");
  // yes/no and integers.
  const yn = await withDb(async (db) => (await db.query(`SELECT id FROM kpi_definition WHERE code = 'FATALITIES'`)).rows[0].id);
  assert.equal((await one("user", { kpi_definition_id: yn, site_id: 1, period_start: "2026-11-01", value_numeric: 0 })).ok, true, "by id");
  assert.equal((await one("user", { kpi_definition_id: yn, kpi_code: "LTIFR", site_id: 1, period_start: "2026-11-01", value_numeric: 0 })).code, "KPI_VALIDATION");
});

test("a company's own KPI is invisible to other companies", async () => {
  const own = await withDb(async (db) =>
    (
      await db.query(`INSERT INTO kpi_definition (code, name, question, topic, value_type, unit_dimension, canonical_unit, allowed_units, aggregation, level, default_frequency, source, company_id)
                      VALUES ('TEST4_OWN', 'Own', 'Own?', 'community', 'integer', 'count', 'count', '["count"]', 'sum', 'site', 'annual', 'manual', 2) RETURNING id`)
    ).rows[0].id,
  );
  try {
    assert.equal((await one("otherUser", { kpi_definition_id: own, site_id: 3, period_start: "2026-01-01", value_numeric: 1 })).code, "KPI_NOT_SELECTED", "not selected in company 2's setup yet");
    await withDb((db) => db.query(`INSERT INTO company_kpi (company_id, kpi_definition_id, selected) VALUES (2, $1, true)`, [own]));
    assert.equal((await one("user", { kpi_definition_id: own, site_id: 1, period_start: "2026-01-01", value_numeric: 1 })).code, "KPI_NOT_FOUND");
    assert.equal((await one("otherUser", { kpi_definition_id: own, site_id: 3, period_start: "2026-01-01", value_numeric: 1 })).ok, true);
  } finally {
    await withDb(async (db) => {
      await db.query(`DELETE FROM kpi_value WHERE kpi_definition_id = $1`, [own]);
      await db.query(`DELETE FROM company_kpi WHERE kpi_definition_id = $1`, [own]);
      await db.query(`DELETE FROM kpi_definition WHERE id = $1`, [own]);
    });
  }
});

test("every values route answers KPI_TRACKING_OFF when the switch is off", async () => {
  await setSwitch(1, false);
  try {
    for (const [method, route, body] of [["GET", "/kpi/values"], ["PUT", "/kpi/values", { items: [water()] }], ["POST", "/kpi/values/submit", { ids: [draftId] }], ["POST", `/kpi/values/${draftId}/evidence`, { document_url: "https://x.invalid/a.pdf", document_name: "a" }], ["DELETE", `/kpi/values/${draftId}/evidence/1`]]) {
      const r = await call(method, route, "user", body);
      assert.equal(r.status, 403, `${method} ${route}`);
      assert.equal(r.json.code, "KPI_TRACKING_OFF");
    }
    // The data is kept (D3).
    const n = await withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n FROM kpi_value WHERE company_id = 1`)).rows[0].n);
    assert.ok(n > 0);
  } finally {
    await setSwitch(1, true);
  }
});

test("migrate:kpi-values runs twice and keeps the values", async () => {
  const count = () => withDb(async (db) => (await db.query(`SELECT COUNT(*)::int AS n FROM kpi_value`)).rows[0].n);
  const before = await count();
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateKpiValues");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  assert.equal(await count(), before);
});
