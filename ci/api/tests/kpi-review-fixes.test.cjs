// Pre-merge review fixes (2026-10-18):
//   - a KPI's frequency can't change once values exist at the old one (they would drop out of
//     every yearly figure), like the year type;
//   - the user update saves the person and their KPI topics together: a refused topic change
//     leaves the role unchanged;
//   - evidence links are http(s) only;
//   - template upload plans live in kpi_template_plan (not process memory), one commit each;
//   - migrate:kpi-template-plans runs twice; migrate:kpi-topic-assignment collapses per-KPI rows
//     only on the run that creates the table.
//
// Fixture: company 1 (sites 1, 2; user 1 on site 1, manager 2 on 1+2, admin 3, multi user 7),
// company 2 (site 3; other user 4), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const kpiId = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;

const wipe = async () => {
  await clearSetup();
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_template_plan`);
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment", "migrateKpiTemplatePlans"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI"] });
  await setSwitch(1, true);
});
test.after(async () => {
  await wipe();
  await q(`UPDATE "user" SET role = 'User' WHERE user_id = 1`);
  await setSwitch(1, false);
});

// PUT /kpi/setup {kpis} is the whole selection: every selected KPI as it is, water with `frequency`.
const selection = async (water, frequency) => {
  const rows = await q(`SELECT kpi_definition_id FROM company_kpi WHERE company_id = 1 AND selected`);
  return rows.map((r) => (Number(r.kpi_definition_id) === Number(water) ? { kpi_definition_id: water, selected: true, frequency } : { kpi_definition_id: Number(r.kpi_definition_id), selected: true }));
};
const putWater = async (water, frequency) => call("PUT", "/kpi/setup", "admin", { kpis: await selection(water, frequency) });

test("a KPI's frequency can't change once values exist at the old one", async () => {
  const water = await kpiId("WATER_WITHDRAWAL");
  const [{ frequency }] = await q(`SELECT COALESCE(ck.frequency, d.default_frequency) AS frequency FROM company_kpi ck JOIN kpi_definition d ON d.id = ck.kpi_definition_id WHERE ck.company_id = 1 AND ck.kpi_definition_id = $1`, [water]);
  const other = frequency === "quarterly" ? "annual" : "quarterly";
  // No values yet: the change is allowed, and changing it back too.
  assert.equal((await putWater(water, other)).status, 200);
  assert.equal((await putWater(water, null)).status, 200);

  await q(
    `INSERT INTO kpi_value (company_id, site_id, kpi_definition_id, period_start, period_end, frequency, year_type, value_numeric, unit, value_canonical, source, status)
     VALUES (1, 1, $1, '2025-01-01', '2025-01-31', $2, 'CY', 10, 'kl', 10, 'manual', 'approved')`,
    [water, frequency],
  );
  const refused = await putWater(water, other);
  assert.equal(refused.status, 400, JSON.stringify(refused.json));
  assert.equal(refused.json.code, "KPI_VALIDATION");
  assert.match(JSON.stringify(refused.json), /other frequency/);
  // Sending the frequency it already has is not a change.
  assert.equal((await putWater(water, frequency)).status, 200);
});

test("the user update saves the person and their KPI topics together", async () => {
  // An Admin can't own a site topic, so this topic change is refused, and the role change with it.
  const r = await call("PATCH", "/admin/users/1", "superadmin", { role: "Admin", kpi_topics: ["energy"], company_id: 1 });
  assert.equal(r.json.code, "KPI_VALUE_INVALID", JSON.stringify(r.json));
  assert.equal((await q(`SELECT role FROM "user" WHERE user_id = 1`))[0].role, "User", "role unchanged");
  // A topic change the person may hold still saves.
  const ok = await call("PATCH", "/company-admin/users/1", "admin", { kpi_topics: ["energy"] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test("evidence links are http(s) only", async () => {
  const water = await kpiId("WATER_WITHDRAWAL");
  const [{ id }] = await q(`SELECT id FROM kpi_value WHERE company_id = 1 AND kpi_definition_id = $1 LIMIT 1`, [water]);
  await q(`UPDATE kpi_value SET status = 'draft', entered_by = 1 WHERE id = $1`, [id]);
  // The user update test above left user 1 owning energy only; water on site 1 is theirs again.
  await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1 AND site_id = 1 AND topic = 'water'`);
  await q(`INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id) VALUES (1, 1, 'water', 1)`);
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://files.example.invalid/a.pdf"]) {
    const r = await call("POST", `/kpi/values/${id}/evidence`, "user", { document_url: bad, document_name: "x" });
    assert.equal(r.status, 400, `${bad}: ${JSON.stringify(r.json)}`);
  }
  const good = await call("POST", `/kpi/values/${id}/evidence`, "user", { document_url: "https://files.example.invalid/meter.pdf", document_name: "meter.pdf" });
  assert.notEqual(good.status, 400, JSON.stringify(good.json));
});

test("template plans are stored in kpi_template_plan and commit once", async () => {
  const planId = "00000000-0000-4000-8000-000000000001";
  await q(`INSERT INTO kpi_template_plan (id, company_id, user_id, ready) VALUES ($1, 1, 1, '[]'::jsonb)`, [planId]);
  assert.equal((await call("POST", "/kpi/my/template", "multiSiteUser", { plan_id: planId, commit: true })).status, 404, "another person's plan");
  const done = await call("POST", "/kpi/my/template", "user", { plan_id: planId, commit: true });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.saved, 0);
  assert.equal((await q(`SELECT 1 FROM kpi_template_plan WHERE id = $1`, [planId])).length, 0, "a commit removes the plan");
  assert.equal((await call("POST", "/kpi/my/template", "user", { plan_id: planId, commit: true })).status, 404, "one commit per plan");
  // Older than 24 h: gone.
  await q(`INSERT INTO kpi_template_plan (id, company_id, user_id, ready, created_at) VALUES ($1, 1, 1, '[]'::jsonb, now() - interval '25 hours')`, [planId]);
  assert.equal((await call("POST", "/kpi/my/template", "user", { plan_id: planId, commit: true })).status, 404, "expired plan");
});

test("migrate:kpi-template-plans runs twice; topic-assignment collapse only on the first run", async () => {
  assert.equal(runScript("migrateKpiTemplatePlans").status, 0);
  // A per-KPI override on every KPI of a topic with no topic owner stays an override on a later run.
  await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1 AND site_id = 1 AND topic = 'water'`);
  const waterKpis = await q(`SELECT ck.kpi_definition_id FROM company_kpi ck JOIN kpi_definition d ON d.id = ck.kpi_definition_id WHERE ck.company_id = 1 AND ck.selected AND d.topic = 'water'`);
  for (const k of waterKpis) await q(`INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id) VALUES (1, $1, 1, 2) ON CONFLICT DO NOTHING`, [k.kpi_definition_id]);
  const r = runScript("migrateKpiTopicAssignment");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal((await q(`SELECT 1 FROM kpi_topic_assignment WHERE company_id = 1 AND site_id = 1 AND topic = 'water'`)).length, 0, "no topic owner made on a later run");
});
