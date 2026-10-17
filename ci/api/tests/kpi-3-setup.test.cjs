// KPI-3 company setup: GET/PUT /kpi/setup step by step (settings, frameworks,
// material topics, KPI selection, owners), the recommendation, every reason
// rule (KPI_REASON_REQUIRED), owner and reviewer rules (422), finishing setup
// (KPI_SETUP_INCOMPLETE, /kpi/status), custom KPIs, the KPI topic grant on the
// company user update and its effect on entry, assignments on entry, the role
// matrix, a Superadmin with company_id, tenant isolation, audit rows, the
// switch-off answer and migrate:kpi-setup running twice.
//
// Fixture: company 1 (sites 1, 2; user 1 on site 1, manager 2 on 1+2, admin 3,
// multi user 7 on 1+2), company 2 (site 3; other user 4, other manager 6), superadmin 5.
const test = require("node:test");
const assert = require("node:assert/strict");
const { call, withDb } = require("../helpers.cjs");
const { setSwitch, runScript, clearSetup } = require("./kpi-lib.cjs");

const q = (sql, params) => withDb(async (db) => (await db.query(sql, params)).rows);
const kpiId = async (code) => (await q(`SELECT id FROM kpi_definition WHERE code = $1 AND company_id IS NULL`, [code]))[0].id;
let fw = {};

const wipe = async () => {
  await clearSetup();
  await q(`DELETE FROM kpi_value WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM audit_log WHERE entity_type IN ('kpi_setup', 'kpi_value')`);
  await q(`DELETE FROM kpi_disclosure_map WHERE kpi_definition_id IN (SELECT id FROM kpi_definition WHERE company_id IN (1, 2))`);
  await q(`DELETE FROM kpi_definition WHERE company_id IN (1, 2)`);
  await q(`DELETE FROM kpi_framework WHERE version = 'GRI test version'`);
};

test.before(async () => {
  for (const name of ["migrateKpiLibrary", "seedKpiLibrary", "migrateKpiValues", "migrateKpiSetup"]) {
    const r = runScript(name);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  await wipe();
  for (const f of await q(`SELECT id, code FROM kpi_framework WHERE active`)) fw[f.code] = f.id;
  await setSwitch(1, true);
  await setSwitch(2, true);
});
test.after(async () => {
  await wipe();
  await setSwitch(1, false);
  await setSwitch(2, false);
});

const audits = () => q(`SELECT entity_id, action, changed_fields, changed_by FROM audit_log WHERE entity_type = 'kpi_setup' ORDER BY id`);
const put = (who, body, query = "") => call("PUT", `/kpi/setup${query}`, who, body);

test("before setup: defaults, every role reads, the pickers only for Admins, status not finished", async () => {
  for (const who of ["user", "manager", "admin"]) {
    const r = await call("GET", "/kpi/setup", who);
    assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.json)}`);
    // The year type is prefilled from the company's emission rows (CY when there are none or a tie).
    assert.ok(["CY", "FY"].includes(r.json.settings.year_type));
    assert.deepEqual(r.json.settings, { company_id: 1, year_type: r.json.settings.year_type, first_year: r.json.settings.first_year, due_day: 15, setup_completed_at: null });
    assert.deepEqual(r.json.frameworks, []);
    assert.deepEqual(r.json.kpis, []);
    assert.deepEqual(r.json.assignments, []);
    assert.deepEqual(r.json.recommended, []);
    assert.deepEqual(r.json.recommended_reasons, []);
    assert.deepEqual(r.json.available_frameworks.map((f) => f.code), ["GRI", "BRSR", "ESRS"]);
    assert.deepEqual(r.json.sites.map((s) => s.site_id).sort(), [1, 2]);
    assert.equal("people" in r.json, who === "admin", who);
  }
  const admin = (await call("GET", "/kpi/setup", "admin")).json;
  const ids = admin.people.map((p) => p.user_id);
  for (const id of [1, 2, 3, 7]) assert.ok(ids.includes(id), `user ${id}`);
  for (const id of [4, 5, 6]) assert.ok(!ids.includes(id), `user ${id} isn't company 1's`);
  assert.deepEqual(admin.people.find((p) => p.user_id === 7).site_ids, [1, 2]);
  assert.ok(!JSON.stringify(admin.people).includes("@"), "no emails");
  assert.deepEqual((await call("GET", "/kpi/status", "admin")).json, { enabled: true, setup_completed: false });
  assert.equal((await audits()).length, 0, "a read writes nothing");
});

test("role matrix and tenant isolation: Admins and Superadmins write; Managers and Users read only; another company is 404", async () => {
  for (const who of ["user", "manager", "multiSiteUser"]) {
    const r = await put(who, { settings: { due_day: 10 } });
    assert.equal(r.status, 403, who);
    assert.equal(r.json.code, "KPI_FORBIDDEN");
    assert.equal((await call("POST", "/kpi/setup/custom-kpis", who, {})).json.code, "KPI_FORBIDDEN", who);
  }
  assert.equal((await put("superadmin", { settings: { due_day: 10 } })).json.code, "KPI_COMPANY_REQUIRED");
  assert.equal((await call("GET", "/kpi/setup?company_id=1", "otherManager")).status, 404);
  assert.equal((await put("admin", { settings: { due_day: 10 } }, "?company_id=2")).status, 404);
  // The Superadmin sets up company 2; company 1 sees none of it.
  const sa = await put("superadmin", { company_id: 2, settings: { year_type: "FY", due_day: 20 }, frameworks: [fw.GRI] });
  assert.equal(sa.status, 200, JSON.stringify(sa.json));
  assert.equal(sa.json.settings.company_id, 2);
  assert.equal(sa.json.settings.year_type, "FY");
  assert.deepEqual(sa.json.frameworks.map((f) => f.code), ["GRI"]);
  assert.deepEqual((await call("GET", "/kpi/setup", "otherManager")).json.frameworks.map((f) => f.code), ["GRI"]);
  assert.deepEqual((await call("GET", "/kpi/setup", "admin")).json.frameworks, []);
  assert.equal((await audits()).filter((a) => a.entity_id === 2).every((a) => a.changed_by === 5), true);
  // Finishing needs a selected KPI.
  const early = await put("superadmin", { company_id: 2, settings: { complete: true } });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, "KPI_SETUP_INCOMPLETE");
  assert.deepEqual(early.json.details, { missing: ["kpis"] });
});

test("step 1: year type and frameworks, one version per framework, audited", async () => {
  const r = await put("admin", { settings: { year_type: "FY", first_year: 2026 }, frameworks: [fw.GRI, fw.BRSR, fw.ESRS] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.settings.year_type, "FY");
  assert.equal(r.json.settings.first_year, 2026);
  assert.deepEqual(r.json.frameworks.map((f) => f.code), ["GRI", "BRSR", "ESRS"]);
  assert.equal(r.json.frameworks[0].enabled_by, 3);
  const acts = (await audits()).filter((a) => a.entity_id === 1).map((a) => a.action);
  assert.deepEqual(acts, ["settings", "frameworks"]);

  // A second GRI version can't be enabled beside the first; the FE spelling framework_ids works.
  const [extra] = await q(`INSERT INTO kpi_framework (code, version, name, source_url) VALUES ('GRI', 'GRI test version', 'Test', 'https://example.invalid') RETURNING id`);
  const two = await put("admin", { framework_ids: [fw.GRI, extra.id] });
  assert.equal(two.status, 400);
  assert.equal(two.json.code, "KPI_VALIDATION");
  assert.equal((await put("admin", { frameworks: [999999] })).json.code, "KPI_VALIDATION");
  const same = await put("admin", { framework_ids: [fw.GRI, fw.BRSR, fw.ESRS] });
  assert.equal(same.status, 200);
  assert.equal((await audits()).filter((a) => a.action === "frameworks" && a.entity_id === 1).length, 1, "saving the same frameworks again isn't a change");

  // The catalogue shows the enabled versions only.
  const cat = (await call("GET", "/kpi/catalogue", "user")).json;
  assert.deepEqual(cat.frameworks.map((f) => f.code).sort(), ["BRSR", "ESRS", "GRI"]);
  assert.ok(!cat.frameworks.some((f) => f.id === extra.id));
});

test("step 2: a topic marked not material needs a reason; the recommendation follows materiality", async () => {
  const noReason = await put("admin", { material_topics: [{ esrs_topic: "E3", material: false }] });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, "KPI_REASON_REQUIRED");
  assert.deepEqual(noReason.json.details, { esrs_topic: "E3" });
  const blank = await put("admin", { material_topics: [{ esrs_topic: "E3", material: false, reason: "   " }] });
  assert.equal(blank.json.code, "KPI_REASON_REQUIRED");

  const r = await put("admin", {
    material_topics: [
      { esrs_topic: "E1", material: true },
      { esrs_topic: "E3", material: false, reason: "Offices only; water use is negligible" },
      { esrs_topic: "S1", material: true },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.material_topics.map((t) => [t.esrs_topic, t.material]), [["E1", true], ["E3", false], ["S1", true]]);
  assert.equal(r.json.material_topics[1].reason, "Offices only; water use is negligible");
  assert.equal(r.json.material_topics[1].decided_by, 3);

  const rec = new Map(r.json.recommended_reasons.map((x) => [x.code, x]));
  assert.deepEqual(r.json.recommended, r.json.recommended_reasons.map((x) => x.kpi_definition_id), "recommended is the ids");
  assert.ok(rec.get("GHG_SCOPE1").reasons.some((x) => x.framework === "GRI" && x.disclosure === "305-1"));
  assert.ok(rec.get("GHG_SCOPE1").reasons.some((x) => x.framework === "ESRS"), "E1 is material");
  assert.ok(rec.get("WATER_WITHDRAWAL"), "GRI 303-3 is required");
  assert.ok(!rec.get("WATER_WITHDRAWAL").reasons.some((x) => x.framework === "ESRS"), "E3 isn't material");
  assert.ok(rec.get("REVENUE").pulled_in_by.includes("GHG_INTENSITY_REVENUE"), "a calculated KPI pulls in its inputs");
  const last = (await audits()).at(-1);
  assert.equal(last.action, "material_topics");
  assert.deepEqual(last.changed_fields.E3.new, { material: false, reason: "Offices only; water use is negligible" });
});

test("step 3: selecting KPIs; leaving out a recommended KPI needs a reason; frequency override; unknown KPI 404", async () => {
  const recommended = (await call("GET", "/kpi/setup", "admin")).json.recommended_reasons;
  const ghg1 = await kpiId("GHG_SCOPE1");
  const noReason = await put("admin", { kpis: [{ kpi_definition_id: ghg1, selected: false }] });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.code, "KPI_REASON_REQUIRED");
  assert.deepEqual(noReason.json.details, { kpi_definition_id: ghg1, kpi: "GHG_SCOPE1" });
  assert.equal((await put("admin", { kpis: [{ kpi_definition_id: 999999, selected: true }] })).status, 404);

  const items = recommended.map((x) => ({ kpi_definition_id: x.kpi_definition_id, selected: true }));
  const recycled = await kpiId("WATER_RECYCLED");
  const water = await kpiId("WATER_WITHDRAWAL");
  assert.ok(!recommended.some((x) => x.code === "WATER_RECYCLED"), "nothing enabled asks for recycled water");
  items.push({ kpi_definition_id: recycled, selected: false }, { kpi_definition_id: await kpiId("LOST_TIME_INJURIES"), selected: true });
  const r = await put("admin", { kpis: [...items.filter((i) => i.kpi_definition_id !== water), { kpi_definition_id: water, selected: true, frequency: "quarterly" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const byCode = new Map(r.json.kpis.map((k) => [k.code, k]));
  assert.equal(byCode.get("WATER_WITHDRAWAL").frequency, "quarterly");
  assert.equal(byCode.get("WATER_WITHDRAWAL").effective_frequency, "quarterly");
  assert.equal(byCode.get("GHG_SCOPE1").effective_frequency, "annual");
  assert.equal(byCode.get("GHG_SCOPE1").level, "site");
  assert.deepEqual([byCode.get("WATER_RECYCLED").selected, byCode.get("WATER_RECYCLED").reason_excluded], [false, null], "not recommended, so no reason is needed");

  // The step replaces the selection: a recommended KPI simply not listed needs its reason too.
  const notListed = await put("admin", { kpis: items.filter((i) => i.kpi_definition_id !== ghg1) });
  assert.equal(notListed.json.code, "KPI_REASON_REQUIRED");
  assert.equal(notListed.json.details.kpi, "GHG_SCOPE1");
  // A non-recommended KPI not listed is left out.
  const lti = await kpiId("LOST_TIME_INJURIES");
  const without = await put("admin", { kpis: [...items.filter((i) => i.kpi_definition_id !== lti && i.kpi_definition_id !== water), { kpi_definition_id: water, selected: true }] });
  assert.equal(without.status, 200, JSON.stringify(without.json));
  assert.equal(without.json.kpis.find((x) => x.code === "LOST_TIME_INJURIES").selected, false);
  assert.equal(without.json.kpis.find((x) => x.code === "WATER_WITHDRAWAL").frequency, "quarterly", "an omitted frequency keeps the override");

  // A recommended KPI left out with a reason.
  const out = await put("admin", { kpis: [...items.filter((i) => i.kpi_definition_id !== ghg1), { kpi_definition_id: ghg1, selected: false, reason_excluded: "No combustion on site" }] });
  assert.equal(out.status, 200);
  const k = out.json.kpis.find((x) => x.code === "GHG_SCOPE1");
  assert.deepEqual([k.selected, k.reason_excluded], [false, "No combustion on site"]);
  const audit = (await audits()).filter((a) => a.action === "kpis").at(-1);
  assert.deepEqual(audit.changed_fields.GHG_SCOPE1.new, { selected: false, frequency: null, reason_excluded: "No combustion on site" });
  const back = await put("admin", { kpis: items });
  assert.equal(back.status, 200, JSON.stringify(back.json));
});

test("step 4: owners and reviewers; an owner outside the site or a reviewer who isn't the site's Manager is 422", async () => {
  const water = await kpiId("WATER_WITHDRAWAL");
  const revenue = await kpiId("REVENUE");
  const ok = await put("admin", {
    assignments: [
      { kpi_definition_id: water, site_id: 1, owner_user_id: 7, reviewer_user_id: 2 },
      { kpi_definition_id: water, site_id: 2, owner_user_id: 7 },
      { kpi_definition_id: revenue, site_id: null, owner_user_id: 3 },
    ],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(
    ok.json.assignments.map((a) => [a.kpi_definition_id, a.site_id, a.owner_user_id, a.reviewer_user_id]),
    [[water, 1, 7, 2], [water, 2, 7, null], [revenue, null, 3, null]].sort((a, b) => a[0] - b[0] || (a[1] ?? 0) - (b[1] ?? 0)),
  );
  // The same cell again replaces the owner, never adds a row.
  const again = await put("admin", { assignments: [{ kpi_definition_id: water, site_id: 2, owner_user_id: 2 }] });
  assert.equal(again.json.assignments.filter((a) => a.kpi_definition_id === water).length, 2);

  const refused = async (a, code, rule) => {
    const r = await put("admin", { assignments: [a] });
    assert.equal(r.json.code, code, JSON.stringify(a) + JSON.stringify(r.json));
    if (rule) assert.equal(r.json.details.rule, rule);
    return r;
  };
  assert.equal((await refused({ kpi_definition_id: water, site_id: 2, owner_user_id: 1 }, "KPI_VALUE_INVALID", "user_of_the_site")).status, 422, "user 1 works on site 1 only");
  await refused({ kpi_definition_id: water, site_id: 1, owner_user_id: 4 }, "KPI_VALUE_INVALID", "user_of_the_site");
  await refused({ kpi_definition_id: water, site_id: 1, owner_user_id: 5 }, "KPI_VALUE_INVALID", "user_of_the_site");
  await refused({ kpi_definition_id: revenue, site_id: null, owner_user_id: 4 }, "KPI_VALUE_INVALID", "user_of_the_company");
  await refused({ kpi_definition_id: water, site_id: 1, owner_user_id: 1, reviewer_user_id: 7 }, "KPI_VALUE_INVALID", "manager_of_the_site");
  await refused({ kpi_definition_id: water, site_id: 1, owner_user_id: 1, reviewer_user_id: 6 }, "KPI_VALUE_INVALID", "manager_of_the_site");
  assert.equal((await refused({ kpi_definition_id: water, site_id: 3, owner_user_id: 1 }, "KPI_NOT_FOUND")).status, 404, "another company's site");
  assert.equal((await refused({ kpi_definition_id: revenue, site_id: 1, owner_user_id: 3 }, "KPI_VALIDATION")).status, 400, "a company-level KPI has no site");
  await refused({ kpi_definition_id: await kpiId("WATER_RECYCLED"), site_id: 1, owner_user_id: 1 }, "KPI_NOT_SELECTED");
  assert.equal((await put("admin", { assignments: [{ kpi_definition_id: water, site_id: 1 }] })).json.code, "KPI_VALIDATION");
  assert.equal((await audits()).filter((a) => a.action === "assignments").length, 2);

  // Defaults for the cells nobody owns yet: the site's User, the company's Admin.
  const setup = (await call("GET", "/kpi/setup", "admin")).json;
  const s = setup.suggested_assignments;
  assert.ok(s.some((a) => a.site_id === 1 && a.owner_user_id === 1 && a.reviewer_user_id === null));
  assert.ok(!s.some((a) => a.kpi_definition_id === water), "assigned cells aren't suggested");
  assert.ok(s.filter((a) => a.site_id === null).every((a) => a.owner_user_id === 3));
});

test("assignments and topic grants decide who enters: the owner, never another User; a granted topic only", async () => {
  // Setup isn't finished yet: no values.
  const early = await call("PUT", "/kpi/values", "multiSiteUser", { items: [{ kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2025-04-01", value_numeric: 10 }] });
  assert.equal(early.json.results[0].code, "KPI_SETUP_INCOMPLETE");

  const done = await put("admin", { settings: { complete: true } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.ok(done.json.settings.setup_completed_at);
  assert.deepEqual((await call("GET", "/kpi/status", "user")).json, { enabled: true, setup_completed: true });
  const first = done.json.settings.setup_completed_at;
  assert.equal((await put("admin", { settings: { complete: true } })).json.settings.setup_completed_at, first, "finishing again keeps the first date");
  assert.equal((await audits()).filter((a) => a.action === "complete").length, 1);

  const item = (over) => ({ kpi_code: "WATER_WITHDRAWAL", site_id: 1, period_start: "2025-04-01", value_numeric: 10, ...over });
  const save = async (who, over) => (await call("PUT", "/kpi/values", who, { items: [item(over)] })).json.results[0];
  // FY company, quarterly water: Q1 FY2026 starts in April 2025.
  assert.equal((await save("user")).code, "KPI_NOT_ASSIGNED", "site 1's water is user 7's");
  const own = await save("multiSiteUser");
  assert.equal(own.ok, true, JSON.stringify(own));
  assert.equal(own.value.year_type, "FY");
  assert.equal(own.value.frequency, "quarterly");
  assert.equal((await save("manager", { site_id: 2 })).ok, true, "Managers enter on their sites");
  // Unassigned: a User on their own site, in their topics.
  assert.equal((await save("user", { kpi_code: "LOST_TIME_INJURIES", period_start: "2025-04-01", value_numeric: 1 })).ok, true);

  const grant = await call("PATCH", "/company-admin/users/1", "admin", { kpi_topics: ["water", "water"] });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  assert.deepEqual(grant.json.kpi_topics, ["water"]);
  assert.deepEqual(await q(`SELECT topic FROM kpi_topic_grant WHERE user_id = 1`), [{ topic: "water" }]);
  assert.equal((await save("user", { kpi_code: "LOST_TIME_INJURIES", period_start: "2025-05-01", value_numeric: 1 })).code, "KPI_NOT_ASSIGNED", "safety isn't one of user 1's topics");
  assert.equal((await save("user", { kpi_code: "WATER_DISCHARGE", period_start: "2025-04-01", value_numeric: 1 })).ok, true);
  const setup = (await call("GET", "/kpi/setup", "admin")).json;
  assert.deepEqual(setup.topic_grants, [{ user_id: 1, topic: "water" }]);
  assert.equal((await call("PATCH", "/company-admin/users/1", "admin", { kpi_topics: ["nope"] })).status, 400);
  assert.equal((await call("PATCH", "/company-admin/users/1", "admin", { kpi_topics: "water" })).json.code, "KPI_VALIDATION");
  assert.equal((await call("PATCH", "/company-admin/users/4", "admin", { kpi_topics: ["water"] })).status, 404, "another company's user");
  const cleared = await call("PATCH", "/company-admin/users/1", "admin", { kpi_topics: [] });
  assert.deepEqual(cleared.json.kpi_topics, []);
  assert.deepEqual(await q(`SELECT topic FROM kpi_topic_grant WHERE user_id = 1`), []);
  assert.ok((await audits()).filter((a) => a.action === "topic_grant").length === 2);

  // The year type can't change once values use it.
  const yt = await put("admin", { settings: { year_type: "CY" } });
  assert.equal(yt.status, 400);
  assert.equal(yt.json.code, "KPI_VALIDATION");
  assert.equal((await put("admin", { settings: { due_day: 29 } })).json.code, "KPI_VALIDATION", "due_day is 1-28");
  assert.equal((await put("admin", { settings: { due_day: 10 } })).json.settings.due_day, 10);
});

test("invite: one kpi_assigned notification per owner of a selected KPI; Admins and Superadmins only", async () => {
  await q(`DELETE FROM notification WHERE type = 'kpi_assigned'`);
  for (const who of ["user", "manager"]) assert.equal((await call("POST", "/kpi/setup/invite", who)).json.code, "KPI_FORBIDDEN", who);
  const r = await call("POST", "/kpi/setup/invite", "admin");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const notes = await q(`SELECT user_id, title, link FROM notification WHERE type = 'kpi_assigned' ORDER BY user_id`);
  const owners = [...new Set((await call("GET", "/kpi/setup", "admin")).json.assignments.map((a) => a.owner_user_id))].sort((a, b) => a - b);
  assert.deepEqual(notes.map((n) => n.user_id), owners);
  assert.equal(r.json.notified, owners.length);
  assert.equal(notes[0].link, "/kpi");
  assert.equal((await call("POST", "/kpi/setup/invite?company_id=1", "superadmin")).json.notified, owners.length);
  assert.ok(!(await q(`SELECT 1 FROM notification WHERE type = 'kpi_assigned' AND user_id IN (4, 6)`)).length, "never another company's people");
  await q(`DELETE FROM notification WHERE type = 'kpi_assigned'`);
});

test("custom KPIs: Admin adds one (code made from the name), optionally mapped, selected; validated like the library; invisible to other companies", async () => {
  const disclosure = (await q(`SELECT ds.id FROM kpi_disclosure ds JOIN kpi_framework f ON f.id = ds.framework_id WHERE f.code = 'GRI' AND ds.code = '303-3'`))[0].id;
  const body = {
    name: "Rainwater harvested",
    question: "How much rainwater did the site harvest?",
    topic: "water",
    value_type: "number",
    unit_dimension: "volume",
    canonical_unit: "kL",
    allowed_units: ["kL", "m3"],
    aggregation: "sum",
    level: "site",
    default_frequency: "monthly",
    mappings: [{ disclosure_id: disclosure, fit: "partial", note: "Part of third-party water" }],
  };
  const r = await call("POST", "/kpi/setup/custom-kpis", "admin", body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const d = r.json.definition;
  assert.equal(d.code, "C1_RAINWATER_HARVESTED");
  assert.equal(d.company_id, 1);
  assert.equal(d.source, "manual");
  assert.deepEqual(d.mappings.map((m) => [m.disclosure_id, m.fit]), [[disclosure, "partial"]]);
  const setup = (await call("GET", "/kpi/setup", "admin")).json;
  const row = setup.kpis.find((k) => k.kpi_definition_id === d.id);
  assert.deepEqual([row.selected, row.custom], [true, true]);
  assert.equal((await audits()).filter((a) => a.action === "custom_kpi").length, 1);
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", body)).json.definition.code, "C1_RAINWATER_HARVESTED_2", "a second one gets the next code");

  // Validated like library KPIs.
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, code: "ENERGY_TOTAL" })).json.code, "KPI_CODE_TAKEN");
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, allowed_units: ["kL", "kWh"] })).json.code, "KPI_UNIT_NOT_ALLOWED");
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, source: "auto" })).json.code, "KPI_VALIDATION");
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", { ...body, mappings: [{ disclosure_id: disclosure, fit: "derived" }] })).json.code, "KPI_VALIDATION");
  const formula = { ...body, name: "Water reuse ratio", source: "formula", formula: "WATER_RECYCLED / NOPE_KPI", unit_dimension: "none", canonical_unit: "ratio", allowed_units: ["ratio"], aggregation: "none", level: "company", default_frequency: "annual", mappings: [] };
  assert.equal((await call("POST", "/kpi/setup/custom-kpis", "admin", formula)).json.code, "KPI_FORMULA_INVALID");

  // Company 2 never sees it.
  assert.ok(!(await call("GET", "/kpi/catalogue", "otherUser")).json.definitions.some((x) => x.id === d.id));
  assert.equal((await put("superadmin", { company_id: 2, kpis: [{ kpi_definition_id: d.id, selected: true }] })).status, 404);
  // And the library list never shows a company's KPI.
  assert.ok(!(await call("GET", "/kpi/library/definitions", "superadmin")).json.definitions.some((x) => x.id === d.id));
});

test("switch off: every setup route answers KPI_TRACKING_OFF, and so does the topic grant", async () => {
  await setSwitch(1, false);
  try {
    for (const [method, route, body] of [["GET", "/kpi/setup"], ["PUT", "/kpi/setup", { settings: { due_day: 5 } }], ["POST", "/kpi/setup/custom-kpis", {}], ["POST", "/kpi/setup/invite", {}]]) {
      for (const who of ["user", "manager", "admin"]) {
        const r = await call(method, route, who, body);
        assert.equal(r.status, 403, `${who} ${method} ${route}`);
        assert.equal(r.json.code, "KPI_TRACKING_OFF");
      }
    }
    const g = await call("PATCH", "/company-admin/users/1", "admin", { kpi_topics: ["water"] });
    assert.equal(g.status, 403);
    assert.equal(g.json.code, "KPI_TRACKING_OFF");
    assert.equal((await q(`SELECT 1 FROM kpi_topic_grant WHERE user_id = 1`)).length, 0);
    // The data is kept (D3).
    assert.equal((await q(`SELECT 1 FROM company_kpi_settings WHERE company_id = 1 AND setup_completed_at IS NOT NULL`)).length, 1);
  } finally {
    await setSwitch(1, true);
  }
});

test("migrate:kpi-setup runs twice and keeps the setup", async () => {
  const count = async () => (await q(`SELECT COUNT(*)::int AS n FROM company_kpi`))[0].n;
  const before = await count();
  for (let i = 0; i < 2; i++) {
    const r = runScript("migrateKpiSetup");
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  assert.equal(await count(), before);
});
