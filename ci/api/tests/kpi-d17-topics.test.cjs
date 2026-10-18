// D17 (KPI wave D): contributors are assigned KPIs by topic.
//
//   - migrate:kpi-topic-assignment: twice clean; wave B grants become topic owners once, only into empty slots
//   - resolveOwner precedence: per-KPI override → topic owner → nobody; the User write rule follows it
//   - PUT /kpi/setup {topic_assignments} (the whole set; null removes; owner rules), GET additions
//   - GET/PUT /kpi/people/:user_id/topics with "moved" notes; Manager for their own sites; audited
//   - the PATCH /company-admin/users/:id and PATCH /admin/users/:id {kpi_topics} aliases
//   - submit notifies the topic's reviewer; invite reaches topic owners; /kpi/my topic fields
//   - tenant isolation, roles and the switch
//
// Fixture: company 1 (site 1 "CI Plant A": user 1, manager 2, admin 3, user 7; site 2: manager 2, user 7), company 2 (site 3: users 4, 6).
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, setupCompany, clearSetup } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const kpiId = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
const wipe = async () => {
  await q(`DELETE FROM kpi_value_evidence WHERE kpi_value_id IN (SELECT id FROM kpi_value WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_value', 'kpi_setup')`);
  await q(`DELETE FROM notification WHERE type IN ('kpi_submitted', 'kpi_assigned', 'kpi_due')`);
  await clearSetup();
};
const owners = () => q(`SELECT site_id, topic, owner_user_id, reviewer_user_id FROM kpi_topic_assignment WHERE company_id = 1 ORDER BY site_id NULLS FIRST, topic`);
const save = async (who, item) => (await call("PUT", "/kpi/values", who, { items: [{ site_id: 1, period_start: "2026-09-01", value_numeric: 5, ...item }] })).json.results[0];

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup", "migrateKpiTopicAssignment"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  await setupCompany(1, { frameworks: ["GRI", "BRSR"], topicOwners: false });
  await setupCompany(2, { frameworks: ["GRI"], topicOwners: false });
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await q(`DELETE FROM kpi_topic_grant WHERE user_id IN (1, 2, 3, 4, 6, 7)`);
  await setSwitch(1, false);
  await setSwitch(2, false);
});

test("migrate:kpi-topic-assignment runs twice; grants become topic owners once, only where the slot is empty", async () => {
  await q(`INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id) VALUES (1, 1, 'waste', 7)`);
  await q(`INSERT INTO kpi_topic_grant (user_id, topic) VALUES (1, 'water'), (1, 'waste'), (3, 'water'), (7, 'water') ON CONFLICT DO NOTHING`);
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateKpiTopicAssignment");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  // User 1 (site 1) and user 7 (sites 1, 2) both had water: on site 1 the User with the lowest id wins; site 2 goes to 7.
  // Waste on site 1 was taken (7) and stays (user 1's waste grant doesn't overwrite it); the Admin's grant makes nothing (an Admin doesn't own site topics).
  assert.deepEqual(await owners(), [
    { site_id: 1, topic: "waste", owner_user_id: 7, reviewer_user_id: null },
    { site_id: 1, topic: "water", owner_user_id: 1, reviewer_user_id: null },
    { site_id: 2, topic: "water", owner_user_id: 7, reviewer_user_id: null },
  ]);
  assert.equal((await q(`SELECT 1 FROM kpi_topic_grant WHERE converted_at IS NULL AND user_id IN (1, 3, 7)`)).length, 0, "every grant stamped");
  // An emptied slot is never refilled by a later run (migrate:all runs on every start).
  await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1`);
  assert.equal(runScript("migrateKpiTopicAssignment").status, 0);
  assert.deepEqual(await owners(), []);
  assert.equal((await q(`SELECT 1 FROM kpi_topic_grant WHERE user_id = 1`)).length, 2, "grants are kept (no destructive change)");
});

test("PUT /kpi/setup {topic_assignments}: the whole set, null removes, owner rules; GET shows owners, topics in use and suggestions", async () => {
  const put = (who, body) => call("PUT", "/kpi/setup", who, body);
  const set = [
    { site_id: 1, topic: "water", owner_user_id: 1, reviewer_user_id: 2 },
    { site_id: 1, topic: "health_safety", owner_user_id: 1 },
    { site_id: 2, topic: "water", owner_user_id: 7 },
    { site_id: null, topic: "governance", owner_user_id: 3 },
  ];
  const ok = await put("admin", { topic_assignments: set });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(
    ok.json.topic_assignments.map(({ id, ...r }) => r),
    [
      { site_id: 1, topic: "water", owner_user_id: 1, reviewer_user_id: 2 },
      { site_id: 2, topic: "water", owner_user_id: 7, reviewer_user_id: null },
      { site_id: 1, topic: "health_safety", owner_user_id: 1, reviewer_user_id: null },
      { site_id: null, topic: "governance", owner_user_id: 3, reviewer_user_id: null },
    ],
    "in KPI_TOPICS order, then site",
  );
  // topics_in_use: the selected KPIs' topics in KPI_TOPICS order, with counts.
  const order = ok.json.topics_in_use.map((t) => t.topic);
  const TOPICS = ["climate", "energy", "water", "waste", "pollution", "biodiversity", "materials", "workforce", "health_safety", "diversity", "training", "human_rights", "community", "customers", "governance", "ethics"];
  assert.deepEqual(order, [...order].sort((a, b) => TOPICS.indexOf(a) - TOPICS.indexOf(b)));
  const water = ok.json.topics_in_use.find((t) => t.topic === "water");
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM company_kpi ck JOIN kpi_definition d ON d.id = ck.kpi_definition_id WHERE ck.company_id = 1 AND ck.selected AND d.topic = 'water' AND d.source = 'manual'`);
  assert.equal(water.kpi_count, n);
  // Suggestions only for empty slots: site 2 safety → its first User (7), never site 1 water.
  const sug = ok.json.suggested_topic_assignments;
  assert.ok(sug.some((s) => s.site_id === 2 && s.topic === "health_safety" && s.owner_user_id === 7));
  assert.ok(!sug.some((s) => s.site_id === 1 && s.topic === "water"));
  assert.ok(sug.every((s) => s.id === null));

  // The whole set: leaving a row out removes it; owner_user_id null removes it too.
  const replaced = await put("admin", { topic_assignments: [...set.slice(0, 3), { site_id: 2, topic: "water", owner_user_id: null }] });
  assert.deepEqual(replaced.json.topic_assignments.map((r) => `${r.topic}@${r.site_id}`), ["water@1", "health_safety@1"]);
  const audit = await q(`SELECT changed_fields FROM audit_log WHERE entity_type = 'kpi_setup' AND entity_id = 1 AND action = 'topic_assignments' ORDER BY id DESC LIMIT 1`);
  assert.deepEqual(audit[0].changed_fields["water@2"], { old: { owner_user_id: 7, reviewer_user_id: null }, new: null });

  // Owner rules (KPI_VALUE_INVALID, as kpi_assignment).
  const refused = async (row, rule) => {
    const r = await put("admin", { topic_assignments: [row] });
    assert.equal(r.status, rule ? 422 : 404, JSON.stringify(r.json));
    if (rule) assert.equal(r.json.details.rule, rule);
  };
  await refused({ site_id: 1, topic: "water", owner_user_id: 3 }, "user_of_the_site"); // an Admin doesn't own a site topic
  await refused({ site_id: 2, topic: "water", owner_user_id: 1 }, "user_of_the_site"); // not on site 2
  await refused({ site_id: 1, topic: "water", owner_user_id: 4 }, "user_of_the_site"); // another company's user
  await refused({ site_id: null, topic: "governance", owner_user_id: 4 }, "user_of_the_company");
  await refused({ site_id: 1, topic: "water", owner_user_id: 1, reviewer_user_id: 7 }, "manager_of_the_site");
  await refused({ site_id: 1, topic: "water", owner_user_id: 1, reviewer_user_id: 6 }, "manager_of_the_site");
  await refused({ site_id: 3, topic: "water", owner_user_id: 1 }, null); // company 2's site → 404
  assert.equal((await put("admin", { topic_assignments: [{ site_id: 1, topic: "nope", owner_user_id: 1 }] })).json.code, "KPI_VALIDATION");
  assert.equal((await put("manager", { topic_assignments: [] })).json.code, "KPI_FORBIDDEN");
  assert.equal((await put("user", { topic_assignments: [] })).status, 403);
  // A refusal changes nothing; a Superadmin sets the same set for the chosen client.
  assert.deepEqual((await owners()).map((r) => `${r.topic}@${r.site_id}`), ["health_safety@1", "water@1"]);
  const sa = await put("superadmin", { company_id: 1, topic_assignments: set });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.equal(sa.json.topic_assignments.length, 4);
  assert.equal((await put("superadmin", { topic_assignments: set })).json.code, "KPI_COMPANY_REQUIRED");
  // Every role reads the owners; only setup writers get the suggestions.
  const asUser = (await call("GET", "/kpi/setup", "user")).json;
  assert.equal(asUser.topic_assignments.length, 4);
  assert.equal(asUser.suggested_topic_assignments, undefined);
});

test("resolveOwner: the per-KPI override wins, else the topic owner, else nobody; Users write only what they own", async () => {
  // Owners from the previous test: water and safety on site 1 → user 1 (water reviewer: manager 2).
  const withdrawal = await kpiId("WATER_WITHDRAWAL");
  await q(`INSERT INTO kpi_assignment (company_id, kpi_definition_id, site_id, owner_user_id) VALUES (1, $1, 1, 7)`, [withdrawal]);
  try {
    assert.equal((await save("user", { kpi_code: "WATER_DISCHARGE" })).ok, true, "topic owner");
    assert.equal((await save("user", { kpi_code: "WATER_WITHDRAWAL" })).code, "KPI_NOT_ASSIGNED", "the override is user 7's");
    assert.equal((await save("multiSiteUser", { kpi_code: "WATER_WITHDRAWAL" })).ok, true, "the override");
    assert.equal((await save("multiSiteUser", { kpi_code: "WATER_DISCHARGE", period_start: "2026-10-01" })).code, "KPI_NOT_ASSIGNED", "not user 7's topic on site 1");
    // Nobody owns waste on site 1: Users can't, Managers and Admins keep their rights (D17).
    assert.equal((await save("user", { kpi_code: "WASTE_GENERATED", period_start: "2026-01-01" })).code, "KPI_NOT_ASSIGNED");
    assert.equal((await save("manager", { kpi_code: "WASTE_GENERATED", period_start: "2026-01-01" })).ok, true);
    assert.equal((await save("admin", { kpi_code: "WASTE_GENERATED", site_id: 2, period_start: "2026-01-01" })).ok, true);
    // A KPI selected later inherits its topic's owner: nothing to do.
    await q(`UPDATE company_kpi SET selected = false WHERE company_id = 1 AND kpi_definition_id = $1`, [await kpiId("WATER_RECYCLED")]);
    assert.equal((await save("user", { kpi_code: "WATER_RECYCLED", period_start: "2026-01-01" })).code, "KPI_NOT_SELECTED");
    await q(`UPDATE company_kpi SET selected = true WHERE company_id = 1 AND kpi_definition_id = $1`, [await kpiId("WATER_RECYCLED")]);
    assert.equal((await save("user", { kpi_code: "WATER_RECYCLED", period_start: "2026-01-01" })).ok, true, "inherited from the water owner");

    // /kpi/my: topic, topic_label, how the item is owned, the reviewer, topic order.
    const my = (await call("GET", "/kpi/my?period=2026-09", "user")).json;
    const discharge = my.items.find((i) => i.code === "WATER_DISCHARGE" && i.site_id === 1);
    assert.deepEqual([discharge.topic, discharge.topic_label, discharge.assigned, discharge.assigned_via, discharge.reviewer_user_id, discharge.reviewer_name], ["water", "Water", true, "topic", 2, "CI Manager"]);
    assert.ok(!my.items.some((i) => i.code === "WATER_WITHDRAWAL"), "the override is someone else's");
    const u7 = (await call("GET", "/kpi/my?period=2026-09", "multiSiteUser")).json;
    assert.equal(u7.items.find((i) => i.code === "WATER_WITHDRAWAL" && i.site_id === 1).assigned_via, "kpi");
    const admin = (await call("GET", "/kpi/my?period=2026-12", "admin")).json;
    assert.ok(admin.items.some((i) => i.code === "REVENUE" && i.site_id === null && i.assigned_via === "topic"), "governance at company level is the Admin's");

    // Submit notifies the reviewer of the resolved row (the topic's reviewer, manager 2), once.
    const id = (await save("user", { kpi_code: "WATER_DISCHARGE", period_start: "2026-08-01" })).value.id;
    await call("POST", `/kpi/values/${id}/evidence`, "user", { document_url: "https://files.example.invalid/w.pdf", document_name: "w.pdf" });
    await q(`DELETE FROM notification WHERE type = 'kpi_submitted'`);
    assert.deepEqual((await call("POST", "/kpi/values/submit", "user", { ids: [id] })).json.refused, []);
    assert.deepEqual((await q(`SELECT user_id FROM notification WHERE type = 'kpi_submitted'`)).map((r) => r.user_id), [2]);

    // Invite reaches every resolved owner (topic owners included).
    await q(`DELETE FROM notification WHERE type = 'kpi_assigned'`);
    const inv = await call("POST", "/kpi/setup/invite", "admin", {});
    assert.equal(inv.status, 200, JSON.stringify(inv.json));
    assert.deepEqual((await q(`SELECT user_id FROM notification WHERE type = 'kpi_assigned' ORDER BY user_id`)).map((r) => r.user_id), [1, 3, 7]);

    // Dashboard gaps and the remind button name the resolved owner.
    const remind = await call("POST", "/kpi/dashboard/remind", "manager", { kpi: await kpiId("WATER_DISCHARGE"), site: 1 });
    assert.deepEqual(remind.json.notified, [1]);
    const nobody = await call("POST", "/kpi/dashboard/remind", "manager", { kpi: await kpiId("WASTE_GENERATED"), site: 1 });
    assert.deepEqual(nobody.json.details, { field: "kpi", rule: "nobody_owes_it" });
    const gaps = (await call("GET", "/kpi/dashboard?year=2026", "manager")).json.gaps;
    const g = gaps.find((x) => x.code === "WATER_DISCHARGE" && x.site_id === 1);
    assert.deepEqual(g.owner, { id: 1, name: "CI User" });
  } finally {
    await q(`DELETE FROM kpi_assignment WHERE company_id = 1`);
  }
});

test("GET/PUT /kpi/people/:user_id/topics: owner of those topics on those sites, other topics dropped, moved notes, audited", async () => {
  // Before: site 1 water + safety → user 1, governance (company) → admin 3.
  await q(`DELETE FROM kpi_topic_assignment WHERE company_id = 1 AND site_id = 2`);
  await q(`INSERT INTO kpi_topic_assignment (company_id, site_id, topic, owner_user_id, reviewer_user_id) VALUES (1, 2, 'water', 7, 2)`);

  const r = await call("PUT", "/kpi/people/7/topics", "admin", { topics: ["waste", "water", "water"] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, {
    user_id: 7,
    topics: ["water", "waste"],
    site_ids: [1, 2],
    moved: [{ site_id: 1, site_name: "CI Plant A", topic: "water", topic_label: "Water", from_user_id: 1, from_name: "CI User" }],
  });
  assert.deepEqual(
    (await owners()).map((o) => [o.topic, o.site_id, o.owner_user_id, o.reviewer_user_id]),
    [["governance", null, 3, null], ["health_safety", 1, 1, null], ["waste", 1, 7, null], ["water", 1, 7, 2], ["waste", 2, 7, null], ["water", 2, 7, 2]].sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0) || a[0].localeCompare(b[0])),
    "a moved slot keeps its reviewer",
  );
  // Only site 2, only water: waste on site 2 is dropped, site 1 untouched.
  const s2 = await call("PUT", "/kpi/people/7/topics", "admin", { topics: ["water"], site_ids: [2] });
  assert.deepEqual([s2.json.site_ids, s2.json.moved], [[2], []]);
  assert.ok(!(await owners()).some((o) => o.site_id === 2 && o.topic === "waste"));
  assert.ok((await owners()).some((o) => o.site_id === 1 && o.topic === "waste" && o.owner_user_id === 7));
  const audit = await q(`SELECT changed_fields, changed_by FROM audit_log WHERE entity_type = 'kpi_setup' AND entity_id = 1 AND action = 'people_topics' ORDER BY id`);
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[0].changed_fields.moved, [{ site_id: 1, topic: "water", from_user_id: 1 }]);
  assert.equal(audit[0].changed_by, 3);

  // GET: the person's topics, per site (and the company level when they own any).
  const g = await call("GET", "/kpi/people/7/topics", "admin");
  assert.deepEqual(g.json, {
    user_id: 7,
    topics: ["water", "waste"],
    by_site: [
      { site_id: 1, site_name: "CI Plant A", topics: ["water", "waste"] },
      { site_id: 2, site_name: "CI Plant B", topics: ["water"] },
    ],
  });
  assert.deepEqual((await call("GET", "/kpi/people/3/topics", "admin")).json.by_site.find((s) => s.site_id === null), { site_id: null, site_name: "Company", topics: ["governance"] });
  assert.equal((await call("GET", "/kpi/people/1/topics", "user")).status, 200, "a person reads their own");
  assert.equal((await call("GET", "/kpi/people/7/topics", "user")).json.code, "KPI_FORBIDDEN");

  // Roles: Manager for their own sites; Users can't; owner rules hold.
  assert.equal((await call("PUT", "/kpi/people/1/topics", "manager", { topics: ["water", "health_safety"], site_ids: [1] })).status, 200);
  assert.equal((await call("PUT", "/kpi/people/1/topics", "user", { topics: ["water"] })).json.code, "KPI_FORBIDDEN");
  assert.equal((await call("PUT", "/kpi/people/3/topics", "admin", { topics: ["water"] })).json.details.rule, "user_of_the_site", "an Admin owns no site topic");
  assert.equal((await call("PUT", "/kpi/people/1/topics", "admin", { topics: ["water"], site_ids: [2] })).json.details.rule, "user_of_the_site", "user 1 isn't on site 2");
  assert.equal((await call("PUT", "/kpi/people/1/topics", "admin", { topics: ["nope"] })).json.code, "KPI_VALIDATION");

  // Tenant isolation: another company's person, site or caller → 404; Superadmin needs company_id.
  assert.equal((await call("PUT", "/kpi/people/4/topics", "admin", { topics: ["water"] })).status, 404);
  assert.equal((await call("GET", "/kpi/people/4/topics", "admin")).status, 404);
  assert.equal((await call("PUT", "/kpi/people/1/topics", "admin", { topics: ["water"], site_ids: [3] })).status, 404);
  assert.equal((await call("PUT", "/kpi/people/1/topics?company_id=1", "otherManager", { topics: ["water"] })).status, 404);
  assert.equal((await call("PUT", "/kpi/people/4/topics", "otherManager", { topics: ["water"] })).status, 200, "company 2's Manager for their own site");
  assert.equal((await call("GET", "/kpi/people/1/topics", "otherManager")).status, 404);
  assert.equal((await call("PUT", "/kpi/people/1/topics", "superadmin", { topics: ["water"] })).json.code, "KPI_COMPANY_REQUIRED");
  const sa = await call("PUT", "/kpi/people/1/topics?company_id=1", "superadmin", { topics: ["water", "health_safety"] });
  assert.deepEqual([sa.status, sa.json.site_ids], [200, [1]]);
  assert.equal((await call("PUT", "/kpi/people/1/topics?company_id=2", "superadmin", { topics: ["water"] })).status, 404, "not a person of company 2");
});

test("the users-drawer aliases: PATCH /company-admin/users/:id and (Superadmin) PATCH /admin/users/:id {kpi_topics}", async () => {
  const a = await call("PATCH", "/company-admin/users/7", "admin", { kpi_topics: ["waste"] });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.deepEqual([a.json.kpi_topics, a.json.kpi_topic_site_ids], [["waste"], [1, 2]]);
  assert.ok(Array.isArray(a.json.kpi_topic_moves));
  const sa = await call("PATCH", "/admin/users/7", "superadmin", { kpi_topics: ["water", "waste"], company_id: 1 });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.deepEqual(sa.json.kpi_topics, ["water", "waste"]);
  assert.deepEqual(sa.json.kpi_topic_moves.map((x) => [x.site_id, x.topic, x.from_user_id]), [[1, "water", 1]]);
  assert.deepEqual((await call("GET", "/kpi/people/7/topics?company_id=1", "superadmin")).json.topics, ["water", "waste"]);
  assert.equal((await call("PATCH", "/admin/users/7", "superadmin", { kpi_topics: ["nope"] })).json.code, "KPI_VALIDATION");
  await setSwitch(1, false);
  try {
    const off = await call("PATCH", "/admin/users/7", "superadmin", { kpi_topics: ["water"], company_id: 1 });
    assert.deepEqual([off.status, off.json.code], [403, "KPI_TRACKING_OFF"]);
    for (const [method, who] of [["GET", "admin"], ["PUT", "admin"], ["PUT", "manager"]]) {
      const r = await call(method, "/kpi/people/7/topics", who, method === "PUT" ? { topics: [] } : undefined);
      assert.deepEqual([r.status, r.json.code], [403, "KPI_TRACKING_OFF"], `${method} ${who}`);
    }
    assert.deepEqual((await call("GET", "/kpi/people/7/topics?company_id=1", "superadmin")).json.code, "KPI_TRACKING_OFF");
  } finally {
    await setSwitch(1, true);
  }
});

test("GET /kpi/overview: readiness per framework for reviewers, due counts for everyone, before setup the empty shape", async () => {
  const m = await call("GET", "/kpi/overview", "manager");
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.deepEqual(Object.keys(m.json).sort(), ["due", "period", "readiness", "setup_completed", "year"]);
  assert.deepEqual(m.json.readiness.map((r) => r.framework), ["GRI", "BRSR"]);
  assert.ok(m.json.readiness.every((r) => typeof r.percent === "number" && r.version));
  assert.match(m.json.period, /^\d{4}-\d{2}$/);
  const dash = (await call("GET", `/kpi/dashboard?year=${m.json.year}`, "manager")).json;
  assert.deepEqual(m.json.readiness.map((r) => r.percent), dash.coverage.map((c) => c.percent), "the dashboard's own percent");
  const u = (await call("GET", "/kpi/overview", "user")).json;
  assert.deepEqual(u.readiness, [], "a User doesn't open the dashboard");
  const my = (await call("GET", `/kpi/my?period=${u.period}`, "user")).json;
  assert.deepEqual(u.due, { due: my.counts.due, sent_back: my.counts.sent_back, done: my.counts.done });
  assert.equal((await call("GET", "/kpi/overview", "superadmin")).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/kpi/overview?company_id=1", "superadmin")).json.readiness.length, 2);
  await q(`UPDATE company_kpi_settings SET setup_completed_at = NULL WHERE company_id = 2`);
  assert.deepEqual((await call("GET", "/kpi/overview", "otherUser")).json.setup_completed, false);
  assert.equal((await call("GET", "/kpi/overview?company_id=1", "otherManager")).status, 404);
  await setSwitch(1, false);
  try {
    assert.equal((await call("GET", "/kpi/overview", "user")).json.code, "KPI_TRACKING_OFF");
  } finally {
    await setSwitch(1, true);
  }
});
