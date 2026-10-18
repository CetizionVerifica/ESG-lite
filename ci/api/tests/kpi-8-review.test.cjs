// KPI-8 review and close: the §5 checks stored on submit and evidence
// changes; PUT /kpi/values/approve|reject with only_ready, self-review,
// reasons, locked periods and the KPI-6 recompute; kpi_submitted and
// kpi_rejected notifications; GET/POST /kpi/periods/lock and unlock with
// KPI_PERIOD_INCOMPLETE details.left; the daily kpi_due job (5 days before and
// on the day, once, muted by preference); role matrix, tenant isolation and
// the switch.
//
// Fixture: company 1 (sites 1, 2; user 1 on site 1, manager 2 on 1+2, admin 3,
// multi user 7 on 1+2), company 2 (site 3; otherUser 4, otherManager 6).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup, kpiRoutes, concrete, setTopicOwners, ROOT } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const KPIS = ["LOST_TIME_INJURIES", "WATER_WITHDRAWAL", "WATER_DISCHARGE", "WATER_CONSUMPTION", "REVENUE"];
const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_period_lock WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_value', 'kpi_setup', 'kpi_period_lock')`);
  await q(`DELETE FROM notification WHERE type LIKE 'kpi_%'`);
  await q(`DELETE FROM emission_threshold WHERE company_id = 1`);
  await q(`UPDATE "user" SET notification_preferences = '{}'::jsonb WHERE user_id IN (1, 7)`).catch(() => {});
  await clearSetup();
};
const kpiId = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
const val = async (id) => (await q(`SELECT * FROM kpi_value WHERE id = $1`, [id]))[0];
const notes = (user, type) => q(`SELECT * FROM notification WHERE user_id = $1 AND type = $2 ORDER BY id`, [user, type]);

/** Saves and submits one value; with evidence unless `bare`. Returns its id. A Superadmin names `company`. */
const entered = async (who, item, { bare = false, submit = true, company = null } = {}) => {
  const qs = company ? `?company_id=${company}` : "";
  const r = await call("PUT", `/kpi/values${qs}`, who, { items: [item] });
  assert.equal(r.json.results?.[0]?.ok, true, JSON.stringify(r.json));
  const id = r.json.results[0].value.id;
  if (!bare) assert.equal((await call("POST", `/kpi/values/${id}/evidence${qs}`, who, { document_url: "https://x.invalid/log.pdf", document_name: "log.pdf" })).status, 201);
  if (submit) assert.deepEqual((await call("POST", `/kpi/values/submit${qs}`, who, { ids: [id] })).json.refused, []);
  return id;
};
let firstApproved;
const lti = (site, start, value, over = {}) => ({ kpi_code: "LOST_TIME_INJURIES", site_id: site, period_start: start, value_numeric: value, ...over });
const approve = (who, body) => call("PUT", "/kpi/values/approve", who, body);
const reject = (who, body) => call("PUT", "/kpi/values/reject", who, body);

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI"], kpis: KPIS });
  await setupCompany(2, { frameworks: ["GRI"], kpis: KPIS });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

test("who reviews: Managers and the Superadmin; Admins and Users can't; reject needs a reason", async () => {
  const id = await entered("user", lti(1, "2026-01-01", 1));
  firstApproved = id;
  for (const who of ["user", "admin"]) {
    const r = await approve(who, { ids: [id] });
    assert.deepEqual([r.status, r.json.code], [403, "KPI_FORBIDDEN"], who);
  }
  assert.deepEqual([(await reject("manager", { ids: [id] })).status, (await reject("manager", { ids: [id] })).json.code], [400, "KPI_REASON_REQUIRED"]);
  assert.equal((await reject("manager", { ids: [id], reason: "   " })).json.code, "KPI_REASON_REQUIRED");
  assert.equal((await approve("manager", { ids: [] })).json.code, "KPI_VALIDATION");
  assert.equal((await approve("manager", {})).status, 400);
  assert.equal((await approve("superadmin", { ids: [id] })).json.code, "KPI_COMPANY_REQUIRED");
  assert.deepEqual((await approve("superadmin", { ids: [id], company_id: 1 })).json, { updated: [id], refused: [] });
  const v = await val(id);
  assert.deepEqual([v.status, Number(v.reviewed_by), !!v.reviewed_at, v.review_comment], ["approved", 5, true, null]);
});

test("checks are stored on submit and on evidence changes; each one held and passed", async () => {
  await q(`INSERT INTO emission_threshold (company_id, threshold_percentage) VALUES (1, 20)`);
  // Last September: 10 injuries, approved.
  await q(`INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status) VALUES (1, 1, $1, '2025-09-01', '2025-09-30', 'monthly', 'CY', 10, 'count', 10, 'manual', 'approved')`, [await kpiId("LOST_TIME_INJURIES")]);
  const jump = await entered("user", lti(1, "2026-09-01", 30));
  let c = (await val(jump)).checks;
  assert.deepEqual([c.ready, c.held], [false, ["KPI_CHANGE_LIMIT"]]);
  assert.deepEqual(c.details.KPI_CHANGE_LIMIT, { previous: 10, change_pct: 200, ratio: 3, limit_pct: 20 }, "the company's change limit");

  const bare = await entered("user", lti(1, "2026-08-01", 2), { bare: true });
  assert.deepEqual((await val(bare)).checks.held, ["KPI_EVIDENCE"]);
  const ev = await call("POST", `/kpi/values/${bare}/evidence`, "user", { document_url: "https://x.invalid/a.pdf", document_name: "a.pdf" });
  assert.equal(ev.status, 201);
  assert.deepEqual((await val(bare)).checks.held, [], "evidence added: checked again");
  assert.equal((await call("DELETE", `/kpi/values/${bare}/evidence/${ev.json.evidence.id}`, "user")).status, 200);
  assert.deepEqual((await val(bare)).checks.held, ["KPI_EVIDENCE"], "evidence removed: held again");

  const estimate = await entered("user", lti(1, "2026-07-01", 3, { is_estimate: true }));
  assert.deepEqual((await val(estimate)).checks.held, ["KPI_ESTIMATE"]);

  const water = await entered("user", { kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-09-01", value_numeric: 1200, unit: "m3", breakdown: { groundwater: 700, surface: 500 } });
  c = (await val(water)).checks;
  assert.deepEqual([c.ready, c.held, c.info], [true, [], ["KPI_UNIT_CONVERTED"]], "converted is informational");
  // A breakdown that stopped adding up (only possible outside the entry form) is held when it's checked again.
  await q(`UPDATE kpi_value SET breakdown = '{"groundwater": 700, "surface": 300}' WHERE id = $1`, [water]);
  await call("POST", `/kpi/values/${water}/evidence`, "user", { document_url: "https://x.invalid/b.pdf", document_name: "b.pdf" });
  assert.deepEqual((await val(water)).checks.held, ["KPI_BREAKDOWN_SUM"]);
  assert.equal((await val(water)).checks.details.KPI_BREAKDOWN_SUM.parts, 1000);

  // GET /kpi/values returns the checks; a pending value without stored checks gets them on read.
  await q(`UPDATE kpi_value SET checks = NULL WHERE id = $1`, [estimate]);
  const list = (await call("GET", "/kpi/values?status=pending", "manager")).json.values;
  assert.deepEqual(list.find((v) => v.id === estimate).checks.held, ["KPI_ESTIMATE"]);
  assert.deepEqual(list.find((v) => v.id === jump).checks.details.KPI_CHANGE_LIMIT.ratio, 3);

  // only_ready: the ready one goes, the held ones are refused with KPI_NOT_READY.
  const ready = await entered("user", lti(1, "2026-06-01", 1));
  const r = await approve("manager", { ids: [ready, jump, bare, estimate], only_ready: true });
  assert.deepEqual(r.json, { updated: [ready], refused: [{ id: jump, code: "KPI_NOT_READY" }, { id: bare, code: "KPI_NOT_READY" }, { id: estimate, code: "KPI_NOT_READY" }] });
  // Without only_ready a held value can still be approved, deliberately.
  assert.deepEqual((await approve("manager", { ids: [jump] })).json, { updated: [jump], refused: [] });
  assert.deepEqual((await approve("manager", { ids: [jump] })).json.refused, [{ id: jump, code: "KPI_NOT_PENDING" }]);
});

test("nobody reviews their own entries (the Superadmin may); drafts, auto values and another company's ids are refused", async () => {
  const own = await entered("manager", lti(2, "2026-05-01", 1));
  assert.deepEqual((await approve("manager", { ids: [own] })).json.refused, [{ id: own, code: "KPI_SELF_REVIEW" }]);
  assert.deepEqual((await reject("manager", { ids: [own], reason: "x" })).json.refused, [{ id: own, code: "KPI_SELF_REVIEW" }]);
  const sa = await entered("superadmin", lti(2, "2026-04-01", 1), { company: 1 });
  assert.deepEqual((await approve("superadmin", { ids: [sa], company_id: 1 })).json.updated, [sa], "as for emissions");

  const draft = await entered("user", lti(1, "2026-05-01", 1), { submit: false });
  assert.deepEqual((await approve("manager", { ids: [draft] })).json.refused, [{ id: draft, code: "KPI_NOT_FOUND" }], "someone else's draft doesn't exist");
  assert.deepEqual((await approve("superadmin", { ids: [draft], company_id: 1 })).json.refused, [{ id: draft, code: "KPI_NOT_PENDING" }]);
  assert.deepEqual((await approve("manager", { ids: [999999] })).json.refused, [{ id: 999999, code: "KPI_NOT_FOUND" }]);

  const [formula] = await q(`INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status) VALUES (1, 1, $1, '2025-01-01', '2025-01-31', 'monthly', 'CY', 1, 'kL', 1, 'formula', 'pending') RETURNING id`, [await kpiId("WATER_CONSUMPTION")]);
  assert.deepEqual((await approve("manager", { ids: [formula.id] })).json.refused, [{ id: formula.id, code: "KPI_AUTO_READ_ONLY" }]);

  // Tenant isolation: company 2's Manager sees none of company 1's values, and can't name company 1.
  assert.deepEqual((await approve("otherManager", { ids: [own] })).json.refused, [{ id: own, code: "KPI_NOT_FOUND" }]);
  assert.equal((await approve("otherManager", { ids: [own], company_id: 1 })).status, 404);
  assert.equal((await val(own)).status, "pending");
});

test("submit notifies the reviewers once per submit; reject sends the value back with the reason, notifies, and is audited", async () => {
  const before = (await notes(2, "kpi_submitted")).length;
  const a = await entered("user", lti(1, "2026-03-01", 1), { submit: false });
  const b = await entered("user", lti(1, "2026-02-01", 1), { submit: false });
  assert.deepEqual((await call("POST", "/kpi/values/submit", "user", { ids: [a, b] })).json.submitted, [a, b]);
  const sent = await notes(2, "kpi_submitted");
  assert.equal(sent.length, before + 1, "one notification for the batch");
  assert.match(sent.at(-1).message, /^2 KPI values were sent/);
  assert.equal(sent.at(-1).link, "/data/approvals?view=kpi");
  assert.equal((await notes(1, "kpi_submitted")).length, 0, "never to the submitter");

  const r = await reject("manager", { ids: [a, b], reason: "Wrong unit" });
  assert.deepEqual(r.json, { updated: [a, b], refused: [] });
  const v = await val(a);
  assert.deepEqual([v.status, v.review_comment, Number(v.reviewed_by)], ["rejected", "Wrong unit", 2]);
  const back = await notes(1, "kpi_rejected");
  assert.equal(back.length, 1, "one per person");
  assert.match(back[0].message, /Wrong unit/);
  assert.deepEqual(back[0].meta, { reviewer: "CI Manager", reason: "Wrong unit" });
  const [audit] = await q(`SELECT action, reason, changed_by, changed_fields FROM audit_log WHERE entity_type = 'kpi_value' AND entity_id = $1 AND action = 'reject'`, [a]);
  assert.deepEqual([audit.reason, audit.changed_by, audit.changed_fields.status], ["Wrong unit", 2, { old: "pending", new: "rejected" }]);

  // An approved value can be sent back too.
  assert.equal((await val(firstApproved)).status, "approved");
  assert.deepEqual((await reject("manager", { ids: [firstApproved], reason: "Looks too high" })).json.updated, [firstApproved]);
  assert.equal((await val(firstApproved)).status, "rejected");
});

test("approve and reject recompute calculated KPIs (water consumed = withdrawn − discharged)", async () => {
  const withdrawn = await entered("multiSiteUser", { kpi_code: "WATER_WITHDRAWAL", site_id: 2, period_start: "2026-09-01", value_numeric: 1000 });
  const discharged = await entered("multiSiteUser", { kpi_code: "WATER_DISCHARGE", site_id: 2, period_start: "2026-09-01", value_numeric: 400 });
  const consumed = async () => (await q(`SELECT v.* FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id WHERE v.company_id = 1 AND d.code = 'WATER_CONSUMPTION' AND v.site_id = 2 AND v.period_start = '2026-09-01'`))[0];
  assert.equal((await consumed()).status, "pending", "waiting for review");
  assert.equal((await approve("manager", { ids: [withdrawn, discharged] })).json.updated.length, 2);
  const c = await consumed();
  assert.deepEqual([c.status, Number(c.value_canonical), c.comment], ["approved", 600, null], "approved inputs: approved at once");
  assert.deepEqual((await reject("manager", { ids: [discharged], reason: "Meter misread" })).json.updated, [discharged]);
  assert.equal(await consumed(), undefined, "an input sent back: no value (never a guess)");
});

test("close a period: what's left, KPI_PERIOD_INCOMPLETE with details.left, lock, writes refused, unlock with a reason", async () => {
  await q(`DELETE FROM kpi_value WHERE company_id = 1 AND period_start >= '2026-11-01' AND period_start < '2027-01-01'`);
  const status = async (who, query) => {
    const r = await call("GET", `/kpi/periods/lock${query}`, who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const nov = await status("manager", "?year=2026&period=11");
  assert.deepEqual([nov.year, nov.period, nov.year_type, nov.label, nov.range], [2026, 11, "CY", "Nov 2026", { start: "2026-11-01", end: "2026-11-30" }]);
  assert.deepEqual(nov.sites.map((s) => s.site_id), [null, 1, 2], "the company row, then the Manager's sites");
  assert.ok(nov.left.length > 0 && nov.left.every((l) => l.reason === "missing"));
  assert.ok(nov.left.some((l) => l.code === "LOST_TIME_INJURIES" && l.site_id === 1 && l.period_label === "Nov 2026"));
  assert.ok(!nov.left.some((l) => l.code === "REVENUE"), "an annual value ends in December");
  assert.ok(!nov.left.some((l) => l.code === "WATER_CONSUMPTION"), "calculated values follow their inputs");
  assert.equal(nov.can_lock, false);

  const refused = await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 11, site_id: 1 });
  assert.deepEqual([refused.status, refused.json.code], [422, "KPI_PERIOD_INCOMPLETE"]);
  assert.deepEqual(refused.json.details.left.map((l) => l.code).sort(), ["LOST_TIME_INJURIES", "WATER_DISCHARGE", "WATER_WITHDRAWAL"]);
  assert.ok(refused.json.details.left.every((l) => l.site_id === 1));

  // D17: each item left names who owes it (the resolver: here site 1's topic owner, user 1).
  assert.ok(refused.json.details.left.every((l) => l.owner_user_id === 1 && l.owner_name === "CI User"));
  // A KPI is expected only where it has an owner: with nobody owning water on site 1 (only
  // withdrawal by a per-KPI override) and discharge owned on site 2, discharge leaves site 1's list.
  await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1 AND site_id = 1 AND topic = 'water'`);
  await q(`INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id) VALUES (1, $1, 1, 1)`, [await kpiId("WATER_WITHDRAWAL")]);
  await q(`INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id) VALUES (1, $1, 2, 2)`, [await kpiId("WATER_DISCHARGE")]);
  assert.ok(!(await status("manager", "?year=2026&period=11&site=1")).left.some((l) => l.code === "WATER_DISCHARGE"));

  // Fill site 1 for November, approve, lock.
  const ids = [await entered("user", lti(1, "2026-11-01", 1)), await entered("user", { kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2026-11-01", value_numeric: 100 })];
  let left = (await status("manager", "?year=2026&period=11&site=1")).left;
  assert.deepEqual(left.map((l) => l.reason), ["pending", "pending"]);
  assert.deepEqual((await approve("manager", { ids })).json.updated, ids);
  const site1 = await status("manager", "?year=2026&period=11&site=1");
  assert.deepEqual([site1.left, site1.can_lock, site1.locked], [[], true, false]);
  assert.deepEqual(site1.sites[0].kpis.find((k) => k.code === "LOST_TIME_INJURIES").counts, { missing: 0, draft: 0, pending: 0, approved: 1, rejected: 0 });

  const locked = await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 11, site_id: 1 });
  assert.equal(locked.status, 200, JSON.stringify(locked.json));
  assert.deepEqual([locked.json.lock.site_id, locked.json.lock.year, locked.json.lock.period, locked.json.lock.year_type, locked.json.lock.locked_by, locked.json.lock.reopened_at], [1, 2026, 11, "CY", 2, null]);
  assert.deepEqual([locked.json.status.locked, locked.json.status.sites[0].locked, locked.json.status.sites[0].lock.locked_by_name], [true, true, "CI Manager"]);
  assert.equal((await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 11, site_id: 1 })).status, 200, "locking twice is fine");
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM kpi_period_lock WHERE company_id = 1 AND site_id = 1 AND year = 2026 AND period = 11`))[0].n, 1);

  // Every write path into the closed month refuses.
  const put = await call("PUT", "/kpi/values", "user", { items: [lti(1, "2026-11-01", 5)] });
  assert.equal(put.json.results[0].code, "KPI_PERIOD_LOCKED");
  assert.deepEqual((await reject("manager", { ids: [ids[0]], reason: "x" })).json.refused, [{ id: ids[0], code: "KPI_PERIOD_LOCKED" }]);
  assert.equal((await call("PUT", "/kpi/values", "user", { items: [lti(1, "2026-10-01", 5)] })).json.results[0].ok, true, "October is open");
  assert.equal((await call("PUT", "/kpi/values", "multiSiteUser", { items: [lti(2, "2026-11-01", 5)] })).json.results[0].ok, true, "site 2 is open");

  // Unlock: a reason, the same scope, audited.
  const noReason = await call("POST", "/kpi/periods/unlock", "manager", { year: 2026, period: 11, site_id: 1 });
  assert.deepEqual([noReason.status, noReason.json.code], [400, "KPI_REASON_REQUIRED"]);
  const un = await call("POST", "/kpi/periods/unlock", "manager", { year: 2026, period: 11, site_id: 1, reason: "Late meter reading" });
  assert.equal(un.status, 200, JSON.stringify(un.json));
  assert.deepEqual([un.json.lock.reopened_by, un.json.lock.reopened_reason, un.json.status.locked, un.json.status.sites[0].reopened.reason], [2, "Late meter reading", false, "Late meter reading"]);
  assert.equal((await call("POST", "/kpi/periods/unlock", "manager", { year: 2026, period: 11, site_id: 1, reason: "again" })).status, 404, "nothing locked");
  const audit = await q(`SELECT action, reason, changed_by FROM audit_log WHERE entity_type = 'kpi_period_lock' AND entity_id = $1 ORDER BY id`, [locked.json.lock.id]);
  assert.deepEqual(audit.map((a) => [a.action, a.reason, a.changed_by]), [["lock", null, 2], ["unlock", "Late meter reading", 2]]);
  // Locking again after a reopen reuses the row.
  assert.equal((await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 11, site_id: 1 })).json.lock.id, locked.json.lock.id);
});

test("lock roles: Managers name one of their sites; Admins and the Superadmin lock the company; Users can't; another company is 404", async () => {
  assert.deepEqual([(await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 10 })).status, (await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 10 })).json.code], [403, "KPI_FORBIDDEN"]);
  assert.equal((await call("POST", "/kpi/periods/unlock", "manager", { year: 2026, period: 10, reason: "x" })).status, 403);
  for (const who of ["user", "multiSiteUser"]) assert.equal((await call("GET", "/kpi/periods/lock?year=2026&period=10", who)).json.code, "KPI_FORBIDDEN");
  assert.equal((await call("POST", "/kpi/periods/lock", "manager", { year: 2026, period: 10, site_id: 3 })).status, 404, "company 2's site");
  assert.equal((await call("GET", "/kpi/periods/lock?year=2026&period=10&company_id=1", "otherManager")).status, 404);
  assert.equal((await call("GET", "/kpi/periods/lock?year=2026&period=10", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/kpi/periods/lock?period=10", "manager")).json.code, "KPI_VALIDATION");
  assert.equal((await call("GET", "/kpi/periods/lock?year=2026&period=13", "manager")).status, 400);

  // A company-wide lock (Admin): every site and the company-level values must be complete.
  const wide = await call("POST", "/kpi/periods/lock", "admin", { year: 2025, period: 3 });
  assert.equal(wide.json.code, "KPI_PERIOD_INCOMPLETE");
  assert.ok(wide.json.details.left.some((l) => l.site_id === 2));
  // A month nothing ends in (an empty selection for it) locks at once: use company 2, which has values for nothing in 2020 but Superadmin can name it.
  await q(`UPDATE company_kpi SET selected = false WHERE company_id = 2`);
  const sa = await call("POST", "/kpi/periods/lock", "superadmin", { year: 2020, period: null, company_id: 2 });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.deepEqual([sa.json.lock.site_id, sa.json.lock.period, sa.json.status.locked], [null, null, true]);
  // A site under the company-wide lock reopens only with it.
  const siteUnlock = await call("POST", "/kpi/periods/unlock", "superadmin", { year: 2020, site_id: 3, reason: "x", company_id: 2 });
  assert.deepEqual([siteUnlock.status, siteUnlock.json.details.locked_by], [404, { site_id: null, period: null }]);
  assert.equal((await call("POST", "/kpi/periods/unlock", "otherManager", { year: 2020, reason: "x" })).status, 403);
  assert.equal((await call("POST", "/kpi/periods/unlock", "superadmin", { year: 2020, reason: "Wrong year", company_id: 2 })).status, 200);
  await q(`UPDATE company_kpi SET selected = true WHERE company_id = 2`);
});

test("due reminders: 5 days before and on the due date, once, to whoever still owes; muted by preference", async () => {
  // September 2026 values are due on 15 October; site 1's user still owes water discharged for September
  // (D17: they own water on site 1 again; the close-period test above took it away).
  await setTopicOwners(1, { 1: 1 }, ["water"]);
  const run = (today) => {
    const script = `const {AppDataSource}=require(${JSON.stringify(path.join(ROOT, "dist/config/data-source.js"))});
      AppDataSource.initialize().then(()=>require(${JSON.stringify(path.join(ROOT, "dist/kpi/review/reminders.js"))}).sendDueReminders(${JSON.stringify(today)}))
        .then((r)=>{console.log(JSON.stringify(r));return AppDataSource.destroy();}).then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});`;
    const r = spawnSync(process.execPath, ["-e", script], { cwd: ROOT, env: { ...process.env, TYPEORM_SYNC: "false" }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return JSON.parse(r.stdout.trim().split("\n").pop());
  };
  await q(`UPDATE "user" SET notification_preferences = '{"kpi_due": false}'::jsonb WHERE user_id = 7`);
  const first = run("2026-10-10");
  assert.ok(first.notified >= 1, JSON.stringify(first));
  assert.ok(first.muted >= 1, "user 7 muted it");
  const due = await notes(1, "kpi_due");
  assert.equal(due.length, 1);
  assert.equal(due[0].title, "KPIs due in 5 days");
  assert.equal(due[0].link, "/kpi?period=2026-09");
  assert.deepEqual([due[0].meta.due_date, due[0].meta.period], ["2026-10-15", "2026-09"]);
  assert.equal((await notes(7, "kpi_due")).length, 0);
  const again = run("2026-10-10");
  assert.equal(again.notified, 0, "never twice for one due date");
  assert.equal((await notes(1, "kpi_due")).length, 1);
  assert.equal(run("2026-10-11").notified, 0, "nothing due on the 11th or the 16th");
  // On the due date itself (a different due date for the same day's run): a second one.
  await q(`DELETE FROM notification WHERE type = 'kpi_due'`);
  run("2026-10-15");
  const today = await notes(1, "kpi_due");
  assert.equal(today[0].title, "KPIs due today");
});

test("switch off: every KPI-8 route answers KPI_TRACKING_OFF", async () => {
  const routes = kpiRoutes().filter((r) => ["/values/approve", "/values/reject", "/periods/lock", "/periods/unlock"].includes(r.path));
  assert.equal(routes.length, 5);
  await setSwitch(1, false);
  try {
    for (const r of routes) {
      const res = await call(r.method, concrete(r.path), "manager", r.method === "GET" ? undefined : {});
      assert.deepEqual([res.status, res.json?.code], [403, "KPI_TRACKING_OFF"], `${r.method} ${r.path}`);
    }
  } finally {
    await setSwitch(1, true);
  }
});

test("a reviewer edits a pending value: it stays pending, needs a reason, is audited and checked again", async () => {
  const id = await entered("multiSiteUser", lti(2, "2026-12-01", 4));
  const edit = (who, item, qs = "") => call("PUT", `/kpi/values${qs}`, who, { items: [item] });
  const noReason = await edit("manager", { id, value_numeric: 5 });
  assert.equal(noReason.json.results[0].code, "KPI_REASON_REQUIRED");
  for (const who of ["admin", "user"]) assert.equal((await edit(who, { id, value_numeric: 5, reason: "x" })).json.results[0].code, "KPI_FORBIDDEN", who);
  const ok = await edit("manager", { id, value_numeric: 5, is_estimate: true, reason: "Logbook says 5" });
  assert.equal(ok.json.results[0].ok, true, JSON.stringify(ok.json));
  const v = ok.json.results[0].value;
  assert.deepEqual([v.status, v.value_numeric, v.value_canonical, v.is_estimate, v.entered_by], ["pending", 5, 5, true, 7], "still pending, still the contributor's");
  assert.deepEqual(v.checks.held, ["KPI_ESTIMATE"]);
  const [audit] = await q(`SELECT action, reason, changed_by, changed_fields FROM audit_log WHERE entity_type = 'kpi_value' AND entity_id = $1 AND action = 'review_edit'`, [id]);
  assert.deepEqual([audit.reason, audit.changed_by, audit.changed_fields.value_numeric, audit.changed_fields.is_estimate], ["Logbook says 5", 2, { old: 4, new: 5 }, { old: false, new: true }]);
  assert.equal((await edit("manager", { id, value_numeric: -1, reason: "x" })).json.results[0].code, "KPI_VALUE_INVALID");
  assert.equal((await edit("superadmin", { id, value_numeric: 6, reason: "Superadmin fix" }, "?company_id=1")).json.results[0].value.value_numeric, 6);
  assert.equal((await edit("otherManager", { id, value_numeric: 6, reason: "x" })).json.results[0].code, "KPI_NOT_FOUND", "tenant");
  assert.deepEqual((await approve("manager", { ids: [id] })).json.updated, [id]);
  assert.equal((await edit("manager", { id, value_numeric: 7, reason: "x" })).json.results[0].code, "KPI_NOT_PENDING");
});

test("value rows carry names, last year and the change; the history reads through /user/audit-logs with the KPI tenant rules", async () => {
  const rows = (await call("GET", "/kpi/values?kpi=LOST_TIME_INJURIES&site=1&from=2026-09-01&to=2026-09-30", "manager")).json.values;
  const sep = rows.find((r) => r.period_start === "2026-09-01");
  const [{ name }] = await q(`SELECT name FROM kpi_definition WHERE code = 'LOST_TIME_INJURIES' AND company_id IS NULL`);
  assert.deepEqual([sep.kpi_name, sep.site_name, sep.entered_by_name], [name, "CI Plant A", "CI User"]);
  assert.deepEqual(sep.last_value, { value: 10, unit: "count", value_canonical: 10, period_start: "2025-09-01", status: "approved" });
  assert.equal(sep.change_pct, 200);
  assert.deepEqual(sep.check_items[0], { id: "KPI_CHANGE_LIMIT", held: true, detail: { previous: 10, change_pct: 200, ratio: 3, limit_pct: 20 } });

  const history = (who, qs = "") => call("GET", `/user/audit-logs?entity_type=kpi_value&entity_id=${sep.id}${qs}`, who);
  const h = await history("manager");
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.deepEqual(h.json.map((r) => r.action).reverse().slice(0, 3), ["create", "evidence_added", "submit"]);
  assert.ok(h.json.some((r) => r.action === "approve" && r.changed_by.user_id === 2));
  assert.equal((await history("user")).status, 200, "its contributor");
  assert.equal((await history("superadmin")).status, 200);
  assert.equal((await history("otherManager")).status, 404, "another company");
  assert.equal((await history("otherUser")).status, 404);
  const draft = await entered("user", lti(1, "2026-12-01", 1), { submit: false });
  assert.equal((await call("GET", `/user/audit-logs?entity_type=kpi_value&entity_id=${draft}`, "multiSiteUser")).status, 404, "someone else's draft");
  assert.equal((await call("GET", `/user/audit-logs?entity_type=kpi_value&entity_id=999999`, "manager")).status, 404);
  await setSwitch(1, false);
  try {
    assert.equal((await history("manager")).json.code, "KPI_TRACKING_OFF");
  } finally {
    await setSwitch(1, true);
  }
});
